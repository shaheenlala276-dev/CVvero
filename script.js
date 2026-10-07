
/* ==========================================================================
   CVvero - script.js (Version 1)
   Works with the existing index.html and style.css. No external resources,
   fully offline. Data is auto-saved in the browser using localStorage only.
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     1. Constants & configuration
     ------------------------------------------------------------------------ */
  const STORAGE_KEY = 'cvvero_v1_data';
  const SAVE_DELAY_MS = 300;

  const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const PERSONAL_FIELDS = [
    'fullName', 'professionalTitle', 'phone', 'email',
    'address', 'linkedin', 'website', 'summary'
  ];

  /* Fields that are validated (in DOM order). */
  const VALIDATED_SELECTOR = [
    '#fullName', '#phone', '#email', '#linkedin', '#website',
    '.education-start-year', '.education-end-year',
    '.experience-start-date', '.experience-end-date',
    '.project-link', '.certification-year'
  ].join(', ');

  /* Repeatable sections. Keys match the data-add / data-remove attributes. */
  const SECTIONS = {
    education: {
      storageKey: 'education',
      listId: 'educationList',
      templateId: 'educationTemplate',
      previewListId: 'previewEducationList',
      previewSectionId: 'previewEducationSection',
      hasContent: hasAnyValue,
      build: buildEducationItem
    },
    experience: {
      storageKey: 'experience',
      listId: 'experienceList',
      templateId: 'experienceTemplate',
      previewListId: 'previewExperienceList',
      previewSectionId: 'previewExperienceSection',
      hasContent: hasAnyValue,
      build: buildExperienceItem
    },
    skill: {
      storageKey: 'skills',
      listId: 'skillsList',
      templateId: 'skillTemplate',
      previewListId: 'previewSkillsList',
      previewSectionId: 'previewSkillsSection',
      hasContent: (item) => Boolean(item.name),
      build: buildSkillItem
    },
    language: {
      storageKey: 'languages',
      listId: 'languagesList',
      templateId: 'languageTemplate',
      previewListId: 'previewLanguagesList',
      previewSectionId: 'previewLanguagesSection',
      hasContent: (item) => Boolean(item.name),
      build: buildLanguageItem
    },
    project: {
      storageKey: 'projects',
      listId: 'projectsList',
      templateId: 'projectTemplate',
      previewListId: 'previewProjectsList',
      previewSectionId: 'previewProjectsSection',
      hasContent: hasAnyValue,
      build: buildProjectItem
    },
    certification: {
      storageKey: 'certifications',
      listId: 'certificationsList',
      templateId: 'certificationTemplate',
      previewListId: 'previewCertificationsList',
      previewSectionId: 'previewCertificationsSection',
      hasContent: hasAnyValue,
      build: buildCertificationItem
    }
  };

  /* Preview elements whose original placeholder text is restored when the CV is empty. */
  const PREVIEW_TEXT_IDS = [
    'previewFullName', 'previewProfessionalTitle', 'previewSummary',
    'previewPhone', 'previewEmail', 'previewAddress',
    'previewLinkedin', 'previewWebsite'
  ];

  /* ------------------------------------------------------------------------
     2. Module state
     ------------------------------------------------------------------------ */
  const state = {
    form: null,
    prototypes: {},          // empty entry node per section type
    placeholderNodes: {},    // original preview placeholder nodes per section type
    defaultTexts: {},        // original preview texts by element id
    saveTimer: null,
    errorCounter: 0
  };

  /* ------------------------------------------------------------------------
     3. Small helpers
     ------------------------------------------------------------------------ */
  function byId(id) {
    return document.getElementById(id);
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function hasAnyValue(item) {
    return Object.values(item).some((value) => Boolean(value));
  }

  function asString(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function isValidPhone(value) {
    const digits = value.replace(/\D/g, '');
    return /^[+()\d\s.\-/#x]+$/i.test(value) && digits.length >= 5 && digits.length <= 20;
  }

  function isValidYear(value) {
    if (!/^\d{4}$/.test(value)) return false;
    const year = Number(value);
    return year >= 1900 && year <= 2100;
  }

  /* Returns a safe http(s) URL or null. Accepts input without a scheme. */
  function normalizeUrl(value) {
    const trimmed = asString(value).trim();
    if (!trimmed || /\s/.test(trimmed)) return null;
    const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
    try {
      const url = new URL(withScheme);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
      return url.href;
    } catch (error) {
      return null;
    }
  }

  function displayUrl(value) {
    return value.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }

  function formatMonth(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (match) {
      const monthIndex = Number(match[2]) - 1;
      if (monthIndex >= 0 && monthIndex < 12) {
        return MONTH_NAMES[monthIndex] + ' ' + match[1];
      }
    }
    return value;
  }

  function formatRange(start, end, formatter) {
    const from = start ? formatter(start) : '';
    const to = end ? formatter(end) : '';
    if (from && to) return from + ' \u2013 ' + to;
    if (from) return from + ' \u2013 Present';
    return to;
  }

  function identity(value) {
    return value;
  }

  function appendLink(parent, text, href) {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = text;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    parent.appendChild(anchor);
  }

  /* ------------------------------------------------------------------------
     4. Dynamic entries (add / remove / numbering)
     ------------------------------------------------------------------------ */
  function getList(type) {
    return byId(SECTIONS[type].listId);
  }

  function clearEntryFields(node) {
    node.querySelectorAll('[data-field]').forEach((field) => {
      field.value = '';
    });
  }

  function fillEntry(node, values) {
    node.querySelectorAll('[data-field]').forEach((field) => {
      const value = values ? values[field.dataset.field] : '';
      field.value = asString(value);
    });
  }

  function renumberEntries(type) {
    const list = getList(type);
    if (!list) return;
    list.querySelectorAll('.entry-item').forEach((item, index) => {
      const number = item.querySelector('.entry-item__number');
      if (number) number.textContent = String(index + 1);
    });
  }

  function capturePrototypes() {
    Object.keys(SECTIONS).forEach((type) => {
      const config = SECTIONS[type];
      const template = byId(config.templateId);
      let prototype = null;

      if (template && template.content && template.content.firstElementChild) {
        prototype = template.content.firstElementChild.cloneNode(true);
      } else {
        const list = getList(type);
        const firstEntry = list ? list.querySelector('.entry-item') : null;
        if (firstEntry) {
          prototype = firstEntry.cloneNode(true);
          clearEntryFields(prototype);
          prototype.querySelectorAll('.field-error').forEach((node) => node.remove());
        }
      }
      state.prototypes[type] = prototype;
    });
  }

  function createEntry(type, values) {
    const prototype = state.prototypes[type];
    if (!prototype) return null;
    const node = prototype.cloneNode(true);
    fillEntry(node, values);
    return node;
  }

  /* Replaces all entries of a section with the given items (at least one entry stays). */
  function setEntries(type, items) {
    const list = getList(type);
    if (!list || !state.prototypes[type]) return;
    list.replaceChildren();
    const source = items.length ? items : [{}];
    source.forEach((values) => {
      const node = createEntry(type, values);
      if (node) list.appendChild(node);
    });
    renumberEntries(type);
  }

  function addEntry(type) {
    const list = getList(type);
    const node = createEntry(type, {});
    if (!list || !node) return;
    list.appendChild(node);
    renumberEntries(type);
    const firstField = node.querySelector('input, select, textarea');
    if (firstField) firstField.focus();
    renderPreview();
    scheduleSave();
  }

  function removeEntry(button) {
    const item = button.closest('.entry-item');
    const list = item ? item.parentElement : null;
    if (!item || !list) return;

    const type = button.dataset.remove || list.dataset.entryType;
    if (!type || !SECTIONS[type]) return;

    const items = list.querySelectorAll('.entry-item');
    if (items.length <= 1) {
      // Keep one empty entry available: clear it instead of removing it.
      fillEntry(item, {});
      clearErrorsIn(item);
    } else {
      item.remove();
    }

    renumberEntries(type);
    renderPreview();
    scheduleSave();

    const addButton = document.querySelector('[data-add="' + type + '"]');
    if (addButton) addButton.focus();
  }

  /* ------------------------------------------------------------------------
     5. Reading form data
     ------------------------------------------------------------------------ */
  function collectEntries(type) {
    const list = getList(type);
    if (!list) return [];
    return Array.from(list.querySelectorAll('.entry-item')).map((item) => {
      const values = {};
      item.querySelectorAll('[data-field]').forEach((field) => {
        values[field.dataset.field] = field.value.trim();
      });
      return values;
    });
  }

  function collectData() {
    const personal = {};
    PERSONAL_FIELDS.forEach((id) => {
      const field = byId(id);
      personal[id] = field ? field.value.trim() : '';
    });

    const data = { version: 1, personal: personal };
    Object.keys(SECTIONS).forEach((type) => {
      data[SECTIONS[type].storageKey] = collectEntries(type);
    });
    return data;
  }

  function hasAnyData(data) {
    if (Object.values(data.personal).some((value) => Boolean(value))) return true;
    return Object.keys(SECTIONS).some((type) => {
      const config = SECTIONS[type];
      return data[config.storageKey].some(config.hasContent);
    });
  }

  /* ------------------------------------------------------------------------
     6. Validation
     ------------------------------------------------------------------------ */
  function getFieldError(field, strict) {
    const value = field.value.trim();

    if (field.id === 'fullName') {
      return strict && !value ? 'Please enter your full name.' : '';
    }
    if (!value) return '';

    if (field.id === 'email') {
      return EMAIL_PATTERN.test(value) ? '' : 'Please enter a valid email address.';
    }
    if (field.id === 'phone') {
      return isValidPhone(value) ? '' : 'Please enter a valid phone number.';
    }
    if (field.matches('#linkedin, #website, .project-link')) {
      return normalizeUrl(value) ? '' : 'Please enter a valid web address, for example https://example.com';
    }
    if (field.matches('.education-start-year, .education-end-year, .certification-year')) {
      if (!isValidYear(value)) return 'Please enter a year between 1900 and 2100.';
      if (field.matches('.education-end-year')) {
        const startField = field.closest('.entry-item').querySelector('.education-start-year');
        const start = startField ? startField.value.trim() : '';
        if (isValidYear(start) && Number(value) < Number(start)) {
          return 'End year cannot be before the start year.';
        }
      }
      return '';
    }
    if (field.matches('.experience-end-date')) {
      const startField = field.closest('.entry-item').querySelector('.experience-start-date');
      const start = startField ? startField.value.trim() : '';
      const monthPattern = /^\d{4}-\d{2}$/;
      if (monthPattern.test(start) && monthPattern.test(value) && value < start) {
        return 'End date cannot be before the start date.';
      }
    }
    return '';
  }

  function clearFieldError(field) {
    const wrapper = field.closest('.form-field');
    if (wrapper) {
      wrapper.querySelectorAll('.field-error').forEach((node) => node.remove());
    }
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  }

  function setFieldError(field, message) {
    clearFieldError(field);
    const wrapper = field.closest('.form-field');
    if (!wrapper) return;

    state.errorCounter += 1;
    const errorElement = makeElement('p', 'field-error', message);
    errorElement.id = 'fieldError' + state.errorCounter;
    errorElement.setAttribute('role', 'alert');
    errorElement.style.margin = '0';
    errorElement.style.fontSize = '0.85rem';
    errorElement.style.fontWeight = '600';
    errorElement.style.color = 'var(--color-danger)';
    wrapper.appendChild(errorElement);

    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', errorElement.id);
  }

  function validateField(field, strict) {
    const message = getFieldError(field, strict);
    if (message) {
      setFieldError(field, message);
      return false;
    }
    clearFieldError(field);
    return true;
  }

  function clearErrorsIn(root) {
    root.querySelectorAll('.field-error').forEach((node) => node.remove());
    root.querySelectorAll('[aria-invalid]').forEach((field) => {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
    });
  }

  /* Validates the whole form. Returns the first invalid field, or null. */
  function validateForm() {
    clearErrorsIn(state.form);
    let firstInvalid = null;
    state.form.querySelectorAll(VALIDATED_SELECTOR).forEach((field) => {
      if (!validateField(field, true) && !firstInvalid) {
        firstInvalid = field;
      }
    });
    return firstInvalid;
  }

  /* ------------------------------------------------------------------------
     7. CV preview rendering
     ------------------------------------------------------------------------ */
  function buildEducationItem(item) {
    const article = makeElement('article', 'cv-item');
    article.appendChild(makeElement('h5', 'cv-item__title', item.degree || item.institution));
    if (item.degree && item.institution) {
      article.appendChild(makeElement('p', 'cv-item__subtitle', item.institution));
    }
    const dates = formatRange(item.startYear, item.endYear, identity);
    if (dates) article.appendChild(makeElement('p', 'cv-item__date', dates));
    if (item.description) article.appendChild(makeElement('p', 'cv-item__text', item.description));
    return article;
  }

  function buildExperienceItem(item) {
    const article = makeElement('article', 'cv-item');
    article.appendChild(makeElement('h5', 'cv-item__title', item.jobTitle || item.company));
    if (item.jobTitle && item.company) {
      article.appendChild(makeElement('p', 'cv-item__subtitle', item.company));
    }
    const dates = formatRange(item.startDate, item.endDate, formatMonth);
    if (dates) article.appendChild(makeElement('p', 'cv-item__date', dates));
    if (item.description) article.appendChild(makeElement('p', 'cv-item__text', item.description));
    return article;
  }

  function buildSkillItem(item) {
    const text = item.level ? item.name + ' (' + item.level + ')' : item.name;
    return makeElement('li', 'cv-tag', text);
  }

  function buildLanguageItem(item) {
    const text = item.proficiency ? item.name + ' (' + item.proficiency + ')' : item.name;
    return makeElement('li', 'cv-tag', text);
  }

  function buildProjectItem(item) {
    const article = makeElement('article', 'cv-item');
    article.appendChild(makeElement('h5', 'cv-item__title', item.name || 'Project'));
    if (item.description) article.appendChild(makeElement('p', 'cv-item__text', item.description));
    if (item.link) {
      const linkLine = makeElement('p', 'cv-item__link');
      const href = normalizeUrl(item.link);
      if (href) {
        appendLink(linkLine, displayUrl(item.link), href);
      } else {
        linkLine.textContent = item.link;
      }
      article.appendChild(linkLine);
    }
    return article;
  }

  function buildCertificationItem(item) {
    const article = makeElement('article', 'cv-item');
    article.appendChild(makeElement('h5', 'cv-item__title', item.name || item.organization));
    if (item.name && item.organization) {
      article.appendChild(makeElement('p', 'cv-item__subtitle', item.organization));
    }
    if (item.year) article.appendChild(makeElement('p', 'cv-item__date', item.year));
    return article;
  }

  function renderContactItem(id, text, href, hasData) {
    const element = byId(id);
    if (!element) return;
    element.replaceChildren();

    if (text) {
      element.hidden = false;
      if (href) {
        appendLink(element, text, href);
      } else {
        element.textContent = text;
      }
    } else if (hasData) {
      element.hidden = true;
    } else {
      element.hidden = false;
      element.textContent = state.defaultTexts[id] || '';
    }
  }

  function renderHeader(personal, hasData) {
    const nameElement = byId('previewFullName');
    if (nameElement) {
      nameElement.textContent = personal.fullName || state.defaultTexts.previewFullName || '';
    }

    const titleElement = byId('previewProfessionalTitle');
    if (titleElement) {
      if (personal.professionalTitle) {
        titleElement.textContent = personal.professionalTitle;
        titleElement.hidden = false;
      } else if (hasData) {
        titleElement.textContent = '';
        titleElement.hidden = true;
      } else {
        titleElement.textContent = state.defaultTexts.previewProfessionalTitle || '';
        titleElement.hidden = false;
      }
    }

    const phoneHref = isValidPhone(personal.phone)
      ? 'tel:' + personal.phone.replace(/[^\d+]/g, '')
      : null;
    const emailHref = EMAIL_PATTERN.test(personal.email) ? 'mailto:' + personal.email : null;
    const linkedinHref = normalizeUrl(personal.linkedin);
    const websiteHref = normalizeUrl(personal.website);

    renderContactItem('previewPhone', personal.phone, phoneHref, hasData);
    renderContactItem('previewEmail', personal.email, emailHref, hasData);
    renderContactItem('previewAddress', personal.address, null, hasData);
    renderContactItem(
      'previewLinkedin',
      personal.linkedin ? displayUrl(personal.linkedin) : '',
      linkedinHref,
      hasData
    );
    renderContactItem(
      'previewWebsite',
      personal.website ? displayUrl(personal.website) : '',
      websiteHref,
      hasData
    );

    const contactList = byId('previewContact');
    if (contactList) {
      const hasContact = Boolean(
        personal.phone || personal.email || personal.address ||
        personal.linkedin || personal.website
      );
      contactList.hidden = hasData && !hasContact;
    }
  }

  function renderSummary(personal, hasData) {
    const section = byId('previewSummarySection');
    const summary = byId('previewSummary');
    if (!summary) return;

    if (personal.summary) {
      summary.textContent = personal.summary;
      if (section) section.hidden = false;
    } else if (hasData) {
      summary.textContent = '';
      if (section) section.hidden = true;
    } else {
      summary.textContent = state.defaultTexts.previewSummary || '';
      if (section) section.hidden = false;
    }
  }

  function renderSection(type, items, hasData) {
    const config = SECTIONS[type];
    const container = byId(config.previewListId);
    const section = byId(config.previewSectionId);
    if (!container) return;

    const visibleItems = items.filter(config.hasContent);
    container.replaceChildren();

    if (visibleItems.length) {
      visibleItems.forEach((item) => container.appendChild(config.build(item)));
      if (section) section.hidden = false;
    } else if (hasData) {
      if (section) section.hidden = true;
    } else {
      (state.placeholderNodes[type] || []).forEach((node) => {
        container.appendChild(node.cloneNode(true));
      });
      if (section) section.hidden = false;
    }
  }

  function renderPreview() {
    const data = collectData();
    const hasData = hasAnyData(data);

    renderHeader(data.personal, hasData);
    renderSummary(data.personal, hasData);
    Object.keys(SECTIONS).forEach((type) => {
      renderSection(type, data[SECTIONS[type].storageKey], hasData);
    });
  }

  function capturePreviewDefaults() {
    PREVIEW_TEXT_IDS.forEach((id) => {
      const element = byId(id);
      if (element) state.defaultTexts[id] = element.textContent.trim();
    });
    Object.keys(SECTIONS).forEach((type) => {
      const container = byId(SECTIONS[type].previewListId);
      state.placeholderNodes[type] = container
        ? Array.from(container.children).map((node) => node.cloneNode(true))
        : [];
    });
  }

  /* ------------------------------------------------------------------------
     8. Saving & loading (localStorage only)
     ------------------------------------------------------------------------ */
  function saveData() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(collectData()));
    } catch (error) {
      // Storage may be unavailable (private mode or quota). The app keeps working.
    }
  }

  function scheduleSave() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(saveData, SAVE_DELAY_MS);
  }

  function flushSave() {
    window.clearTimeout(state.saveTimer);
    saveData();
  }

  function applyData(data) {
    const personal = data.personal && typeof data.personal === 'object' ? data.personal : {};
    PERSONAL_FIELDS.forEach((id) => {
      const field = byId(id);
      if (field) field.value = asString(personal[id]);
    });

    Object.keys(SECTIONS).forEach((type) => {
      const saved = data[SECTIONS[type].storageKey];
      const items = Array.isArray(saved)
        ? saved.filter((item) => item && typeof item === 'object')
        : [];
      setEntries(type, items);
    });
  }

  function loadData() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return false;
      applyData(data);
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeSavedData() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // Ignore storage errors.
    }
  }

  /* ------------------------------------------------------------------------
     9. Main actions
     ------------------------------------------------------------------------ */
  function handlePreviewClick() {
    const firstInvalid = validateForm();
    renderPreview();
    flushSave();

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const previewSection = byId('previewSection');
    if (!previewSection) return;
    previewSection.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start'
    });

    const heading = byId('previewHeading');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }

  function handleClearClick() {
    const confirmed = window.confirm(
      'Clear all CV information? This will delete everything you entered and cannot be undone.'
    );
    if (!confirmed) return;

    window.clearTimeout(state.saveTimer);
    state.form.reset();
    PERSONAL_FIELDS.forEach((id) => {
      const field = byId(id);
      if (field) field.value = '';
    });
    Object.keys(SECTIONS).forEach((type) => setEntries(type, []));
    clearErrorsIn(state.form);
    removeSavedData();
    renderPreview();

    const nameField = byId('fullName');
    if (nameField) nameField.focus();
  }

  /* ------------------------------------------------------------------------
     10. Event handlers
     ------------------------------------------------------------------------ */
  function handleFormInput(event) {
    const field = event.target;
    if (field.matches && field.getAttribute('aria-invalid') === 'true') {
      clearFieldError(field);
    }
    renderPreview();
    scheduleSave();
  }

  function handleFormFocusOut(event) {
    const field = event.target;
    if (!field.matches || !field.matches(VALIDATED_SELECTOR)) return;

    const entry = field.closest('.entry-item');
    const fields = entry ? entry.querySelectorAll(VALIDATED_SELECTOR) : [field];
    fields.forEach((item) => validateField(item, false));
  }

  function handleFormClick(event) {
    const button = event.target.closest ? event.target.closest('button') : null;
    if (!button || !state.form.contains(button)) return;

    if (button.matches('[data-add]')) {
      const type = button.dataset.add;
      if (SECTIONS[type]) addEntry(type);
    } else if (button.matches('.remove-entry-btn')) {
      removeEntry(button);
    } else if (button.id === 'previewCvBtn') {
      handlePreviewClick();
    } else if (button.id === 'clearFormBtn') {
      handleClearClick();
    }
  }

  function bindEvents() {
    state.form.addEventListener('input', handleFormInput);
    state.form.addEventListener('change', handleFormInput);
    state.form.addEventListener('focusout', handleFormFocusOut);
    state.form.addEventListener('click', handleFormClick);
    state.form.addEventListener('submit', (event) => event.preventDefault());

    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave();
    });
  }

  /* ------------------------------------------------------------------------
     11. Navigation highlight (uses the existing nav links)
     ------------------------------------------------------------------------ */
  function setActiveNavLink(links, activeLink) {
    links.forEach((link) => {
      if (link === activeLink) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    const nav = byId('sectionNav');
    if (nav && activeLink && nav.scrollWidth > nav.clientWidth) {
      const navRect = nav.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      nav.scrollLeft += linkRect.left - navRect.left - (nav.clientWidth - linkRect.width) / 2;
    }
  }

  function initNavigation() {
    const links = Array.from(document.querySelectorAll('.section-nav__link'));
    if (!links.length) return;

    links.forEach((link) => {
      link.addEventListener('click', () => setActiveNavLink(links, link));
    });

    if (!('IntersectionObserver' in window)) return;

    const targets = new Map();
    links.forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (href.charAt(0) !== '#') return;
      const target = byId(href.slice(1));
      if (target) targets.set(target, link);
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveNavLink(links, targets.get(entry.target));
          }
        });
      },
      { rootMargin: '-35% 0px -55% 0px', threshold: 0 }
    );
    targets.forEach((link, target) => observer.observe(target));
  }

  /* ------------------------------------------------------------------------
     12. Initialization
     ------------------------------------------------------------------------ */
  function init() {
    state.form = byId('cvForm');
    if (!state.form) return;

    const footerYear = byId('footerYear');
    if (footerYear) footerYear.textContent = String(new Date().getFullYear());

    capturePrototypes();
    capturePreviewDefaults();
    loadData();
    Object.keys(SECTIONS).forEach(renumberEntries);

    bindEvents();
    initNavigation();
    renderPreview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

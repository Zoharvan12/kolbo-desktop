// ============================================================================
// Kolbo Studio Desktop - Language Selector UI Controller
// ============================================================================
// Wires up the language selector button and dropdown in settings.
// Depends on: i18n.js (must be loaded first via script tag)
// ============================================================================

(function () {
  'use strict';

  function initLanguageSelector() {
    var toggleBtn  = document.getElementById('lang-toggle-btn');
    var dropdown   = document.getElementById('lang-dropdown');
    var flagBadge = document.getElementById('current-lang-flag');

    if (!toggleBtn || !dropdown) return;

    var i18n = window.KolboI18n;
    if (!i18n) return;

    document.body.appendChild(dropdown);

    i18n.renderLanguageSelector('lang-dropdown');

    var header = document.createElement('div');
    header.className = 'lang-dropdown-header';
    header.setAttribute('data-i18n', 'language.selectLanguage');
    header.textContent = i18n.t('language.selectLanguage');
    dropdown.insertBefore(header, dropdown.firstChild);

    function updateFlagBadge() {
      var lang = i18n.getCurrentLang();
      var langs = i18n.getSupportedLanguages();
      for (var i = 0; i < langs.length; i++) {
        if (langs[i].code === lang) {
          if (flagBadge) {
            flagBadge.className = 'fi fi-' + langs[i].countryCode;
          }
          break;
        }
      }
    }

    updateFlagBadge();

    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = !dropdown.classList.contains('hidden');
      if (isOpen) {
        dropdown.classList.add('hidden');
        toggleBtn.classList.remove('lang-active');
      } else {
        document.body.appendChild(dropdown);
        var rect = toggleBtn.getBoundingClientRect();
        var dropdownWidth = 200;
        dropdown.style.top  = (rect.bottom + 6) + 'px';
        dropdown.style.left = (rect.right - dropdownWidth) + 'px';
        dropdown.style.right = 'auto';
        dropdown.classList.remove('hidden');
        toggleBtn.classList.add('lang-active');
        var opts = dropdown.querySelectorAll('.lang-option');
        var current = i18n.getCurrentLang();
        for (var j = 0; j < opts.length; j++) {
          opts[j].classList.toggle('lang-option-active', opts[j].getAttribute('data-lang') === current);
        }
      }
    });

    document.addEventListener('click', function (e) {
      if (!dropdown.classList.contains('hidden')) {
        if (!toggleBtn.contains(e.target) && !dropdown.contains(e.target)) {
          dropdown.classList.add('hidden');
          toggleBtn.classList.remove('lang-active');
        }
      }
    });

    window.addEventListener('i18nLanguageChanged', function (e) {
      updateFlagBadge();
      var opts = dropdown.querySelectorAll('.lang-option');
      var newLang = e.detail && e.detail.lang;
      for (var k = 0; k < opts.length; k++) {
        opts[k].classList.toggle('lang-option-active', opts[k].getAttribute('data-lang') === newLang);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLanguageSelector);
  } else {
    initLanguageSelector();
  }
}());

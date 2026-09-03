// ============================================================================
// Kolbo Studio Desktop - Internationalization (i18n) Engine
// ============================================================================
// Supports 12 languages including RTL (Hebrew, Arabic).
// Uses localStorage for persistence + separate locale JSON files.
//
// Usage:
//   window.t('key')                     → translated string
//   window.t('key', { count: 5 })      → with variable interpolation
//   window.KolboI18n.setLanguage('he') → switch language + apply to DOM
//   data-i18n="key"                    → auto-translated text content
//   data-i18n-placeholder="key"         → auto-translated placeholder
//   data-i18n-title="key"              → auto-translated title attribute
//   data-i18n-aria="key"               → auto-translated aria-label
// ============================================================================

window.KolboI18n = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  var RTL_LANGUAGES = ['he', 'ar'];

  var SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English',    countryCode: 'us', nativeName: 'English'     },
    { code: 'he', name: 'Hebrew',     countryCode: 'il', nativeName: 'עברית',     rtl: true },
    { code: 'ar', name: 'Arabic',     countryCode: 'sa', nativeName: 'العربية',   rtl: true },
    { code: 'ru', name: 'Russian',    countryCode: 'ru', nativeName: 'Русский'   },
    { code: 'es', name: 'Spanish',    countryCode: 'es', nativeName: 'Español'   },
    { code: 'fr', name: 'French',     countryCode: 'fr', nativeName: 'Français'  },
    { code: 'de', name: 'German',     countryCode: 'de', nativeName: 'Deutsch'   },
    { code: 'zh', name: 'Chinese',    countryCode: 'cn', nativeName: '中文'       },
    { code: 'pt', name: 'Portuguese', countryCode: 'br', nativeName: 'Português' },
    { code: 'ja', name: 'Japanese',   countryCode: 'jp', nativeName: '日本語'     },
    { code: 'ko', name: 'Korean',     countryCode: 'kr', nativeName: '한국어'     },
    { code: 'hi', name: 'Hindi',      countryCode: 'in', nativeName: 'हिंदी'     }
  ];

  var DEFAULT_LANG = 'en';
  var STORAGE_KEY  = 'kolbo_desktop_language';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  var currentLang   = DEFAULT_LANG;
  var translations  = {};
  var enFallback    = {};
  var localeCache   = {};
  var isInitialized = false;

  // ---------------------------------------------------------------------------
  // Embedded English translations (always available, no XHR needed)
  // ---------------------------------------------------------------------------
  var EN_TRANSLATIONS = {
    auth: {
      welcomeBack: "Welcome Back",
      signInSubtitle: "Sign in to access your media library",
      continueWithGoogle: "Continue with Google",
      orContinueWithEmail: "or continue with email",
      emailPlaceholder: "Email",
      passwordPlaceholder: "Password",
      togglePasswordVisibility: "Toggle password visibility",
      signIn: "Sign In",
      termsPrefix: "By signing in, you agree to our",
      termsOfService: "Terms of Service",
      termsAnd: "and",
      privacyPolicy: "Privacy Policy",
      copyright: "© 2025 Kolbo.AI",
      signingIn: "Signing in...",
      loginFailed: "Login failed",
      loginFailedRetry: "Login failed. Please try again.",
      openingGoogle: "Opening Google Sign-In...",
      googleSuccess: "✓ Successfully signed in with Google!",
      googleFailed: "Google login failed",
      logoutTitle: "Log Out",
      logoutConfirm: "Are you sure you want to log out? You will need to sign in again.",
      logoutSuccess: "Successfully logged out",
      emailRequired: "Please enter email and password"
    },
    dialog: {
      cancel: "Cancel",
      ok: "OK",
      confirm: "Confirm",
      yes: "Yes",
      no: "No"
    },
    loading: {
      yourMedia: "Loading your media...",
      media: "Loading media...",
      more: "Loading more...",
      webApp: "Loading Kolbo Web App..."
    },
    header: {
      brand: "Kolbo Studio",
      refresh: "Refresh",
      updateAvailable: "Update Available",
      downloadingUpdate: "Downloading Update…",
      restartToUpdate: "Restart to Update",
      settings: "Settings",
      logout: "Log Out",
      logoutBtn: "Log Out",
      minimize: "Minimize",
      maximize: "Maximize",
      close: "Close",
      language: "Change interface language"
    },
    tabs: {
      kolboAI: "Kolbo.AI",
      kolboCode: "Kolbo Code",
      myMedia: "My Media",
      fileBridge: "File Bridge",
      formatFactory: "Format Factory",
      downloader: "Downloader",
      quickTools: "Quick Tools",
      timelineSync: "Timeline Sync",
      newTab: "New Tab",
      splitView: "Split View",
      loadingFileBridge: "Loading File Bridge...",
      loadingKolbo: "Loading Kolbo Web App..."
    },
    webapp: {
      back: "Go Back",
      forward: "Go Forward",
      refreshPage: "Refresh Page",
      zoomOut: "Zoom Out (Ctrl+-)",
      zoomIn: "Zoom In (Ctrl++)",
      takeScreenshot: "Take Screenshot (Ctrl+Shift+5)",
      splitPresets: {
        equal: "Equal Split (50/50)",
        smallLeft: "Small Left (25/75)",
        largeLeft: "Large Left (70/30)"
      }
    },
    media: {
      itemsCount: "{{count}} items",
      noItems: "0 items",
      allProjects: "All Projects",
      searchProjects: "Search projects...",
      sortByDate: "Date",
      sortByName: "Name",
      noMedia: "No media found",
      noMediaSubtitle: "Your Kolbo.AI generated media will appear here",
      failedToLoad: "Failed to load media",
      pleaseRetry: "Please try again",
      retry: "Retry",
      unnamedProject: "Unnamed Project",
      filters: {
        all: "All",
        videos: "Videos",
        images: "Images",
        audio: "Audio",
        favorites: "Favorites"
      },
      subcategories: {
        all: "All",
        aiGenerated: "AI Generated",
        trainingLab: "Training Lab",
        edited: "Edited",
        uploaded: "Uploaded",
        favorites: "Favorites",
        textToVideo: "Text to Video",
        imageToVideo: "Image to Video",
        lipsync: "Lipsync",
        videoToVideo: "Video to Video",
        textToSpeech: "Text to Speech",
        music: "Music",
        textToSound: "Text to Sound"
      },
      typeBadge: {
        image: "Image",
        video: "Video",
        audio: "Audio",
        music: "Music",
        tts: "TTS",
        sfx: "SFX"
      },
      duration: "0:00 / {{duration}}"
    },
    settings: {
      title: "Settings",
      cacheManagement: {
        title: "Cache Management",
        description: "Downloaded media files are cached locally for quick access and drag-and-drop into video editors.",
        cacheSize: "Cache Size",
        currentStorage: "Current storage used by cached files",
        cacheLocation: "Cache Location",
        showInFolder: "Show in Folder",
        clearCache: "Clear Cache",
        clearCacheWarning: "Video editing projects using cached files will show \"Media Offline\" errors.",
        clearCacheDesc: "This will delete all downloaded media files from your computer.",
        clearAllCache: "Clear All Cache",
        cacheCleared: "Cache Cleared",
        deletedFiles: "Deleted {{count}} file(s).",
        newFilesWillDownload: "New files will be downloaded when you drag them to video editors.",
        clearing: "Clearing...",
        loading: "Loading...",
        notSet: "Not set"
      },
      general: {
        title: "General",
        description: "General app preferences and behavior.",
        launchOnStartup: "Launch on Startup",
        launchOnStartupDesc: "Automatically start Kolbo Studio when your computer boots",
        downloadFolder: "Download Folder",
        changeFolder: "Change Folder",
        uiScale: "UI Scale",
        uiScaleDesc: "Auto-detects your display scaling so buttons stay easy to click.",
        uiScaleAuto: "Auto (recommended)",
        uiScaleAutoDetected: "Detected display scaling: {{pct}}%. Buttons will look the same as on a 100% display.",
        uiScaleManual: "Manual override. Buttons will be {{pct}}% of design size."
      },
      formatFactory: {
        title: "Format Factory",
        description: "Configure how converted media files are saved and where they are stored.",
        outputLocation: "Output Location",
        chooseWhere: "Choose where converted files should be saved",
        sameAsSource: "Same as source",
        customFolder: "Custom folder",
        customOutputFolder: "Custom Output Folder",
        saveToCustomFolder: "Save to custom folder"
      },
      updates: {
        title: "Updates",
        description: "Keep Kolbo Studio up to date with the latest features and improvements.",
        currentVersion: "Current Version",
        checkForUpdates: "Check for Updates",
        checkingForUpdates: "Checking for updates...",
        checkNow: "Check Now",
        checking: "Checking...",
        upToDate: "Your app is up to date",
        updateAvailable: "Update Available!",
        versionReady: "Version {{version}} is ready to install",
        downloadUpdate: "Download Update",
        downloading: "Downloading...",
        downloaded: "Download complete! Check your Downloads folder.",
        restartInstall: "Restart & Install",
        downloadingProgress: "Downloading... {{percent}}%",
        downloadingProgressMb: "Downloading... {{percent}}% ({{mb}} MB / {{mbTotal}} MB)",
        downloadedToDownloads: "Installer downloaded to Downloads folder!",
        downloadFailed: "Failed to download update"
      },
      account: {
        title: "Account",
        currentPlan: "Current Plan",
        availableCredits: "Available Credits",
        purchaseCredits: "Purchase Credits",
        billingUsage: "Billing & Usage",
        billingDesc: "Manage subscription, billing, and view usage history",
        viewBilling: "View Billing"
      },
      about: {
        title: "About",
        kolboStudio: "Kolbo Studio",
        version: "Version {{version}}",
        discordCommunity: "Discord Community",
        discordDesc: "Get help from our community",
        joinDiscord: "Join Discord",
        emailSupport: "Email Support",
        supportEmail: "support@kolbo.ai"
      }
    },
    formatFactory: {
      addFiles: "Add Files",
      remove: "Remove",
      clearList: "Clear List",
      reset: "Reset",
      stop: "Stop",
      start: "Start",
      dragDrop: "Drag & Drop files here",
      or: "or",
      supportedFormats: "Supported: Video, Audio, Images",
      type: "Type",
      sourceFile: "Source File",
      outputFormat: "Output Format / Progress",
      pending: "Pending",
      video: "Video",
      audio: "Audio",
      picture: "Picture",
      chooseOutputFolder: "Choose Output Folder"
    },
    downloader: {
      downloadTo: "Download to:",
      change: "Change",
      open: "Open",
      pasteUrl: "Paste URL here (YouTube, Instagram, Twitter, TikTok, Facebook, LinkedIn...)",
      fetchInfo: "Fetch Info",
      supportedSites: "Supports: YouTube, Instagram, Twitter/X, TikTok, Facebook, LinkedIn, Vimeo, Twitch, and 1000+ more sites",
      fetchingMedia: "Fetching media info...",
      videoTitle: "Video Title",
      uploader: "Uploader",
      format: "Format:",
      formatMp4: "MP4 (Video)",
      formatMp3: "MP3 (Audio only)",
      quality: "Quality:",
      qualityBest: "Best Available",
      quality4k: "4K (2160p)",
      quality1080: "1080p",
      quality720: "720p",
      quality480: "480p",
      addToQueue: "Add to Queue",
      closePreview: "Close preview",
      downloadQueue: "Download Queue",
      queueItems: "{{count}} items",
      clear: "Clear",
      stopDownload: "Stop",
      startDownload: "Start Download",
      noDownloads: "No downloads yet",
      noDownloadsHint: "Paste a URL above and click \"Fetch Info\" to start",
      disclaimer: "Only download content you own or have permission to download. Respect copyright laws."
    },
    quickTools: {
      trimmer: {
        name: "Trimmer",
        desc: "Cut video or audio",
        dropzone: "Drop video or audio file here",
        or: "or",
        browseFiles: "Browse Files",
        supported: "Supports: MP4, MOV, MKV, WEBM, MP3, WAV, FLAC",
        saveTo: "Save to:",
        sameAsSource: "Same as source",
        change: "Change"
      },
      extractor: {
        name: "Audio Extractor",
        desc: "Extract audio",
        dropzone: "Drop video file here",
        or: "or",
        browseFiles: "Browse Files",
        supported: "Supports: MP4, MOV, MKV, WEBM",
        hint: "Extract audio track from any video file",
        saveTo: "Save to:",
        sameAsSource: "Same as source",
        change: "Change"
      },
      frameGrabber: {
        name: "Frame Grabber",
        desc: "Grab frames",
        dropzone: "Drop video file here",
        or: "or",
        browseFiles: "Browse Files",
        supported: "Supports: MP4, MOV, MKV, WEBM",
        hint: "Scrub through video and capture frames",
        saveTo: "Save to:",
        sameAsSource: "Same as source",
        change: "Change"
      },
      merger: {
        name: "Video Merger",
        desc: "Combine clips",
        dropzone: "Drop multiple video files here",
        or: "or",
        browseFiles: "Browse Files",
        supported: "Supports: MP4, MOV, MKV, WEBM",
        hint: "Combine multiple clips into one video",
        saveTo: "Save to:",
        sameAsFirst: "Same as first file",
        change: "Change"
      },
      sync: {
        name: "Timeline Sync",
        desc: "Sync cameras & recorders to a timeline",
        dropzone: "Drop all camera and audio recorder files here",
        or: "or",
        browseFiles: "Browse Files",
        hint: "Syncs by sound and exports an XML timeline for Premiere / Resolve",
        saveTo: "Save to:",
        sameAsFirst: "Same as first file",
        change: "Change",
        sync: "Sync",
        syncing: "Syncing by sound…",
        synced: "Synced",
        unsynced: "No match",
        reference: "reference",
        done: "Timeline XML saved",
        showInFolder: "Show in folder",
        importHint: "Premiere / Resolve: File → Import this XML",
        clearAll: "Clear All",
        addMore: "Add Files",
        noMatch: "Could not find matching audio between the files",
        saveXml: "Save Timeline XML…",
        reviewHint: "Review the offsets above, then save the timeline XML where you want it.",
        legend: "Blue = video · Green = audio · Outlined = reference"
      },
      cropper: {
        name: "Media Cropper",
        desc: "Crop video & images",
        dropzone: "Drop video or image file here",
        or: "or",
        browseFiles: "Browse Files",
        supported: "Supports: MP4, MOV, JPG, PNG, WEBP",
        hint: "Crop & resize for TikTok, Reels...",
        saveTo: "Save to:",
        sameAsSource: "Same as source",
        change: "Change"
      }
    },
    batch: {
      importToPremiere: "Import to Premiere",
      importing: "Importing...",
      download: "Download",
      downloading: "Downloading...",
      clear: "Clear",
      selected: "selected",
      noItemsSelected: "No items selected",
      noValidItems: "No valid items to download",
      preparingFiles: "Preparing files...",
      preparingN: "Preparing {{count}} file(s)...",
      sentToPremiere: "Sent {{count}} items to Premiere Pro",
      failedPremiere: "Failed to send to Premiere",
      failedImportPremiere: "Failed to import to Premiere",
      waitForDownloads: "Please wait — files are still downloading...",
      folderSelectFailed: "Failed to select folder",
      downloadFailed: "Download failed. Please try again.",
      noValidImport: "No valid items to import"
    },
    errors: {
      premiereNotDetected: "Kolbo Adobe Plugin Not Detected",
      premiereNotDetectedDesc: "Click OK to download files or install the plugin.",
      premiereNotDetectedDownload: "Click OK to download files to your computer.",
      terminalInitFailed: "Terminal init failed: {{error}}",
      terminalClassNotLoaded: "AgentTerminal class not loaded",
      dragFailed: "❌ Drag Failed: {{message}}"
    },
    common: {
      cancel: "Cancel",
      close: "Close",
      error: "Error",
      retry: "Retry",
      loading: "Loading...",
      success: "Success",
      or: "or",
      and: "and",
      ok: "OK"
    },
    language: {
      selectLanguage: "Select Language",
      current: "Language"
    }
  };

  // ---------------------------------------------------------------------------
  // JSON flattener: { a: { b: 'val' } } → { 'a.b': 'val' }
  // ---------------------------------------------------------------------------

  function flatten(obj, prefix) {
    var result = {};
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      var fullKey = prefix ? prefix + '.' + key : key;
      var val = obj[key];
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        var nested = flatten(val, fullKey);
        for (var k in nested) {
          result[k] = nested[k];
        }
      } else {
        result[fullKey] = val;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Locale loader - tries multiple paths for Electron compatibility
  // ---------------------------------------------------------------------------

  function loadLocaleSync(lang) {
    if (localeCache[lang]) {
      return localeCache[lang];
    }

    var paths = [
      'i18n/locales/' + lang + '.json',
      './i18n/locales/' + lang + '.json',
      '../renderer/i18n/locales/' + lang + '.json'
    ];

    for (var i = 0; i < paths.length; i++) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', paths[i], false);
        xhr.send(null);

        if (xhr.status === 200 || xhr.status === 0) {
          var data = JSON.parse(xhr.responseText);
          localeCache[lang] = flatten(data, '');
          console.log('[i18n] Loaded locale "' + lang + '" from ' + paths[i]);
          return localeCache[lang];
        }
      } catch (e) {
        // Continue to next path
      }
    }

    console.warn('[i18n] Failed to load locale "' + lang + '" from any path');
    return null;
  }

  // ---------------------------------------------------------------------------
  // Register locale data programmatically
  // ---------------------------------------------------------------------------

  function registerLocale(lang, data) {
    if (data) {
      localeCache[lang] = flatten(data, '');
    }
  }

  // ---------------------------------------------------------------------------
  // Core translate function
  // ---------------------------------------------------------------------------

  function t(key, vars) {
    var text = translations[key];
    if (text === undefined || text === null) {
      text = enFallback[key];
    }
    if (text === undefined || text === null) {
      text = key;
    }
    if (vars && typeof vars === 'object') {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          text = text.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), vars[k]);
        }
      }
    }
    return text;
  }

  // ---------------------------------------------------------------------------
  // Apply translations to DOM
  // ---------------------------------------------------------------------------

  function applyTranslations() {
    // Text content
    var elems = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < elems.length; i++) {
      var key = elems[i].getAttribute('data-i18n');
      var translated = t(key);
      if (translated && translated !== key) {
        elems[i].textContent = translated;
      }
    }
    // Placeholder
    var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < placeholders.length; j++) {
      var pKey = placeholders[j].getAttribute('data-i18n-placeholder');
      var pTranslated = t(pKey);
      if (pTranslated && pTranslated !== pKey) {
        placeholders[j].placeholder = pTranslated;
      }
    }
    // Title attribute
    var titles = document.querySelectorAll('[data-i18n-title]');
    for (var k = 0; k < titles.length; k++) {
      var tKey = titles[k].getAttribute('data-i18n-title');
      var tTranslated = t(tKey);
      if (tTranslated && tTranslated !== tKey) {
        titles[k].title = tTranslated;
      }
    }
    // aria-label
    var arias = document.querySelectorAll('[data-i18n-aria]');
    for (var m = 0; m < arias.length; m++) {
      var aKey = arias[m].getAttribute('data-i18n-aria');
      var aTranslated = t(aKey);
      if (aTranslated && aTranslated !== aKey) {
        arias[m].setAttribute('aria-label', aTranslated);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // RTL / direction
  // ---------------------------------------------------------------------------

  function isRTL(lang) {
    return RTL_LANGUAGES.indexOf(lang) !== -1;
  }

  function applyDirection(lang) {
    var rtl = isRTL(lang);
    document.documentElement.dir  = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.body.classList.toggle('rtl', rtl);
    document.body.classList.toggle('ltr', !rtl);

    // Flip header row
    var header = document.querySelector('.header');
    if (header) header.style.flexDirection = rtl ? 'row-reverse' : '';

    // Flip header-left (tabs)
    var headerLeft = document.querySelector('.header-left');
    if (headerLeft) headerLeft.style.flexDirection = rtl ? 'row-reverse' : '';

    // Flip header-actions
    var headerActions = document.querySelector('.header-actions');
    if (headerActions) headerActions.style.flexDirection = rtl ? 'row-reverse' : '';

    // Flip view-tabs
    var viewTabs = document.querySelector('.view-tabs');
    if (viewTabs) viewTabs.style.flexDirection = rtl ? 'row-reverse' : '';

    // Flip filters
    var filters = document.querySelector('.filters');
    if (filters) filters.style.flexDirection = rtl ? 'row-reverse' : '';

    var filtersLeft = document.querySelector('.filters-left');
    if (filtersLeft) filtersLeft.style.flexDirection = rtl ? 'row-reverse' : '';

    // Flip subcategory groups
    var subcatGroups = document.querySelectorAll('.subcategory-group');
    for (var sg = 0; sg < subcatGroups.length; sg++) {
      subcatGroups[sg].style.flexDirection = rtl ? 'row-reverse' : '';
      subcatGroups[sg].style.flexWrap = rtl ? 'wrap' : '';
    }

    // Flip auth card elements
    var authForm = document.querySelector('.auth-form');
    if (authForm) authForm.style.textAlign = rtl ? 'right' : '';

    // Flip project selector
    var projectDropdown = document.querySelector('.project-dropdown-trigger');
    if (projectDropdown) projectDropdown.style.flexDirection = rtl ? 'row-reverse' : '';

    // Flip project sort wrapper
    var projectSort = document.querySelector('.project-sort-wrapper');
    if (projectSort) projectSort.style.flexDirection = rtl ? 'row-reverse' : '';

    // Flip project list items
    var projectItems = document.querySelectorAll('.project-item');
    for (var pi = 0; pi < projectItems.length; pi++) {
      projectItems[pi].style.flexDirection = rtl ? 'row-reverse' : '';
    }

    // Flip settings items
    var settingsItems = document.querySelectorAll('.settings-item');
    for (var si = 0; si < settingsItems.length; si++) {
      settingsItems[si].style.flexDirection = rtl ? 'row-reverse' : '';
    }

    // Flip format factory toolbar
    var ffToolbar = document.querySelector('.ff-toolbar');
    if (ffToolbar) {
      var ffToolbarLeft = ffToolbar.querySelector('.ff-toolbar-left');
      var ffToolbarRight = ffToolbar.querySelector('.ff-toolbar-right');
      if (ffToolbarLeft) ffToolbarLeft.style.flexDirection = rtl ? 'row-reverse' : '';
      if (ffToolbarRight) ffToolbarRight.style.flexDirection = rtl ? 'row-reverse' : '';
    }

    // Flip FF sidebar categories
    var ffCats = document.querySelectorAll('.ff-category-btn');
    for (var fc = 0; fc < ffCats.length; fc++) {
      ffCats[fc].style.flexDirection = rtl ? 'row-reverse' : '';
    }

    // Flip downloader folder section
    var dlFolder = document.querySelector('.dl-folder-section');
    if (dlFolder) dlFolder.style.flexDirection = rtl ? 'row-reverse' : '';

    var dlFolderPath = document.querySelector('.dl-folder-path-wrapper');
    if (dlFolderPath) dlFolderPath.style.flexDirection = rtl ? 'row-reverse' : '';

    // Flip downloader preview options
    var dlOptions = document.querySelectorAll('.dl-option-group');
    for (var opt = 0; opt < dlOptions.length; opt++) {
      dlOptions[opt].style.flexDirection = rtl ? 'row-reverse' : '';
    }

    // Flip quick tools
    var qtCards = document.querySelectorAll('.qt-tool-card');
    for (var qc = 0; qc < qtCards.length; qc++) {
      qtCards[qc].style.textAlign = rtl ? 'right' : '';
    }

    // Flip quick tools output section
    var qtOutputSections = document.querySelectorAll('.qt-output-section');
    for (var qo = 0; qo < qtOutputSections.length; qo++) {
      qtOutputSections[qo].style.flexDirection = rtl ? 'row-reverse' : '';
    }

    // Flip quick tools dropzone
    var qtDropzones = document.querySelectorAll('.qt-dropzone');
    for (var qd = 0; qd < qtDropzones.length; qd++) {
      qtDropzones[qd].style.textAlign = rtl ? 'right' : '';
    }

    // Flip inputs for RTL
    var inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], textarea');
    for (var inp = 0; inp < inputs.length; inp++) {
      if (rtl) {
        inputs[inp].style.textAlign = 'right';
      } else {
        inputs[inp].style.textAlign = '';
      }
    }

    // Notify components that listen for direction changes
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('i18nDirectionChanged', {
        detail: { lang: lang, isRTL: rtl }
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Set language (public API) - async version
  // ---------------------------------------------------------------------------

  function setLanguage(lang) {
    console.log('[i18n] setLanguage called with:', lang);
    return _setLanguageAsync(lang);
  }

  function _setLanguageAsync(lang) {
    return new Promise(function(resolve) {
      // Validate
      var supported = false;
      for (var i = 0; i < SUPPORTED_LANGUAGES.length; i++) {
        if (SUPPORTED_LANGUAGES[i].code === lang) { supported = true; break; }
      }
      if (!supported) {
        console.warn('[i18n] Unsupported language "' + lang + '", falling back to en');
        lang = DEFAULT_LANG;
      }

      // For English, use embedded translations
      if (lang === DEFAULT_LANG) {
        translations = enFallback;
        console.log('[i18n] Using English');
        finishSetLanguage(lang);
        resolve(lang);
        return;
      }

      // Try to load locale file
      loadLocaleAsync(lang, function(loaded) {
        if (!loaded) {
          console.warn('[i18n] Locale file missing for "' + lang + '", using English');
          lang = DEFAULT_LANG;
          translations = enFallback;
        } else {
          // Merge: start from English fallback, overlay with loaded translations
          translations = {};
          for (var k in enFallback) {
            translations[k] = enFallback[k];
          }
          for (var k2 in loaded) {
            translations[k2] = loaded[k2];
          }
          console.log('[i18n] Loaded and merged locale "' + lang + '" with ' + Object.keys(loaded).length + ' keys');
        }
        finishSetLanguage(lang);
        resolve(lang);
      });
    });
  }

  function loadLocaleAsync(lang, callback) {
    // Get the base URL of the current page
    var baseUrl = window.location.href.replace(/\/[^\/]*$/, '');
    var paths = [
      baseUrl + '/i18n/locales/' + lang + '.json',
      baseUrl + '/renderer/i18n/locales/' + lang + '.json'
    ];

    var tried = 0;
    function tryNext() {
      if (tried >= paths.length) {
        callback(null);
        return;
      }
      fetch(paths[tried])
        .then(function(response) {
          if (response.ok) {
            return response.json();
          }
          throw new Error('Not found');
        })
        .then(function(data) {
          console.log('[i18n] Loaded locale from:', paths[tried]);
          callback(flatten(data, ''));
        })
        .catch(function() {
          tried++;
          tryNext();
        });
    }
    tryNext();
  }

  function finishSetLanguage(lang) {
    currentLang = lang;

    // Persist selection
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}

    // Apply direction
    applyDirection(lang);

    // Apply to DOM
    applyTranslations();

    // Notify
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('i18nLanguageChanged', {
        detail: { lang: lang, isRTL: isRTL(lang) }
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Initialize — called once at startup
  // ---------------------------------------------------------------------------

  function init() {
    // Use embedded English translations (no XHR needed)
    enFallback = flatten(EN_TRANSLATIONS, '');

    // Determine saved / preferred language
    var savedLang = DEFAULT_LANG;
    try { savedLang = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG; } catch (e) {}

    isInitialized = true;
    setLanguage(savedLang);
    return currentLang;
  }

  // ---------------------------------------------------------------------------
  // Language selector — renders flag + name buttons into a container element
  // ---------------------------------------------------------------------------

  function renderLanguageSelector(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var html = '';
    for (var i = 0; i < SUPPORTED_LANGUAGES.length; i++) {
      var lang = SUPPORTED_LANGUAGES[i];
      var isActive = lang.code === currentLang ? ' lang-option-active' : '';
      html += '<div class="lang-option' + isActive + '" data-lang="' + lang.code + '">' +
        '<span class="lang-flag fi fi-' + lang.countryCode + '"></span>' +
        '<span class="lang-name">' + lang.nativeName + '</span>' +
        '</div>';
    }
    container.innerHTML = html;

    // Event delegation
    container.addEventListener('click', function (e) {
      var option = e.target.closest('.lang-option');
      if (!option) return;
      var code = option.getAttribute('data-lang');
      if (code) {
        // Close dropdown first
        var dropdown = document.getElementById('lang-dropdown');
        if (dropdown) dropdown.classList.add('hidden');
        var toggleBtn = document.getElementById('lang-toggle-btn');
        if (toggleBtn) toggleBtn.classList.remove('lang-active');

        // Then set language
        setLanguage(code).then(function() {
          // Update active state in dropdown if still in DOM
          var opts = container.querySelectorAll('.lang-option');
          for (var j = 0; j < opts.length; j++) {
            opts[j].classList.toggle('lang-option-active', opts[j].getAttribute('data-lang') === code);
          }
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    init:                   init,
    t:                      t,
    setLanguage:            setLanguage,
    applyTranslations:      applyTranslations,
    renderLanguageSelector: renderLanguageSelector,
    registerLocale:        registerLocale,
    getCurrentLang:         function () { return currentLang; },
    getSupportedLanguages:  function () { return SUPPORTED_LANGUAGES; },
    isRTL:                  function () { return isRTL(currentLang); },
    RTL_LANGUAGES:          RTL_LANGUAGES,
    SUPPORTED_LANGUAGES:    SUPPORTED_LANGUAGES
  };
}());

// ---------------------------------------------------------------------------
// Global shorthand: window.t()
// ---------------------------------------------------------------------------
window.t = function (key, vars) {
  return window.KolboI18n ? window.KolboI18n.t(key, vars) : key;
};

// ---------------------------------------------------------------------------
// Auto-initialize: load translations as soon as the script runs
// ---------------------------------------------------------------------------
if (window.KolboI18n) {
  window.KolboI18n.init();
}

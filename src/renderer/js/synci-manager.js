// ============================================================================
// Kolbo.AI Adobe Plugin - Synci Music Library Manager
// ============================================================================
// Mirrors the kolbo-map Synci browser as a vanilla-JS CEP panel. The backend is
// shared — this is just another client of the public/auth /synci/* endpoints.
//
// Flows:
//   - Browse catalog on open (no query -> /catalog), search on query/filter.
//   - Filter rail: mood + genre chips (from /facets), BPM & duration ranges,
//     has-lyrics toggle.
//   - Track rows: artwork, meta, native <audio> preview, favorite heart,
//     quality picker + download->import into the timeline.
//   - Favorites + Downloaded tabs (auth) with a project selector.
//   - "From script": /analyze-script -> fill query + matching mood/genre chips.
//
// The brand name "Synci" is always rendered literally (never translated).
// ============================================================================

// Dock interaction tuning constants (fractions of the waveform width / seconds).
const DOCK_FULL_EPS = 0.005;  // in ≤ 0.5% and out ≥ 99.5% ⇒ treat as the full track
const DOCK_MIN_GAP  = 0.01;   // smallest allowed in→out gap
const DRAG_MOVE_PX  = 4;      // px of movement before a press becomes a drag-select
const DRAG_OUT_PX   = 6;      // px above/below the waveform that triggers drag-to-export
const LOOP_EPS_SEC  = 0.02;   // seconds before the out-point at which the selection loops

class SynciManager {
  constructor(adobeBridge, apiClient) {
    this.bridge = adobeBridge;
    this.api = apiClient;

    // Results / pagination
    this.tracks = [];
    this.offset = 0;
    this.hasMore = true;
    this.loading = false;
    this.section = 'browse';            // 'browse' | 'favorites' | 'downloaded'

    // Query + filters
    this.query = '';
    this.filters = Object.assign({}, SynciManager.DEFAULT_FILTERS);

    // Session caches
    this.facets = null;
    this.favorited = new Set();
    this._favIdsLoaded = false;

    // Prefs
    this.defaultQuality = localStorage.getItem('kolbo_synci_quality') || '320';
    this.favProjectId = localStorage.getItem('kolbo_synci_fav_project') || 'all';

    // Now-playing dock state (set on first play)
    this._dock = null;

    this._built = false;
    this._openPanel = null;             // 'mood' | 'genre' | 'filters' | null

    console.log('[Synci] SynciManager initialized');
  }

  static get CATALOG_PAGE()    { return 18; }
  static get SEARCH_PAGE()     { return 16; }
  static get TOP_FACETS()      { return 18; }
  static get MAX_TRACKS()      { return 400; }
  static get MEDIA_MAX_BYTES() { return 48 * 1024 * 1024; }  // stay under analyze-media's 50 MB cap
  static get AUDIO_MAX_SEC()   { return 600; }               // ~10 min In/Out cap

  // ── i18n helper (Synci brand stays literal) ──────────────────────────────
  t(key, vars) {
    if (typeof window.t === 'function') {
      const out = window.t(key, vars);
      if (out && out !== key) return out;
    }
    return (SynciManager.FALLBACK && SynciManager.FALLBACK[key]) || key;
  }

  isAuth() {
    return !!(this.api && this.api.isAuthenticated && this.api.isAuthenticated());
  }

  /** Login gate for auth-only actions. Returns true if allowed to proceed. */
  requireAuth() {
    if (this.isAuth()) return true;
    if (window.app && typeof window.app.showLoginScreen === 'function') {
      window.app.showLoginScreen();
    }
    return false;
  }

  /** Project id used to auto-tag new favorites/downloads (plugin's selection). */
  currentProjectId() {
    const sel = window.app && window.app.selectedProjectId;
    return (sel && sel !== 'all') ? sel : null;
  }

  // ==========================================================================
  // Activation / DOM build
  // ==========================================================================
  activate() {
    this._build();
    // Hydrate session caches lazily, then show initial results.
    if (!this.facets) this._loadFacets();
    if (this.isAuth() && !this._favIdsLoaded) this._loadFavoriteIds();
    if (this.tracks.length === 0 && !this.loading) {
      this.switchSection('browse', true);
    }
  }

  _build() {
    if (this._built) return;
    const root = document.getElementById('synci-view');
    if (!root) { console.warn('[Synci] #synci-view not found'); return; }

    root.innerHTML =
      '<div class="synci-panel">' +
        '<div class="synci-header">' +
          '<div class="synci-brand"><img class="synci-brand-logo" src="images/synci-logo-white.png" alt="Synci"><span class="synci-brand-sub">' + this._esc(this.t('synci.tagline')) + '</span></div>' +
        '</div>' +

        '<div class="synci-tabs">' +
          '<button class="synci-tab active" data-section="browse">' + this._esc(this.t('synci.tab.browse')) + '</button>' +
          '<button class="synci-tab" data-section="favorites">' + this._esc(this.t('synci.tab.favorites')) + '</button>' +
          '<button class="synci-tab" data-section="downloaded">' + this._esc(this.t('synci.tab.downloaded')) + '</button>' +
        '</div>' +

        '<div class="synci-searchbar">' +
          '<svg class="synci-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>' +
          '<input type="text" id="synci-search-input" class="synci-search-input" placeholder="' + this._escAttr(this.t('synci.search.placeholder')) + '">' +
          '<button id="synci-search-btn" class="synci-search-btn">' + this._esc(this.t('synci.search.go')) + '</button>' +
        '</div>' +

        '<div class="synci-toolbar">' +
          '<button class="synci-filter-toggle" data-panel="mood">' + this._esc(this.t('synci.filter.mood')) + '</button>' +
          '<button class="synci-filter-toggle" data-panel="genre">' + this._esc(this.t('synci.filter.genre')) + '</button>' +
          '<button class="synci-filter-toggle" data-panel="filters">' + this._esc(this.t('synci.filter.more')) + '</button>' +
          '<button id="synci-suggest-btn" class="synci-filter-toggle synci-script-toggle">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:3px"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"></path></svg>' +
            this._esc(this.t('synci.suggest')) + '</button>' +
          '<div class="synci-quality-default" title="' + this._escAttr(this.t('synci.quality.default')) + '">' +
            '<span class="synci-quality-default-label">' + this._esc(this.t('synci.quality.label')) + '</span>' +
            '<button id="synci-default-quality" class="synci-dd-trigger" type="button"><span id="synci-default-quality-text">' + this._esc(this._qualLabel(this.defaultQuality)) + '</span>' + SynciManager.CHEVRON + '</button>' +
          '</div>' +
          '<button id="synci-reset-btn" class="synci-reset-btn" title="' + this._escAttr(this.t('synci.filter.reset')) + '">' + this._esc(this.t('synci.filter.reset')) + '</button>' +
        '</div>' +

        '<div id="synci-active-chips" class="synci-active-chips"></div>' +

        '<div id="synci-panel-mood" class="synci-chip-panel hidden"></div>' +
        '<div id="synci-panel-genre" class="synci-chip-panel hidden"></div>' +
        '<div id="synci-panel-filters" class="synci-range-panel hidden">' +
          '<div class="synci-range-row">' +
            '<label>' + this._esc(this.t('synci.filter.bpm')) + ' <span id="synci-bpm-label" class="synci-range-val"></span></label>' +
            '<div class="synci-range-inputs"><input type="number" id="synci-bpm-min" class="synci-range-input" min="0" placeholder="min"> <span>–</span> <input type="number" id="synci-bpm-max" class="synci-range-input" min="0" placeholder="max"></div>' +
          '</div>' +
          '<div class="synci-range-row">' +
            '<label>' + this._esc(this.t('synci.filter.duration')) + ' <span id="synci-dur-label" class="synci-range-val"></span></label>' +
            '<div class="synci-range-inputs"><input type="number" id="synci-dur-min" class="synci-range-input" min="0" placeholder="min s"> <span>–</span> <input type="number" id="synci-dur-max" class="synci-range-input" min="0" placeholder="max s"></div>' +
          '</div>' +
          '<label class="synci-checkbox"><input type="checkbox" id="synci-has-lyrics"> ' + this._esc(this.t('synci.filter.hasLyrics')) + '</label>' +
          '<button id="synci-apply-filters" class="synci-apply-btn">' + this._esc(this.t('synci.filter.apply')) + '</button>' +
        '</div>' +

        '<div id="synci-project-bar" class="synci-project-bar hidden">' +
          '<label>' + this._esc(this.t('synci.projectScope')) + '</label>' +
          '<button id="synci-project-select" class="synci-dd-trigger synci-project-select" type="button"><span id="synci-project-text">' + this._esc(this.t('synci.allProjects')) + '</span>' + SynciManager.CHEVRON + '</button>' +
        '</div>' +

        '<div class="synci-results-wrap">' +
          '<div id="synci-results" class="synci-results"></div>' +
          '<div id="synci-loading" class="synci-loading hidden"><span class="synci-spinner synci-spinner-lg"></span><span class="synci-loading-text">' + this._esc(this.t('synci.loading')) + '</span></div>' +
        '</div>' +
        '<div id="synci-status" class="synci-status"></div>' +
        '<button id="synci-load-more" class="synci-load-more hidden">' + this._esc(this.t('synci.loadMore')) + '</button>' +

        // Now-playing dock (in/out selection + drag-to-timeline)
        '<div id="synci-dock" class="synci-dock hidden">' +
          '<div class="synci-dock-info">' +
            '<img id="synci-dock-art" class="synci-dock-art synci-dock-art-empty" draggable="true" alt="" title="' + this._escAttr(this.t('synci.dock.dragHint')) + '">' +
            '<div class="synci-dock-meta">' +
              '<div id="synci-dock-title" class="synci-dock-title"></div>' +
              '<div id="synci-dock-artist" class="synci-dock-artist"></div>' +
            '</div>' +
            '<button id="synci-dock-close" class="synci-dock-close" title="' + this._escAttr(this.t('synci.dock.close')) + '">&times;</button>' +
          '</div>' +
          '<div id="synci-dock-wave-wrap" class="synci-dock-wave-wrap">' +
            '<canvas id="synci-dock-wave" class="synci-dock-wave"></canvas>' +
            '<div id="synci-dock-mask-l" class="synci-dock-mask"></div>' +
            '<div id="synci-dock-mask-r" class="synci-dock-mask"></div>' +
            '<div id="synci-dock-region" class="synci-dock-region" title="' + this._escAttr(this.t('synci.dock.dragHint')) + '"></div>' +
            '<div id="synci-dock-in" class="synci-dock-handle" title="' + this._escAttr(this.t('synci.dock.in')) + '"></div>' +
            '<div id="synci-dock-out" class="synci-dock-handle" title="' + this._escAttr(this.t('synci.dock.out')) + '"></div>' +
          '</div>' +
          '<div class="synci-dock-controls">' +
            '<button id="synci-dock-play" class="synci-dock-play"><span class="synci-play-icon"></span></button>' +
            '<span id="synci-dock-time" class="synci-dock-time">0:00 / 0:00</span>' +
            '<span id="synci-dock-inout" class="synci-dock-inout"></span>' +
            '<span class="synci-dock-spacer"></span>' +
            '<button id="synci-dock-quality" class="synci-dd-trigger" type="button"><span id="synci-dock-quality-text">' + this._esc(this._qualLabel(this.defaultQuality)) + '</span>' + SynciManager.CHEVRON + '</button>' +
            '<button id="synci-dock-drag" class="synci-dock-drag" draggable="true" title="' + this._escAttr(this.t('synci.dock.actionHint')) + '">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' +
              '<span id="synci-dock-drag-label">' + this._esc(this.t('synci.dock.download')) + '</span>' +
            '</button>' +
          '</div>' +
          '<div id="synci-dock-loading" class="synci-dock-loading hidden"><span class="synci-spinner synci-spinner-lg"></span><span class="synci-dock-loading-text">' + this._esc(this.t('synci.dock.preparingShort')) + '</span></div>' +
          '<audio id="synci-dock-audio" preload="auto"></audio>' +
        '</div>' +

        // Script dialog
        '<div id="synci-script-dialog" class="synci-script-dialog hidden">' +
          '<div class="synci-script-box">' +
            '<div class="synci-script-title">' + this._esc(this.t('synci.script.title')) + '</div>' +
            '<textarea id="synci-script-text" class="synci-script-text" rows="6" placeholder="' + this._escAttr(this.t('synci.script.placeholder')) + '"></textarea>' +
            '<div class="synci-script-actions">' +
              '<button id="synci-script-cancel" class="synci-btn-ghost">' + this._esc(this.t('synci.script.cancel')) + '</button>' +
              '<button id="synci-script-run" class="synci-btn-primary">' + this._esc(this.t('synci.script.analyze')) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    this._wire();
    this._built = true;
  }

  _wire() {
    const root = document.getElementById('synci-view');

    // Tabs
    root.querySelectorAll('.synci-tab').forEach((btn) => {
      btn.addEventListener('click', () => this.switchSection(btn.dataset.section));
    });

    // Search
    const input = document.getElementById('synci-search-input');
    const searchBtn = document.getElementById('synci-search-btn');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._onSearchSubmit(); });
    if (searchBtn) searchBtn.addEventListener('click', () => this._onSearchSubmit());

    // Filter-panel toggles
    root.querySelectorAll('.synci-filter-toggle[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => this._togglePanel(btn.dataset.panel));
    });

    // Global default-quality selector (KolboDropdown)
    const defQual = document.getElementById('synci-default-quality');
    if (defQual) {
      defQual.addEventListener('click', () => {
        KolboDropdown.open({
          trigger: defQual,
          noAvatar: true,
          items: ['128', '320', 'wav'].map((q) => ({ id: q, label: this._qualLabel(q), selected: q === this.defaultQuality })),
          onSelect: (q) => {
            // Default quality = the option pre-selected when the per-row
            // download button opens its format menu.
            this.defaultQuality = q;
            localStorage.setItem('kolbo_synci_quality', q);
            const txt = document.getElementById('synci-default-quality-text');
            if (txt) txt.textContent = this._qualLabel(q);
          }
        });
      });
    }

    // Apply ranges / reset
    const apply = document.getElementById('synci-apply-filters');
    if (apply) apply.addEventListener('click', () => this._applyRangeFilters());
    const reset = document.getElementById('synci-reset-btn');
    if (reset) reset.addEventListener('click', () => this._resetAll());

    // AI suggest menu (script + media analysis)
    const suggestBtn = document.getElementById('synci-suggest-btn');
    if (suggestBtn) suggestBtn.addEventListener('click', () => this._openSuggestMenu(suggestBtn));
    const scriptCancel = document.getElementById('synci-script-cancel');
    if (scriptCancel) scriptCancel.addEventListener('click', () => this._closeScript());
    const scriptRun = document.getElementById('synci-script-run');
    if (scriptRun) scriptRun.addEventListener('click', () => this._runScript());

    // Project selector (favorites/downloaded scope) — KolboDropdown
    const projSel = document.getElementById('synci-project-select');
    if (projSel) projSel.addEventListener('click', () => this._openProjectMenu(projSel));

    // Load more + infinite scroll
    const more = document.getElementById('synci-load-more');
    if (more) more.addEventListener('click', () => this._loadNext());
    const results = document.getElementById('synci-results');
    if (results) results.addEventListener('scroll', () => this._onScroll());

    // Now-playing dock (in/out + drag-to-timeline)
    this._wireDock();
  }

  // ==========================================================================
  // Facets + favorites hydration
  // ==========================================================================
  async _loadFacets() {
    try {
      const res = await this.api.synciFacets();
      this.facets = {
        genres: Array.isArray(res && res.genres) ? res.genres : [],
        moods: Array.isArray(res && res.moods) ? res.moods : [],
        bpmRange: (res && res.bpmRange) || null,
        durationRange: (res && res.durationRange) || null
      };
      this._renderChipPanels();
      this._renderRangeBounds();
    } catch (err) {
      console.warn('[Synci] facets load failed:', err && err.message);
    }
  }

  async _loadFavoriteIds() {
    try {
      const ids = await this.api.synciListFavoriteIds();
      this.favorited = new Set(ids);
      this._favIdsLoaded = true;
      // Repaint hearts already on screen
      document.querySelectorAll('.synci-row[data-track-id]').forEach((row) => {
        const heart = row.querySelector('.synci-heart');
        if (heart) heart.classList.toggle('active', this.favorited.has(row.dataset.trackId));
      });
    } catch (err) {
      console.warn('[Synci] favorite ids load failed:', err && err.message);
    }
  }

  _facetValue(entry) {
    return typeof entry === 'string' ? entry : (entry && entry.value) || '';
  }

  _renderChipPanels() {
    if (!this.facets) return;
    const build = (panelId, list, kind) => {
      const panel = document.getElementById(panelId);
      if (!panel) return;
      const top = (list || []).slice(0, SynciManager.TOP_FACETS);
      panel.innerHTML = top.map((entry) => {
        const val = this._facetValue(entry);
        const selected = (this.filters[kind] || '').toLowerCase() === val.toLowerCase();
        return '<button class="synci-chip' + (selected ? ' selected' : '') + '" data-kind="' + kind + '" data-value="' + this._escAttr(val) + '">' + this._esc(val) + '</button>';
      }).join('');
      panel.querySelectorAll('.synci-chip').forEach((chip) => {
        chip.addEventListener('click', () => this._selectChip(chip.dataset.kind, chip.dataset.value));
      });
    };
    build('synci-panel-mood', this.facets.moods, 'mood');
    build('synci-panel-genre', this.facets.genres, 'genre');
  }

  _renderRangeBounds() {
    if (!this.facets) return;
    const bpm = this.facets.bpmRange;
    const dur = this.facets.durationRange;
    const bpmLabel = document.getElementById('synci-bpm-label');
    const durLabel = document.getElementById('synci-dur-label');
    if (bpm && bpmLabel) bpmLabel.textContent = '(' + bpm.min + '–' + bpm.max + ')';
    if (dur && durLabel) durLabel.textContent = '(' + Math.round(dur.min) + '–' + Math.round(dur.max) + 's)';
  }

  // ==========================================================================
  // Filter / search interactions
  // ==========================================================================
  _togglePanel(name) {
    this._openPanel = (this._openPanel === name) ? null : name;
    ['mood', 'genre', 'filters'].forEach((p) => {
      const el = document.getElementById('synci-panel-' + p);
      if (el) el.classList.toggle('hidden', this._openPanel !== p);
    });
    document.querySelectorAll('.synci-filter-toggle[data-panel]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.panel === this._openPanel);
    });
  }

  _selectChip(kind, value) {
    const cur = (this.filters[kind] || '').toLowerCase();
    this.filters[kind] = (cur === value.toLowerCase()) ? null : value;
    this._renderChipPanels();
    this._renderActiveChips();
    this._browseUI();
    this.runSearch();
  }

  _applyRangeFilters() {
    const num = (id) => {
      const v = parseFloat((document.getElementById(id) || {}).value);
      return isNaN(v) ? null : v;
    };
    this.filters.bpmMin = num('synci-bpm-min');
    this.filters.bpmMax = num('synci-bpm-max');
    this.filters.durationMin = num('synci-dur-min');
    this.filters.durationMax = num('synci-dur-max');
    const lyr = document.getElementById('synci-has-lyrics');
    this.filters.hasLyrics = !!(lyr && lyr.checked);
    this._togglePanel('filters');
    this._renderActiveChips();
    this._browseUI();
    this.runSearch();
  }

  _resetAll() {
    this.query = '';
    this.filters = Object.assign({}, SynciManager.DEFAULT_FILTERS);
    const input = document.getElementById('synci-search-input');
    if (input) input.value = '';
    ['synci-bpm-min', 'synci-bpm-max', 'synci-dur-min', 'synci-dur-max'].forEach((id) => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const lyr = document.getElementById('synci-has-lyrics'); if (lyr) lyr.checked = false;
    this._renderChipPanels();
    this._renderActiveChips();
    this._browseUI();
    this.runSearch();
  }

  _onSearchSubmit() {
    const input = document.getElementById('synci-search-input');
    this.query = (input && input.value || '').trim();
    this._browseUI();
    this.runSearch();
  }

  _renderActiveChips() {
    const box = document.getElementById('synci-active-chips');
    if (!box) return;
    const chips = [];
    if (this.query) chips.push({ label: this.t('synci.chip.search') + ': ' + this.query, clear: () => { this.query = ''; const i = document.getElementById('synci-search-input'); if (i) i.value = ''; } });
    if (this.filters.mood) chips.push({ label: this.t('synci.filter.mood') + ': ' + this.filters.mood, clear: () => { this.filters.mood = null; this._renderChipPanels(); } });
    if (this.filters.genre) chips.push({ label: this.t('synci.filter.genre') + ': ' + this.filters.genre, clear: () => { this.filters.genre = null; this._renderChipPanels(); } });
    if (this.filters.bpmMin != null || this.filters.bpmMax != null) chips.push({ label: 'BPM ' + (this.filters.bpmMin != null ? this.filters.bpmMin : '') + '–' + (this.filters.bpmMax != null ? this.filters.bpmMax : ''), clear: () => { this.filters.bpmMin = this.filters.bpmMax = null; } });
    if (this.filters.durationMin != null || this.filters.durationMax != null) chips.push({ label: this.t('synci.filter.duration') + ' ' + (this.filters.durationMin != null ? this.filters.durationMin : '') + '–' + (this.filters.durationMax != null ? this.filters.durationMax : '') + 's', clear: () => { this.filters.durationMin = this.filters.durationMax = null; } });
    if (this.filters.hasLyrics) chips.push({ label: this.t('synci.filter.hasLyrics'), clear: () => { this.filters.hasLyrics = false; const l = document.getElementById('synci-has-lyrics'); if (l) l.checked = false; } });

    box.innerHTML = '';
    chips.forEach((c) => {
      const el = document.createElement('span');
      el.className = 'synci-active-chip';
      el.innerHTML = this._esc(c.label) + ' <span class="synci-chip-x">×</span>';
      el.querySelector('.synci-chip-x').addEventListener('click', () => {
        c.clear(); this._renderActiveChips(); this._browseUI(); this.runSearch();
      });
      box.appendChild(el);
    });
  }

  // ==========================================================================
  // Section switching + fetching
  // ==========================================================================
  /** Update the tab/project-bar UI for the current section (no fetch). */
  _browseUI() {
    this.section = 'browse';
    document.querySelectorAll('.synci-tab').forEach((b) => b.classList.toggle('active', b.dataset.section === 'browse'));
    const projBar = document.getElementById('synci-project-bar');
    if (projBar) projBar.classList.add('hidden');
  }

  switchSection(section, force) {
    const prev = this.section;
    this.section = section;
    document.querySelectorAll('.synci-tab').forEach((b) => b.classList.toggle('active', b.dataset.section === section));
    const projBar = document.getElementById('synci-project-bar');
    if (projBar) projBar.classList.toggle('hidden', section === 'browse');

    if (section === 'browse') {
      // Entering browse from a list view (or first load) repopulates the
      // catalog/search; staying within browse leaves results untouched.
      if (force || prev !== 'browse') this.runSearch();
      return;
    }
    // favorites / downloaded require auth
    if (!this.requireAuth()) { this.switchSection('browse', true); return; }
    this._ensureProjectOptions();
    this._loadList(true);
  }

  _isPureBrowse() {
    const f = this.filters;
    return !this.query && !f.mood && !f.genre &&
      f.bpmMin == null && f.bpmMax == null &&
      f.durationMin == null && f.durationMax == null && !f.hasLyrics;
  }

  _buildSearchParams() {
    const f = this.filters;
    const params = {};
    if (this.query) params.query = this.query;
    if (f.mood) params.mood = f.mood;
    if (f.genre) params.genre = f.genre;
    if (f.bpmMin != null) params.bpmMin = f.bpmMin;
    if (f.bpmMax != null) params.bpmMax = f.bpmMax;
    if (f.durationMin != null) params.durationMin = f.durationMin;
    if (f.durationMax != null) params.durationMax = f.durationMax;
    if (f.hasLyrics) params.hasLyrics = true;
    return params;
  }

  runSearch() {
    this.tracks = [];
    this.offset = 0;
    this.hasMore = true;
    this._clearResults();
    this._renderActiveChips();
    this._fetchBrowse(false);
  }

  async _fetchBrowse(append) {
    if (this.loading || !this.hasMore) return;
    this.loading = true;
    this._beginLoad();
    this._setLoadMore(false);

    const pure = this._isPureBrowse();
    const pageSize = pure ? SynciManager.CATALOG_PAGE : SynciManager.SEARCH_PAGE;

    try {
      let res;
      if (pure) {
        res = await this.api.synciCatalog({ limit: pageSize, offset: this.offset });
      } else {
        res = await this.api.synciSearch(Object.assign(this._buildSearchParams(), { limit: pageSize, offset: this.offset }));
      }
      if (res && res.status === false) throw new Error(res.message || this.t('synci.error.generic'));

      const incoming = Array.isArray(res && res.tracks) ? res.tracks : [];
      const rawCount = (res && typeof res.count === 'number') ? res.count : incoming.length;

      // Dedupe by id against what we already have
      const seen = new Set(this.tracks.map((t) => t.id));
      let added = 0;
      incoming.forEach((t) => {
        if (t && t.id && !seen.has(t.id)) { this.tracks.push(t); seen.add(t.id); added++; }
      });
      let trimmed = false;
      if (this.tracks.length > SynciManager.MAX_TRACKS) {
        this.tracks = this.tracks.slice(-SynciManager.MAX_TRACKS);
        trimmed = true;
      }

      // End detection: partial upstream page OR an append that added nothing new.
      const stoppedShort = rawCount < pageSize;
      const zeroNew = append && added === 0;
      this.hasMore = !(stoppedShort || zeroNew);
      this.offset += pageSize;

      this._renderTracks(trimmed);
      if (this.tracks.length === 0) {
        this._setStatus(this.t('synci.empty.browse'), false);
      } else if (!this.hasMore) {
        this._setStatus(this.t('synci.endOfResults'), false);
      } else {
        this._setStatus('', false);
      }
      this._setLoadMore(this.hasMore);
    } catch (err) {
      console.error('[Synci] fetch error:', err);
      this._setStatus(err.message || this.t('synci.error.generic'), false);
    } finally {
      this.loading = false;
      this._showCenterLoader(false);
    }
  }

  _loadNext() {
    if (this.section === 'browse') this._fetchBrowse(true);
    else this._loadList(false);
  }

  _onScroll() {
    if (this.loading || !this.hasMore) return;
    const el = document.getElementById('synci-results');
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      this._loadNext();
    }
  }

  // ── Favorites / Downloaded lists ─────────────────────────────────────────
  async _loadList(reset) {
    if (this.loading) return;
    if (!this.requireAuth()) return;
    if (reset) { this.tracks = []; this.offset = 0; this.hasMore = true; this._clearResults(); }
    if (!this.hasMore) return;

    this.loading = true;
    this._beginLoad();
    this._setLoadMore(false);
    const pageSize = 50;
    const projectId = this.favProjectId !== 'all' ? this.favProjectId : undefined;

    try {
      const res = this.section === 'favorites'
        ? await this.api.synciListFavorites({ limit: pageSize, offset: this.offset, projectId: projectId })
        : await this.api.synciListDownloads({ limit: pageSize, offset: this.offset, projectId: projectId });
      if (res && res.status === false) throw new Error(res.message || this.t('synci.error.generic'));

      const records = this.section === 'favorites'
        ? (Array.isArray(res && res.favorites) ? res.favorites : [])
        : (Array.isArray(res && res.downloads) ? res.downloads : []);
      const incoming = records.map((rec) => rec.trackSnapshot).filter((t) => t && t.id);

      const seen = new Set(this.tracks.map((t) => t.id));
      let added = 0;
      incoming.forEach((t) => { if (!seen.has(t.id)) { this.tracks.push(t); seen.add(t.id); added++; } });

      const rawCount = records.length;
      this.hasMore = !(rawCount < pageSize || added === 0);
      this.offset += pageSize;

      this._renderTracks();
      if (this.tracks.length === 0) {
        this._setStatus(this.section === 'favorites' ? this.t('synci.empty.favorites') : this.t('synci.empty.downloaded'), false);
      } else {
        this._setStatus(this.hasMore ? '' : this.t('synci.endOfResults'), false);
      }
      this._setLoadMore(this.hasMore);
    } catch (err) {
      console.error('[Synci] list error:', err);
      this._setStatus(err.message || this.t('synci.error.generic'), false);
    } finally {
      this.loading = false;
      this._showCenterLoader(false);
    }
  }

  _ensureProjectOptions() {
    const txt = document.getElementById('synci-project-text');
    if (txt) txt.textContent = this._projectName(this.favProjectId);
  }
  _projectName(id) {
    if (!id || id === 'all') return this.t('synci.allProjects');
    const projects = (window.app && Array.isArray(window.app.projects)) ? window.app.projects : [];
    const p = projects.find((x) => x._id === id);
    return p ? (p.name || 'Project') : this.t('synci.allProjects');
  }
  _openProjectMenu(trigger) {
    const projects = (window.app && Array.isArray(window.app.projects)) ? window.app.projects : [];
    const items = [{ id: 'all', label: this.t('synci.allProjects'), selected: this.favProjectId === 'all' }];
    projects.forEach((p) => items.push({ id: p._id, label: p.name || 'Project', selected: this.favProjectId === p._id }));
    KolboDropdown.open({
      trigger: trigger,
      noAvatar: true,
      items: items,
      onSelect: (id) => {
        this.favProjectId = id || 'all';
        localStorage.setItem('kolbo_synci_fav_project', this.favProjectId);
        const txt = document.getElementById('synci-project-text');
        if (txt) txt.textContent = this._projectName(this.favProjectId);
        if (this.section !== 'browse') this._loadList(true);
      }
    });
  }

  // ==========================================================================
  // Rendering tracks
  // ==========================================================================
  /**
   * Append newly-added tracks to the list instead of rebuilding it, so each
   * row's <audio> loads metadata exactly once and playback isn't interrupted
   * when more pages load. Pass full=true to rebuild from scratch (e.g. after
   * removing a favorite or trimming the in-memory cap).
   */
  /** Tear down waveform controllers and empty the results list. */
  _clearResults() {
    const root = document.getElementById('synci-results');
    if (!root) return;
    root.querySelectorAll('.synci-row').forEach((r) => {
      if (r._wave) { try { r._wave.destroy(); } catch (e) {} r._wave = null; }
    });
    root.innerHTML = '';
    this._renderedCount = 0;
  }

  _renderTracks(full) {
    const root = document.getElementById('synci-results');
    if (!root) return;
    if (full) { this._clearResults(); }
    const start = this._renderedCount || 0;
    const frag = document.createDocumentFragment();
    for (let i = start; i < this.tracks.length; i++) {
      const t = this.tracks[i];
      const wrap = document.createElement('div');
      wrap.innerHTML = this._rowHtml(t);
      const row = wrap.firstElementChild;
      if (row) { frag.appendChild(row); this._wireRow(row, t); }
    }
    root.appendChild(frag);
    this._renderedCount = this.tracks.length;
  }

  _rowHtml(track) {
    const fav = this.favorited.has(track.id);
    const art = track.artworkUrl
      ? '<img class="synci-art" src="' + this._escAttr(track.artworkUrl) + '" alt="" loading="lazy">'
      : '<div class="synci-art synci-art-empty"></div>';
    const meta = [];
    if (track.bpm) meta.push(track.bpm + ' BPM');
    if (track.durationSeconds) meta.push(this._fmtDur(track.durationSeconds));
    if (track.genre) meta.push(track.genre);

    const qualities = this._trackQualities(track);
    const def = qualities.indexOf(this.defaultQuality) >= 0 ? this.defaultQuality : qualities[0];

    const previewUrl = track.audioUrl || track.audioUrl128 || track.audioUrl320 || '';
    const durLabel = track.durationSeconds ? this._fmtDur(track.durationSeconds) : '';

    return '<div class="synci-row" data-track-id="' + this._escAttr(track.id) + '">' +
        art +
        '<div class="synci-row-main">' +
          '<div class="synci-row-title" title="' + this._escAttr(track.title || '') + '">' + this._esc(track.title || 'Untitled') + '</div>' +
          '<div class="synci-row-artist">' + this._esc(track.artist || '') + (track.album ? ' · ' + this._esc(track.album) : '') + '</div>' +
          '<div class="synci-row-meta">' + this._esc(meta.join(' · ')) + '</div>' +
        '</div>' +
        '<button class="synci-play' + (previewUrl ? '' : ' disabled') + '" title="' + this._escAttr(this.t('synci.preview')) + '"' + (previewUrl ? '' : ' disabled') + '><span class="synci-play-icon"></span></button>' +
        '<div class="synci-wave-wrap">' +
          '<canvas class="synci-wave"></canvas>' +
        '</div>' +
        '<span class="synci-time">' + this._esc(durLabel) + '</span>' +
        '<div class="synci-row-actions">' +
          '<button class="synci-heart' + (fav ? ' active' : '') + '" title="' + this._escAttr(this.t('synci.favorite')) + '">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"></path></svg>' +
          '</button>' +
          '<button class="synci-dl" type="button" data-avail="' + qualities.join(',') + '" title="' + this._escAttr(this.t('synci.download')) + '">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' +
          '</button>' +
        '</div>' +
        (previewUrl ? '<audio class="synci-audio" preload="none" src="' + this._escAttr(previewUrl) + '"></audio>' : '') +
      '</div>';
  }

  _wireRow(row, track) {
    const playBtn = row.querySelector('.synci-play');
    const audio = row.querySelector('.synci-audio');
    // Real-peak canvas waveform (shared component): handles its own decode,
    // progress draw, and click-to-seek against this row's <audio>.
    const canvas = row.querySelector('.synci-wave');
    if (canvas && audio && typeof KolboWaveform !== 'undefined') {
      row._wave = KolboWaveform.create({
        canvas: canvas,
        audio: audio,
        url: track.audioUrl || track.audioUrl128 || track.audioUrl320 || track.audioUrlWav,
        // Preview-only: the row's <audio> never plays (the dock is the player),
        // so skip loading it on hover/click — just report the clicked position.
        noAudioPrefetch: true,
        // Clicking a row's waveform loads it into the bottom dock and plays from
        // the clicked position (pct), so the dock player stays in sync.
        onActivate: (pct) => this._playInDockAt(track, pct)
      });
    }
    if (playBtn && audio) {
      playBtn.addEventListener('click', () => this._togglePlay(audio, row));
    }
    const heart = row.querySelector('.synci-heart');
    if (heart) heart.addEventListener('click', () => this._toggleFavorite(track, heart));

    // Download: pressing it opens the format menu (quality picker); selecting a
    // quality starts the download. With only one available quality we skip the
    // menu and download immediately.
    const dl = row.querySelector('.synci-dl');
    if (dl) dl.addEventListener('click', () => {
      if (dl.classList.contains('busy')) return;
      const avail = (dl.dataset.avail || '128').split(',');
      if (avail.length <= 1) {
        this._handleDownload(track, avail[0] || this.defaultQuality, dl);
        return;
      }
      const def = avail.indexOf(this.defaultQuality) >= 0 ? this.defaultQuality : avail[0];
      KolboDropdown.open({
        trigger: dl,
        noAvatar: true,
        items: avail.map((q) => ({ id: q, label: this._qualLabel(q), selected: q === def })),
        onSelect: (q) => this._handleDownload(track, q, dl)
      });
    });
  }

  // ── Playback: single player hosted in the now-playing dock ───────────────
  // Rows no longer play their own <audio>; pressing play (or clicking a row
  // waveform) loads the track into the dock, which is the one place playback,
  // in/out selection and drag-to-timeline happen.
  _el(id) { return document.getElementById(id); }

  /** Row play button / row waveform click → play this track in the dock. */
  _togglePlay(audio, row) {
    const track = (row && this.tracks.find((t) => t.id === row.dataset.trackId)) || null;
    if (track) this._playInDock(track);
  }

  _playInDock(track) {
    const audio = this._el('synci-dock-audio');
    if (!audio) return;
    if (this._dock && this._dock.track && this._dock.track.id === track.id) {
      this._dockTogglePlay();
      return;
    }
    this._dockActivate(track);
    audio.play().catch(() => {});
  }

  /** Load a track into the dock (if needed) and play from a 0..1 position —
   *  used when clicking a row's waveform in the main list. */
  _playInDockAt(track, pct) {
    if (!this._dock || !this._dock.track || this._dock.track.id !== track.id) {
      this._dockActivate(track);
    }
    this._dockSeekTo(typeof pct === 'number' ? pct : 0, true);
  }

  /** Toggle dock playback; resumes from the in-point when a selection is set. */
  _dockTogglePlay() {
    const audio = this._d && this._d.audio;
    if (!audio) return;
    if (audio.paused) { this._dockSeekIfOutside(); audio.play().catch(() => {}); }
    else audio.pause();
  }

  _dockActivate(track) {
    const audio = this._el('synci-dock-audio');
    const dock = this._el('synci-dock');
    if (!audio || !dock) return;
    if (this._dock && this._dock.wave) { try { this._dock.wave.destroy(); } catch (e) {} }
    if (this._dock && this._dock._prewarmTimer) clearTimeout(this._dock._prewarmTimer);

    const previewUrl = track.audioUrl || track.audioUrl128 || track.audioUrl320 || track.audioUrlWav || '';
    this._dock = { track, wave: null, inPct: 0, outPct: 1, localPath: null, dragPath: null, _dragKey: null, _readyPromise: null, _prewarmTimer: null };

    try { audio.pause(); } catch (e) {}
    audio.src = previewUrl;
    dock.classList.remove('hidden');

    const art = this._el('synci-dock-art');
    if (art) {
      if (track.artworkUrl) { art.src = track.artworkUrl; art.classList.remove('synci-dock-art-empty'); }
      else { art.removeAttribute('src'); art.classList.add('synci-dock-art-empty'); }
    }
    const titleEl = this._el('synci-dock-title'); if (titleEl) titleEl.textContent = track.title || 'Untitled';
    const artistEl = this._el('synci-dock-artist'); if (artistEl) artistEl.textContent = [track.artist, track.album].filter(Boolean).join(' · ');
    const qt = this._el('synci-dock-quality-text'); if (qt) qt.textContent = this._qualLabel(this.defaultQuality);

    const canvas = this._el('synci-dock-wave');
    if (canvas && typeof KolboWaveform !== 'undefined') {
      // noInteract: the dock owns click-to-seek AND drag-to-select-in/out itself.
      this._dock.wave = KolboWaveform.create({ canvas, audio, url: previewUrl, noInteract: true });
    }

    this._renderDockRegion();
    this._updateDockTime();
    this._updateDockButton();
    this._setDockPlaying(false);

    // Pre-warm the drag file (download + trim) so dragging is instant — auth only.
    if (this.isAuth()) this._ensureDragReady(false);
  }

  _wireDock() {
    const audio = this._el('synci-dock-audio');
    const dock = this._el('synci-dock');
    if (!audio || !dock || dock._wired) return;
    dock._wired = true;

    // Cache static dock element refs once. The dock DOM is built a single time
    // in _build() and never recreated, so this avoids repeated getElementById
    // in hot paths (in/out drag mousemove, audio timeupdate ~4×/sec).
    this._d = {
      audio, dock,
      wrap: this._el('synci-dock-wave-wrap'),
      inEl: this._el('synci-dock-in'),
      outEl: this._el('synci-dock-out'),
      region: this._el('synci-dock-region'),
      maskL: this._el('synci-dock-mask-l'),
      maskR: this._el('synci-dock-mask-r'),
      time: this._el('synci-dock-time'),
      inout: this._el('synci-dock-inout'),
      play: this._el('synci-dock-play'),
      dragLabel: this._el('synci-dock-drag-label'),
      loading: this._el('synci-dock-loading')
    };

    audio.addEventListener('play', () => this._setDockPlaying(true));
    audio.addEventListener('pause', () => this._setDockPlaying(false));
    audio.addEventListener('ended', () => this._setDockPlaying(false));
    audio.addEventListener('loadedmetadata', () => { this._updateDockTime(); this._dockSeekIfOutside(); });
    audio.addEventListener('timeupdate', () => {
      this._updateDockTime();
      // When a sub-selection is set, loop playback within in→out.
      const d = this._dock;
      if (d && audio.duration && !this._dockIsFull()) {
        const inSec = d.inPct * audio.duration, outSec = d.outPct * audio.duration;
        if (audio.currentTime >= outSec - LOOP_EPS_SEC) { try { audio.currentTime = inSec; } catch (e) {} }
      }
    });

    const playBtn = this._el('synci-dock-play');
    if (playBtn) playBtn.addEventListener('click', () => this._dockTogglePlay());

    // Spacebar toggles play/pause while the Synci dock is open (ignored while
    // typing in a field).
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (!this._dock || !this._d || !this._d.dock || this._d.dock.classList.contains('hidden')) return;
      const view = document.getElementById('synci-view');
      if (!view || view.classList.contains('hidden')) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      e.preventDefault();
      this._dockTogglePlay();
    });

    const closeBtn = this._el('synci-dock-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this._closeDock());

    const qBtn = this._el('synci-dock-quality');
    if (qBtn) qBtn.addEventListener('click', () => {
      KolboDropdown.open({
        trigger: qBtn, noAvatar: true,
        items: ['128', '320', 'wav'].map((q) => ({ id: q, label: this._qualLabel(q), selected: q === this.defaultQuality })),
        onSelect: (q) => {
          this.defaultQuality = q;
          localStorage.setItem('kolbo_synci_quality', q);
          const t = this._el('synci-dock-quality-text'); if (t) t.textContent = this._qualLabel(q);
          // New quality → previously cached/trimmed files no longer match.
          if (this._dock) { this._dock.localPath = null; this._invalidateDrag(); }
          if (this.isAuth() && this._dock && this._dock.track) this._ensureDragReady(false);
        }
      });
    });

    this._wireDockHandle('synci-dock-in', 'in');
    this._wireDockHandle('synci-dock-out', 'out');
    this._wireDockSeek();

    // Drag-to-timeline sources: the primary button, the artwork, and the
    // selected region. All prepare the file on demand (overlay) then native-drag.
    const dragBtn = this._el('synci-dock-drag');
    if (dragBtn) {
      dragBtn.addEventListener('dragstart', (e) => this._onDockDragStart(e));
      dragBtn.addEventListener('click', () => this._onDockDownload());
      dragBtn.addEventListener('mousedown', () => this._prewarmDrag());
    }
    const art = this._el('synci-dock-art');
    if (art) {
      art.addEventListener('dragstart', (e) => this._onDockDragStart(e));
      art.addEventListener('mousedown', () => this._prewarmDrag());
    }
    // The selection region is purely visual now — the waveform wrapper owns
    // click-to-seek, drag-to-reselect, and drag-out-to-export (see _wireDockSeek).
  }

  /**
   * Unified pointer interaction on the dock waveform (File Bridge style):
   *  - a plain click seeks (and plays) the play head,
   *  - a horizontal drag selects/re-selects the in/out region (even over an
   *    existing selection),
   *  - dragging OUT of the waveform (vertically) starts the native
   *    drag-to-timeline export.
   */
  _wireDockSeek() {
    const wrap = this._el('synci-dock-wave-wrap');
    if (!wrap || wrap._seekWired) return;
    wrap._seekWired = true;

    let startX = 0, startPct = 0, moved = false, dragging = false, exported = false, dragRect = null;
    // The waveform's rect is cached for the duration of a drag so getBoundingClientRect
    // isn't recomputed on every mousemove (~60×/sec).
    const pctFromX = (clientX, rect) => {
      const r = rect || wrap.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    };
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragging = false; dragRect = null;
      document.body.style.userSelect = '';
    };
    const onMove = (e) => {
      if (!dragging || exported) return;
      const d = this._dock; if (!d) return;
      const r = dragRect;
      // Dragging out of the waveform (above/below) → export to timeline.
      if (e.clientY < r.top - DRAG_OUT_PX || e.clientY > r.bottom + DRAG_OUT_PX) {
        exported = true;
        cleanup();
        this._startExportDrag();
        return;
      }
      // Otherwise a horizontal drag (re)selects in/out.
      if (!moved && Math.abs(e.clientX - startX) > DRAG_MOVE_PX) moved = true;
      if (!moved) return;
      const pct = pctFromX(e.clientX, r);
      d.inPct = Math.min(startPct, pct);
      d.outPct = Math.max(startPct, pct);
      if (d.outPct - d.inPct < DOCK_MIN_GAP) d.outPct = Math.min(1, d.inPct + DOCK_MIN_GAP);
      this._renderDockRegion();
      this._updateDockTime();
    };
    const onUp = (e) => {
      cleanup();
      if (exported) return;
      if (moved) {
        // selection changed → re-trim the drag file and play from the in-point
        this._invalidateDrag();
        this._dockSeekTo(this._dock ? this._dock.inPct : 0, true);
      } else {
        // Plain click → seek + play. Clicking OUTSIDE an existing selection
        // clears it (back to full track) so the user can scrub the whole track;
        // clicking inside keeps the selection and scrubs within it.
        const pct = pctFromX(e.clientX);
        const d = this._dock;
        if (d && !this._dockIsFull() && (pct < d.inPct || pct > d.outPct)) {
          d.inPct = 0; d.outPct = 1;
          this._invalidateDrag();
          this._renderDockRegion();
          this._updateDockTime();
        }
        this._dockSeekTo(pct, true);
      }
    };
    wrap.addEventListener('mousedown', (e) => {
      if (e.target.closest('.synci-dock-handle')) return; // handles manage themselves
      if (!this._dock) return;
      e.preventDefault();
      dragging = true; moved = false; exported = false;
      dragRect = wrap.getBoundingClientRect();
      startX = e.clientX; startPct = pctFromX(e.clientX, dragRect);
      document.body.style.userSelect = 'none';
      this._prewarmDrag(); // start preparing in case the drag goes out to export
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /** Native drag-to-timeline (from drag-out, the button, or the artwork). */
  _startExportDrag() {
    const d = this._dock;
    if (!this.isAuth()) { this.requireAuth(); return; }
    if (!d || !d.track) return;
    if (d.dragPath && d._dragKey === this._selKey()) {
      window.kolboDesktop.synciStartDrag(d.dragPath);
      this.api.synciLogDownload(d.track, this.defaultQuality, this.currentProjectId());
    } else {
      // Not ready yet → prepare (overlay), then ask the user to drag again.
      this._ensureDragReady(true).then((p) => {
        this._toast(p ? this.t('synci.dock.ready') : this.t('synci.error.generic'));
      });
    }
  }

  _wireDockHandle(id, which) {
    const handle = this._el(id);
    const wrap = this._el('synci-dock-wave-wrap');
    if (!handle || !wrap) return;
    let rect = null; // cached for the duration of one handle drag
    const onMove = (e) => {
      const d = this._dock; if (!d || !rect) return;
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (which === 'in') d.inPct = Math.max(0, Math.min(pct, d.outPct - DOCK_MIN_GAP));
      else d.outPct = Math.min(1, Math.max(pct, d.inPct + DOCK_MIN_GAP));
      this._renderDockRegion();
      this._updateDockTime();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      rect = null;
      this._invalidateDrag();
      this._dockSeekIfOutside(); // keep the play head inside the new selection
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      rect = wrap.getBoundingClientRect();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _renderDockRegion() {
    const d = this._dock, els = this._d; if (!d || !els) return;
    const inS = (d.inPct * 100).toFixed(2) + '%';
    const outS = (d.outPct * 100).toFixed(2) + '%';
    if (els.inEl) els.inEl.style.left = inS;
    if (els.outEl) els.outEl.style.left = outS;
    if (els.region) {
      els.region.style.left = inS;
      els.region.style.right = (100 - d.outPct * 100).toFixed(2) + '%';
    }
    if (els.maskL) { els.maskL.style.left = '0'; els.maskL.style.width = inS; }
    if (els.maskR) { els.maskR.style.left = outS; els.maskR.style.right = '0'; els.maskR.style.width = 'auto'; }
    this._updateDockButton();
  }

  _dockDuration() {
    const audio = this._d && this._d.audio;
    if (audio && audio.duration && isFinite(audio.duration)) return audio.duration;
    return (this._dock && this._dock.track && this._dock.track.durationSeconds) || 0;
  }

  /** Seek the play head to a 0..1 fraction (and optionally start playback);
   *  defers until metadata if duration isn't known yet. */
  _dockSeekTo(pct, andPlay) {
    const audio = this._d && this._d.audio;
    if (!audio) return;
    const apply = () => {
      if (!audio.duration || !isFinite(audio.duration)) return;
      try { audio.currentTime = Math.max(0, Math.min(1, pct)) * audio.duration; } catch (e) {}
      this._updateDockTime();
      if (this._dock && this._dock.wave) this._dock.wave.redraw();
      if (andPlay) audio.play().catch(() => {});
    };
    if (audio.duration && isFinite(audio.duration)) {
      apply();
    } else {
      // Metadata not loaded yet → load and apply once it's known.
      try { if (audio.preload !== 'auto') audio.preload = 'auto'; if (audio.readyState === 0) audio.load(); } catch (e) {}
      audio.addEventListener('loadedmetadata', apply, { once: true });
    }
  }

  _updateDockTime() {
    const els = this._d; if (!els) return;
    const dur = this._dockDuration();
    const cur = (els.audio && els.audio.currentTime) || 0;
    if (els.time) els.time.textContent = this._fmtDur(cur) + ' / ' + this._fmtDur(dur);
    const d = this._dock;
    if (els.inout && d) {
      if (d.inPct <= 0.001 && d.outPct >= 0.999) els.inout.textContent = '';
      else els.inout.textContent = this.t('synci.dock.in') + ' ' + this._fmtDur(d.inPct * dur) + ' · ' + this.t('synci.dock.out') + ' ' + this._fmtDur(d.outPct * dur);
    }
  }

  _setDockPlaying(playing) {
    if (this._d && this._d.play) this._d.play.classList.toggle('playing', playing);
    document.querySelectorAll('.synci-row .synci-play.playing').forEach((b) => b.classList.remove('playing'));
    if (playing && this._dock && this._dock.track) {
      const row = document.querySelector('.synci-row[data-track-id="' + this._cssEsc(this._dock.track.id) + '"]');
      const b = row && row.querySelector('.synci-play');
      if (b) b.classList.add('playing');
    }
  }

  _dockSeekIfOutside() {
    const audio = this._d && this._d.audio;
    const d = this._dock;
    if (!audio || !d || !audio.duration || !isFinite(audio.duration)) return;
    const inSec = d.inPct * audio.duration, outSec = d.outPct * audio.duration;
    if (audio.currentTime < inSec || audio.currentTime >= outSec - LOOP_EPS_SEC) {
      try { audio.currentTime = inSec; } catch (e) {}
    }
  }

  _closeDock() {
    const audio = this._el('synci-dock-audio');
    if (audio) { try { audio.pause(); } catch (e) {} }
    if (this._dock && this._dock.wave) { try { this._dock.wave.destroy(); } catch (e) {} }
    if (this._dock && this._dock._prewarmTimer) clearTimeout(this._dock._prewarmTimer);
    this._setDockPlaying(false);
    this._showDockLoading(false);
    const dock = this._el('synci-dock'); if (dock) dock.classList.add('hidden');
    this._dock = null;
  }

  // ── Drag-to-timeline / download: cache locally, trim to in/out, native drag ─
  _dockIsFull() {
    const d = this._dock;
    return !d || (d.inPct <= DOCK_FULL_EPS && d.outPct >= 1 - DOCK_FULL_EPS);
  }

  _selKey() {
    const d = this._dock;
    return this._dockIsFull() ? 'full' : (d.inPct.toFixed(4) + '-' + d.outPct.toFixed(4));
  }

  /** Selection (or quality) changed → the prepared file is stale. */
  _invalidateDrag() {
    const d = this._dock; if (!d) return;
    d.dragPath = null; d._dragKey = null;
    this._updateDockButton();
    if (this.isAuth()) {
      if (d._prewarmTimer) clearTimeout(d._prewarmTimer);
      d._prewarmTimer = setTimeout(() => this._ensureDragReady(false), 300);
    }
  }

  /** Begin preparing on press so the file is often ready by the time of drag. */
  _prewarmDrag() {
    if (this.isAuth() && this._dock && this._dock.track) this._ensureDragReady(false);
  }

  /** Download the chosen-quality track into a local cache file. */
  async _cacheDockLocal() {
    const d = this._dock; if (!d || !d.track) return null;
    if (d.localPath) return d.localPath;
    if (!window.kolboDesktop || typeof window.kolboDesktop.synciCacheTrack !== 'function') return null;
    const track = d.track, quality = this.defaultQuality;
    let url = this._pickAudioUrl(track, quality);
    try {
      const fresh = await this.api.synciAudioById(track.id);
      if (fresh && fresh.urls) url = fresh.urls[quality] || fresh.urls['320'] || fresh.urls['128'] || fresh.urls['wav'] || url;
    } catch (e) { /* fall back to snapshot url */ }
    if (!url) return null;
    try {
      const res = await window.kolboDesktop.synciCacheTrack(url, this._safeName(track.title) + this._audioExt(quality));
      if (res && res.success && res.filePath && this._dock && this._dock.track && this._dock.track.id === track.id) {
        this._dock.localPath = res.filePath;
        return res.filePath;
      }
    } catch (e) { /* caller handles null */ }
    return null;
  }

  /**
   * Ensure a local file (full, or trimmed to the in/out selection) exists and
   * return its path. Coalesces concurrent calls; optionally shows the overlay.
   */
  _ensureDragReady(showOverlay) {
    const d = this._dock; if (!d || !d.track) return Promise.resolve(null);
    const key = this._selKey();
    if (d.dragPath && d._dragKey === key) return Promise.resolve(d.dragPath);
    if (d._readyPromise) return d._readyPromise;
    d._readyPromise = (async () => {
      if (showOverlay) this._showDockLoading(true);
      try {
        const local = await this._cacheDockLocal();
        if (!local || this._dock !== d) return null;
        if (this._dockIsFull()) { d.dragPath = local; d._dragKey = 'full'; return local; }
        const dur = this._dockDuration();
        if (!dur) { d.dragPath = local; d._dragKey = 'full'; return local; }
        const inSec = d.inPct * dur, outSec = d.outPct * dur;
        try {
          const res = await window.kolboDesktop.synciExportTrimmed({ inputPath: local, inPoint: inSec, outPoint: outSec });
          if (this._dock !== d) return null;
          d.dragPath = (res && res.success && res.outputPath) ? res.outputPath : local;
        } catch (e) { d.dragPath = local; }
        d._dragKey = key;
        return d.dragPath;
      } finally {
        if (showOverlay) this._showDockLoading(false);
        d._readyPromise = null;
      }
    })();
    return d._readyPromise;
  }

  _showDockLoading(show) {
    if (this._d && this._d.loading) this._d.loading.classList.toggle('hidden', !show);
  }

  _updateDockButton() {
    if (this._d && this._d.dragLabel) this._d.dragLabel.textContent = this._dockIsFull() ? this.t('synci.dock.download') : this.t('synci.dock.downloadTrim');
  }

  /** Native drag-out (button / artwork / region). Prepares on demand. */
  // HTML5 dragstart on the button/artwork → same native export as drag-out.
  // (We always preventDefault so the browser's own drag image never appears.)
  _onDockDragStart(e) {
    e.preventDefault();
    this._startExportDrag();
  }

  /** Click the primary button → save the (full or trimmed) file to Downloads. */
  async _onDockDownload() {
    const d = this._dock;
    if (!this.isAuth()) { this.requireAuth(); return; }
    if (!d || !d.track) return;
    const filePath = await this._ensureDragReady(true);
    if (!filePath) { this._toast(this.t('synci.error.generic')); return; }
    const quality = this.defaultQuality;
    const filename = this._safeName(d.track.title) + (this._dockIsFull() ? '' : '_trim') + this._audioExt(quality);
    try {
      const res = await window.kolboDesktop.synciSaveToDownloads(filePath, filename);
      if (res && res.success) {
        this._toast(this.t('synci.added'));
        this.api.synciLogDownload(d.track, quality, this.currentProjectId());
      } else {
        this._toast((res && res.error) || this.t('synci.error.generic'));
      }
    } catch (e) {
      this._toast(this.t('synci.error.generic'));
    }
  }

  // ── Favorites (optimistic) ───────────────────────────────────────────────
  async _toggleFavorite(track, heartEl) {
    if (!this.requireAuth()) return;
    const id = track.id;
    const was = this.favorited.has(id);
    // Optimistic flip
    if (was) this.favorited.delete(id); else this.favorited.add(id);
    heartEl.classList.toggle('active', !was);
    try {
      if (was) await this.api.synciRemoveFavorite(id);
      else await this.api.synciAddFavorite(track, this.currentProjectId());
    } catch (err) {
      // Roll back
      if (was) this.favorited.add(id); else this.favorited.delete(id);
      heartEl.classList.toggle('active', was);
      console.error('[Synci] favorite toggle failed:', err);
      this._toast(err.message || this.t('synci.error.generic'));
      return;
    }
    // If unfavorited while viewing the Favorites tab, drop the row.
    if (was && this.section === 'favorites') {
      this.tracks = this.tracks.filter((t) => t.id !== id);
      this._renderTracks(true);
      if (this.tracks.length === 0) this._setStatus(this.t('synci.empty.favorites'), false);
    }
  }

  // ── Download -> import to timeline ───────────────────────────────────────
  async _handleDownload(track, quality, btn) {
    if (!this.requireAuth()) return;
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    const original = btn.innerHTML;
    btn.innerHTML = '<span class="synci-spinner"></span>';

    try {
      // Pull the freshest signed url for the chosen quality (search urls expire).
      let url = this._pickAudioUrl(track, quality);
      try {
        const fresh = await this.api.synciAudioById(track.id);
        if (fresh && fresh.urls) {
          url = fresh.urls[quality] || fresh.urls['128'] || fresh.urls['320'] || fresh.urls['wav'] || url;
        }
      } catch (e) { /* fall back to snapshot url */ }
      if (!url) throw new Error(this.t('synci.error.noAudio'));

      const filename = this._safeName(track.title) + this._audioExt(quality);

      const result = await this.bridge.addMusicTracksToTimeline([url], [filename]);
      if (result && result.success === false) throw new Error(result.error || this.t('synci.error.import'));

      // Log the download (fire-and-forget — never blocks the user).
      this.api.synciLogDownload(track, quality, this.currentProjectId());

      btn.classList.remove('busy');
      btn.classList.add('done');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      this._toast(this.t('synci.added'));
      setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = original; }, 2000);
    } catch (err) {
      console.error('[Synci] download/import failed:', err);
      btn.classList.remove('busy');
      btn.innerHTML = original;
      this._toast(err.message || this.t('synci.error.import'));
    }
  }

  _pickAudioUrl(track, quality) {
    if (quality === 'wav' && track.audioUrlWav) return track.audioUrlWav;
    if (quality === '320' && track.audioUrl320) return track.audioUrl320;
    if (quality === '128' && track.audioUrl128) return track.audioUrl128;
    return track.audioUrl128 || track.audioUrl320 || track.audioUrlWav || track.audioUrl || null;
  }

  // ==========================================================================
  // AI suggest — script + media (image / video / timeline frame / timeline audio)
  // ==========================================================================
  _openSuggestMenu(trigger) {
    if (!this.requireAuth()) return;
    const b = this.bridge;
    const I = SynciManager.SUGGEST_ICONS;
    const items = [{ id: 'script', label: this.t('synci.suggestMenu.script'), icon: I.script }];
    if (b && typeof b.exportFrameAsBase64 === 'function') items.push({ id: 'frame', label: this.t('synci.suggestMenu.frame'), icon: I.frame });
    items.push({ id: 'image', label: this.t('synci.suggestMenu.image'), icon: I.image });
    items.push({ id: 'video', label: this.t('synci.suggestMenu.video'), icon: I.video });
    if (b && typeof b.exportAudioToTemp === 'function') items.push({ id: 'audio', label: this.t('synci.suggestMenu.audio'), icon: I.audio });
    KolboDropdown.open({ trigger: trigger, noAvatar: true, items: items, onSelect: (id) => this._handleSuggest(id) });
  }

  _handleSuggest(id) {
    if (!this.requireAuth()) return;
    if (id === 'script') return this._openScript();
    if (id === 'frame') return this._suggestFromFrame();
    if (id === 'image') return this._suggestFromUpload('image/*');
    if (id === 'video') return this._suggestFromUpload('video/*');
    if (id === 'audio') return this._suggestFromTimelineAudio();
  }

  _promptFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => resolve((input.files && input.files[0]) || null);
      input.click();
    });
  }

  async _suggestFromUpload(accept) {
    const file = await this._promptFile(accept);
    if (!file) return;
    if (file.size > SynciManager.MEDIA_MAX_BYTES) { this._toast(this.t('synci.analyze.tooLarge')); return; }
    await this._analyzeMediaFile(file);
  }

  async _suggestFromFrame() {
    this._setBusy(true, this.t('synci.analyze.capturing'));
    try {
      const res = await this.bridge.exportFrameAsBase64();
      if (!res || !res.success || !res.imageData) throw new Error((res && res.error) || this.t('synci.error.frame'));
      const blob = this._dataURLToBlob(res.imageData);
      const file = new File([blob], 'timeline_frame.jpg', { type: blob.type || 'image/jpeg' });
      await this._analyzeMediaFile(file);
    } catch (err) {
      this._setBusy(false);
      console.error('[Synci] frame analyze failed:', err);
      this._toast(err.message || this.t('synci.error.frame'));
    }
  }

  async _suggestFromTimelineAudio() {
    this._setBusy(true, this.t('synci.analyze.exporting'));
    let path = null;
    try {
      // Prefer the In/Out range; fall back to the whole sequence.
      let res = await this.bridge.exportAudioToTemp(true);
      if (!res || !res.success || !res.path || !(res.outPoint > res.inPoint)) {
        res = await this.bridge.exportAudioToTemp(false);
      }
      if (!res || !res.success || !res.path) throw new Error((res && res.error) || this.t('synci.error.audioExport'));
      path = res.path;

      // Safety cap: ≤10 min (when In/Out range is known) AND under the
      // analyze-media 50 MB limit. Ask the user to shorten with In/Out points.
      const dur = (res.outPoint > res.inPoint) ? (res.outPoint - res.inPoint) : 0;
      if ((dur && dur > SynciManager.AUDIO_MAX_SEC) || (res.size && res.size > SynciManager.MEDIA_MAX_BYTES)) {
        this._cleanupTemp(path);
        this._setBusy(false);
        this._toast(this.t('synci.analyze.audioTooLong'));
        return;
      }

      this._setBusy(true, this.t('synci.analyze.analyzing'));
      const file = await this._readFsPathAsFile(path, 'timeline_audio.wav', 'audio/wav');
      await this._analyzeMediaFile(file);
      this._cleanupTemp(path);
    } catch (err) {
      if (path) this._cleanupTemp(path);
      this._setBusy(false);
      console.error('[Synci] timeline audio analyze failed:', err);
      this._toast(err.message || this.t('synci.error.audioExport'));
    }
  }

  async _analyzeMediaFile(file) {
    if (!this.requireAuth()) return;
    this._setBusy(true, this.t('synci.analyze.analyzing'));
    try {
      const a = await this.api.analyzeMediaForMusic(file);
      const query = this._buildQueryFromAnalysis(a);
      this._applyAnalysisResult(query, a && a.mood, a && a.genre);
    } catch (err) {
      this._setBusy(false);
      console.error('[Synci] media analyze failed:', err);
      this._toast(err.message || this.t('synci.error.generic'));
    }
  }

  /** Build a short (1–3 word) Synci query from an analyze-media result. */
  _buildQueryFromAnalysis(a) {
    const pick = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : null;
    const mood = pick(a && a.mood), genre = pick(a && a.genre), style = pick(a && a.style), prompt = pick(a && a.prompt);
    let q = '';
    if (mood && genre) q = mood + ' ' + genre;
    else if (mood && style) q = mood + ' ' + style;
    else q = [mood, genre, style].filter(Boolean).slice(0, 2).join(' ') || (prompt ? prompt.split(/\s+/).slice(0, 3).join(' ') : '');
    return q.toLowerCase();
  }

  /**
   * Shared by script + media analysis: set the query, set mood/genre chips
   * ONLY when they match a known facet, then run the search.
   */
  _applyAnalysisResult(query, moodRaw, genreRaw) {
    this.query = query || '';
    const input = document.getElementById('synci-search-input');
    if (input) input.value = this.query;
    const matchFacet = (list, val) => {
      if (!val || !Array.isArray(list)) return null;
      const found = list.find((e) => this._facetValue(e).toLowerCase() === String(val).toLowerCase());
      return found ? this._facetValue(found) : null;
    };
    this.filters.mood = this.facets ? matchFacet(this.facets.moods, moodRaw) : null;
    this.filters.genre = this.facets ? matchFacet(this.facets.genres, genreRaw) : null;
    this._renderChipPanels();
    this._renderActiveChips();
    this._browseUI();
    this.runSearch();
  }

  _dataURLToBlob(dataUrl) {
    const parts = String(dataUrl).split(',');
    const meta = parts[0] || '', b64 = parts[1] || '';
    const mime = (/data:([^;]+);/.exec(meta) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async _readFsPathAsFile(path, fallbackName, mime) {
    const fs = (typeof require === 'function') ? require('fs') : null;
    if (!fs) throw new Error('Node fs not available');
    const buf = fs.readFileSync(path);
    const arr = new Uint8Array(buf);
    const name = (path.split(/[\\/]/).pop()) || fallbackName;
    return new File([arr], name, { type: mime });
  }

  _cleanupTemp(path) {
    try { const fs = (typeof require === 'function') ? require('fs') : null; if (fs && path) fs.unlinkSync(path); } catch (e) {}
  }

  // ==========================================================================
  // Script search
  // ==========================================================================
  _openScript() {
    if (!this.requireAuth()) return;
    const dlg = document.getElementById('synci-script-dialog');
    if (dlg) dlg.classList.remove('hidden');
  }
  _closeScript() {
    const dlg = document.getElementById('synci-script-dialog');
    if (dlg) dlg.classList.add('hidden');
  }
  async _runScript() {
    const ta = document.getElementById('synci-script-text');
    const runBtn = document.getElementById('synci-script-run');
    const text = (ta && ta.value || '').trim();
    if (!text) return;
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = this.t('synci.script.analyzing'); }
    try {
      const res = await this.api.synciAnalyzeScript(text);
      if (res && res.status === false) throw new Error(res.message || this.t('synci.error.generic'));
      this._closeScript();
      this._applyAnalysisResult((res && res.query) || '', res && res.mood, res && res.genre);
    } catch (err) {
      console.error('[Synci] script analyze failed:', err);
      this._toast(err.message || this.t('synci.error.generic'));
    } finally {
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = this.t('synci.script.analyze'); }
    }
  }

  // ==========================================================================
  // Small UI helpers
  // ==========================================================================
  _setStatus(msg, spinning) {
    const el = document.getElementById('synci-status');
    if (!el) return;
    el.innerHTML = msg ? ((spinning ? '<span class="synci-spinner"></span> ' : '') + this._esc(msg)) : '';
  }
  /** Show the big centered loader on first/reset loads; a small bottom
   *  spinner when appending more onto an existing list. */
  _beginLoad() {
    if (this.tracks.length === 0) { this._showCenterLoader(true); this._setStatus('', false); }
    else { this._setStatus(this.t('synci.loading'), true); }
  }
  _showCenterLoader(show) {
    this._setBusy(show, show ? this.t('synci.loading') : null);
  }
  /** Centered loader with a custom message (default-loading / analysis / export). */
  _setBusy(show, msg) {
    const el = document.getElementById('synci-loading');
    if (!el) return;
    const t = el.querySelector('.synci-loading-text');
    if (t && msg) t.textContent = msg;
    el.classList.toggle('hidden', !show);
  }
  _setLoadMore(show) {
    const el = document.getElementById('synci-load-more');
    if (el) el.classList.toggle('hidden', !show);
  }
  _toast(msg) {
    if (window.app && typeof window.app.showToast === 'function') { window.app.showToast(msg); return; }
    this._setStatus(msg, false);
  }
  _fmtDur(sec) {
    sec = Math.round(sec || 0);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  _qualLabel(q) {
    return { '128': 'MP3 128', '320': 'MP3 320', 'wav': 'WAV' }[q] || ('MP3 ' + q);
  }
  /** File extension for a quality, and a filesystem-safe track filename base. */
  _audioExt(quality) { return quality === 'wav' ? '.wav' : '.mp3'; }
  _safeName(title) { return (title || 'Synci Track').replace(/[^\w\-\s.]/g, '').slice(0, 80).trim() || 'Synci Track'; }
  /** Available download qualities for a track (present urls only). */
  _trackQualities(track) {
    const q = [];
    if (track.audioUrl128) q.push('128');
    if (track.audioUrl320) q.push('320');
    if (track.audioUrlWav) q.push('wav');
    return q.length ? q : ['128'];
  }
  _esc(str) { return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  _escAttr(str) { return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
  _cssEsc(str) { return String(str == null ? '' : str).replace(/["\\]/g, '\\$&'); }
}

// Default (cleared) filter state — shared by the constructor and _resetAll.
SynciManager.DEFAULT_FILTERS = { mood: null, genre: null, bpmMin: null, bpmMax: null, durationMin: null, durationMax: null, hasLyrics: false };

// Chevron icon for dropdown triggers.
SynciManager.CHEVRON = '<svg class="synci-dd-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>';

// Inline-SVG icons for the AI-suggest menu items (rendered by KolboDropdown).
SynciManager.SUGGEST_ICONS = {
  script: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>',
  frame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2"></rect></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="10" x2="2" y2="14"></line><line x1="6" y1="6" x2="6" y2="18"></line><line x1="10" y1="3" x2="10" y2="21"></line><line x1="14" y1="8" x2="14" y2="16"></line><line x1="18" y1="5" x2="18" y2="19"></line><line x1="22" y1="10" x2="22" y2="14"></line></svg>'
};

// English fallback strings (used when window.t has no key yet).
SynciManager.FALLBACK = {
  'synci.tagline': 'Licensed music library',
  'synci.tab.browse': 'Browse',
  'synci.tab.favorites': 'Favorites',
  'synci.tab.downloaded': 'Downloaded',
  'synci.search.placeholder': 'Search music…',
  'synci.search.go': 'Search',
  'synci.filter.mood': 'Mood',
  'synci.filter.genre': 'Genre',
  'synci.filter.more': 'Filters',
  'synci.filter.bpm': 'BPM',
  'synci.filter.duration': 'Duration',
  'synci.filter.hasLyrics': 'Has lyrics',
  'synci.filter.apply': 'Apply',
  'synci.filter.reset': 'Reset',
  'synci.suggest': 'AI suggest',
  'synci.suggestMenu.script': 'From a script',
  'synci.suggestMenu.frame': 'Current timeline frame',
  'synci.suggestMenu.image': 'Upload image',
  'synci.suggestMenu.video': 'Upload video',
  'synci.suggestMenu.audio': 'From timeline audio',
  'synci.analyze.capturing': 'Capturing frame…',
  'synci.analyze.exporting': 'Exporting audio…',
  'synci.analyze.analyzing': 'Analyzing…',
  'synci.analyze.tooLarge': 'That file is too large (max 50 MB).',
  'synci.analyze.audioTooLong': 'Audio is too long. Set In/Out points to a shorter range (≤10 min).',
  'synci.error.frame': 'Could not capture the timeline frame.',
  'synci.error.audioExport': 'Could not export the timeline audio.',
  'synci.quality.label': 'Quality',
  'synci.quality.default': 'Default download quality',
  'synci.chip.search': 'Search',
  'synci.projectScope': 'Project',
  'synci.allProjects': 'All projects',
  'synci.loadMore': 'Load more',
  'synci.loading': 'Loading…',
  'synci.endOfResults': 'End of results',
  'synci.empty.browse': 'No tracks found. Try a shorter keyword or clear some filters.',
  'synci.empty.favorites': 'No favorites yet. Tap the heart on any track to save it.',
  'synci.empty.downloaded': 'Nothing downloaded from Synci yet.',
  'synci.preview': 'Preview',
  'synci.favorite': 'Favorite',
  'synci.addToTimeline': 'Add to timeline',
  'synci.download': 'Download',
  'synci.added': 'Added to timeline',
  'synci.dock.close': 'Close',
  'synci.dock.in': 'In',
  'synci.dock.out': 'Out',
  'synci.dock.download': 'Download',
  'synci.dock.downloadTrim': 'Download & Trim',
  'synci.dock.dragHint': 'Drag onto your editor timeline',
  'synci.dock.actionHint': 'Click to download · Drag onto your timeline',
  'synci.dock.preparing': 'Preparing file…',
  'synci.dock.preparingShort': 'Preparing…',
  'synci.dock.ready': 'Ready — drag it to your timeline.',
  'synci.script.title': 'Find music from a script',
  'synci.script.placeholder': 'Paste your script or voiceover here…',
  'synci.script.analyze': 'Find music',
  'synci.script.analyzing': 'Analyzing…',
  'synci.script.cancel': 'Cancel',
  'synci.error.generic': 'Something went wrong. Please try again.',
  'synci.error.noAudio': 'No audio available for this track.',
  'synci.error.import': 'Could not import the track into the timeline.'
};

// Expose globally for the desktop host (classic <script>, no module system).
if (typeof window !== 'undefined') {
  window.SynciManager = SynciManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SynciManager;
}

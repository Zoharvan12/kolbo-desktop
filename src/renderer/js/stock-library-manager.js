// ============================================================================
// Kolbo Studio — Stock Media Library Manager
// ============================================================================
// Multi-source stock browser (Pexels / Unsplash / Pixabay / Coverr / Freesound /
// Sketchfab / Kolbo AI / Synci). Vanilla-JS sibling of SynciManager; shares the
// /api/stock/* backend. Visual fidelity matched to kolbo-map's StockLibrary
// (Lucide icons, chip icons, masonry, attribution footer) AND the desktop Synci
// panel (glass styling, full-width inline waveform).
//
// Two render modes by media type:
//   - VISUAL (image/illustration/vector/video/3d): flexbox column-bucket masonry
//     (round-robin → real vertical scroll; NOT CSS columns, which scroll sideways).
//   - AUDIO  (music/sfx): full-width waveform rows + single shared player.
//
// The bridge abstracts "place the asset": desktop saves to disk + imports to the
// Kolbo media library; the plugin ports pass a bridge.placeAsset that imports to
// the host timeline. Brand names render literally (attribution is a licence req).
// ============================================================================

class StockLibraryManager {
  constructor(bridge, apiClient) {
    this.bridge = bridge;
    this.api = apiClient;

    this.assets = [];
    this.page = 1;
    this.perPage = 30;
    this.nextCursor = null;        // Sketchfab (3d) opaque cursor
    this.hasMore = true;
    this.loading = false;
    this.section = 'browse';       // 'browse' | 'favorites' | 'downloaded'
    this._reqId = 0;

    this.query = '';
    this.source = 'all';
    this.mediaType = 'image';
    this.filters = Object.assign({}, StockLibraryManager.DEFAULT_FILTERS);

    this.sourcesList = [];
    this.allMediaTypes = [];
    this._catCache = {};           // `${source}:${mediaType}` -> { cats, facets }
    this._facetOpts = { genre: [], mood: [], theme: [], instrument: [] };
    this._openFacet = null;        // which facet dropdown is expanded
    this.collections = [];
    this.favorited = new Set();
    this._favIdsLoaded = false;
    this._optimizedQuery = null;   // AI-rewritten query (Sparkles hint)
    this.sortOrder = null;         // stock `order` param (null = relevance)
    this._musicBounds = null;      // lazy [min,max] BPM + duration for the sliders
    this._seed = null;             // shuffle seed for "surprise me" (no-query browse)
    this._seedActive = false;

    this.gridCols = parseInt(localStorage.getItem('kolbo_stock_grid_cols') || '4', 10) || 4;
    this.favProjectId = localStorage.getItem('kolbo_stock_fav_project') || 'all';

    this._playing = null;          // single shared <audio>
    this._colEls = [];             // masonry column buckets

    this._built = false;

    // rAF-throttle the infinite-scroll handler (coalesces layout reads to 1/frame).
    this._scrollRaf = 0;
    this._scrollHandler = () => {
      if (this._scrollRaf) return;
      this._scrollRaf = requestAnimationFrame(() => { this._scrollRaf = 0; this._onScroll(); });
    };
    this._restoreState(); // last-visited mediaType / source / query / filters / sort / section
    console.log('[Stock] StockLibraryManager initialized');
  }

  // ── Persist + restore the last browse state (parity with kolbo-map) ───────
  _stateKey() { return 'kolbo_stock_state'; }
  _saveState() {
    try {
      if (this._albumMode) return; // don't persist the transient album view
      const f = this.filters || {};
      localStorage.setItem(this._stateKey(), JSON.stringify({
        mediaType: this.mediaType, source: this.source, query: this.query,
        section: this.section, sortOrder: this.sortOrder,
        filters: {
          category: f.category, subcategory: f.subcategory, genre: f.genre, mood: f.mood,
          theme: f.theme, instrument: f.instrument, vocals: f.vocals, orientation: f.orientation,
          color: f.color, bpmMin: f.bpmMin, bpmMax: f.bpmMax, durationMin: f.durationMin, durationMax: f.durationMax
        }
      }));
    } catch (e) { /* localStorage may be unavailable */ }
  }
  _restoreState() {
    try {
      const raw = localStorage.getItem(this._stateKey()); if (!raw) return;
      const s = JSON.parse(raw); if (!s || typeof s !== 'object') return;
      if (s.mediaType) { this.mediaType = s.mediaType; this._mtInit = true; }
      if (s.source) this.source = s.source;
      if (typeof s.query === 'string') this.query = s.query;
      if (s.sortOrder) this.sortOrder = s.sortOrder;
      if (s.section === 'favorites' || s.section === 'downloaded' || s.section === 'browse') this.section = s.section;
      if (s.filters && typeof s.filters === 'object') this.filters = Object.assign({}, StockLibraryManager.DEFAULT_FILTERS, s.filters);
    } catch (e) { /* ignore corrupt state */ }
  }

  static get MAX_ASSETS() { return 600; }
  static get MEDIA_MAX_BYTES() { return 48 * 1024 * 1024; }
  static get AUDIO_TYPES() { return ['music', 'sfx']; }

  // ── icon helper (exact Lucide markup → matches kolbo-map; renders without the
  //    lucide JS runtime so it's identical across desktop + CEP plugins) ───────
  _icon(name, size) {
    const p = StockLibraryManager.ICONS[name] || '';
    const s = size || 16;
    return '<svg class="stock-i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="' +
      (name === 'play' ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  t(key, vars) {
    if (typeof window.t === 'function') { const out = window.t(key, vars); if (out && out !== key) return out; }
    let s = (StockLibraryManager.FALLBACK && StockLibraryManager.FALLBACK[key]) || key;
    if (vars) Object.keys(vars).forEach((k) => { s = s.replace('{{' + k + '}}', vars[k]); });
    return s;
  }
  isAudio() { return StockLibraryManager.AUDIO_TYPES.indexOf(this.mediaType) >= 0; }
  isAuth() { return !!(this.api && this.api.isAuthenticated && this.api.isAuthenticated()); }
  requireAuth() {
    if (this.isAuth()) return true;
    if (window.app && typeof window.app.showLoginScreen === 'function') window.app.showLoginScreen();
    return false;
  }
  currentProjectId() {
    const sel = window.app && window.app.selectedProjectId;
    return (sel && sel !== 'all') ? sel : null;
  }
  // Where imports/favorites/downloads are saved: the in-panel project picker when
  // set, else the host app's current project. Self-contained (no currentProjectId
  // call) so it's safe to route every write path through it.
  _targetProjectId() {
    if (this.favProjectId && this.favProjectId !== 'all') return this.favProjectId;
    const sel = window.app && window.app.selectedProjectId;
    return (sel && sel !== 'all') ? sel : null;
  }

  // ==========================================================================
  // Activation / build
  // ==========================================================================
  async activate() {
    this._build();
    if (!this.sourcesList.length) await this._loadSources();
    this._ensureProjectText();
    if (this.isAuth() && !this._favIdsLoaded) this._loadFavoriteIds();
    // Restore the last-visited search box text.
    const input = document.getElementById('stock-search-input'); if (input && this.query) input.value = this.query;
    if (this.assets.length === 0 && !this.loading) {
      // Re-open the last section (favorites/downloaded need auth; else fall to browse).
      if ((this.section === 'favorites' || this.section === 'downloaded') && this.isAuth()) this.switchSection(this.section, true);
      else { this.section = 'browse'; this.runSearch(); }
    }
  }

  _build() {
    if (this._built) return;
    const root = document.getElementById('stock-view');
    if (!root) { console.warn('[Stock] #stock-view not found'); return; }

    root.innerHTML =
      '<div class="stock-panel">' +
        '<div class="stock-header">' +
          '<div class="stock-title">' + this._esc(this.t('stock.title')) + '</div>' +
          '<div class="stock-grid-density" title="' + this._escAttr(this.t('stock.gridDensity')) + '">' +
            this._icon('grid2x2', 14) +
            '<input type="range" id="stock-grid-range" aria-label="' + this._escAttr(this.t('stock.gridDensity')) + '" min="2" max="8" step="1" value="' + this.gridCols + '">' +
            this._icon('grid3x3', 14) +
          '</div>' +
        '</div>' +

        '<div class="stock-tabs">' +
          '<button class="stock-tab active" data-section="browse">' + this._esc(this.t('stock.tab.browse')) + '</button>' +
          '<button class="stock-tab" data-section="favorites">' + this._esc(this.t('stock.tab.favorites')) + '</button>' +
          '<button class="stock-tab" data-section="downloaded">' + this._esc(this.t('stock.tab.downloaded')) + '</button>' +
        '</div>' +

        '<div class="stock-searchbar">' +
          '<span class="stock-search-icon">' + this._icon('search', 15) + '</span>' +
          '<input type="text" id="stock-search-input" class="stock-search-input" aria-label="' + this._escAttr(this.t('stock.search.placeholder')) + '" placeholder="' + this._escAttr(this.t('stock.search.placeholder')) + '">' +
          '<button id="stock-vision-btn" class="stock-smart-btn" aria-label="' + this._escAttr(this.t('stock.smart.vision')) + '" title="' + this._escAttr(this.t('stock.smart.vision')) + '">' + this._icon('imagePlus', 15) + '</button>' +
          '<button id="stock-script-btn" class="stock-smart-btn" aria-label="' + this._escAttr(this.t('stock.smart.script')) + '" title="' + this._escAttr(this.t('stock.smart.script')) + '">' + this._icon('fileText', 15) + '</button>' +
          '<button id="stock-search-btn" class="stock-search-btn">' + this._esc(this.t('stock.search.go')) + '</button>' +
        '</div>' +

        '<div id="stock-ai-hint" class="stock-ai-hint hidden"></div>' +

        '<div id="stock-mediatypes" class="stock-chiprow stock-mediatypes"></div>' +
        '<div id="stock-sources" class="stock-chiprow stock-sources"></div>' +
        '<div id="stock-collections" class="stock-rail hidden"></div>' +
        '<div id="stock-facets" class="stock-facets hidden"></div>' +
        '<div id="stock-controls" class="stock-controls hidden"></div>' +
        '<div id="stock-ranges" class="stock-ranges hidden"></div>' +
        '<div id="stock-categories" class="stock-chiprow stock-categories"></div>' +
        '<div id="stock-albumview" class="stock-albumview hidden"></div>' +

        '<div id="stock-project-bar" class="stock-project-bar">' +
          '<label>' + this._esc(this.t('stock.projectScope')) + '</label>' +
          '<button id="stock-project-select" class="stock-dd-trigger" type="button"><span id="stock-project-text">' + this._esc(this.t('stock.allProjects')) + '</span>' + this._icon('chevronDown', 12) + '</button>' +
        '</div>' +

        '<div id="stock-partial" class="stock-partial hidden"></div>' +

        '<div class="stock-results-wrap">' +
          '<div id="stock-results" class="stock-results"></div>' +
          '<div id="stock-loading" class="stock-loading hidden"><span class="stock-spinner stock-spinner-lg"></span><span class="stock-loading-text">' + this._esc(this.t('stock.loading')) + '</span></div>' +
          '<div id="stock-sentinel" class="stock-sentinel"></div>' +
        '</div>' +
        '<div id="stock-more" class="stock-more hidden"><span class="stock-spinner"></span><span>' + this._esc(this.t('stock.loading')) + '</span></div>' +
        '<div id="stock-status" class="stock-status" role="status" aria-live="polite"></div>' +
        '<div id="stock-footer" class="stock-footer"></div>' +

        // Now-playing / trim dock (audio + video) — Synci-style.
        '<div id="stock-dock" class="stock-dock hidden">' +
          '<button id="stock-dock-close" class="stock-dock-close" aria-label="' + this._escAttr(this.t('stock.close')) + '">' + this._icon('x', 16) + '</button>' +
          '<video id="stock-dock-video" class="stock-dock-video hidden" playsinline muted></video>' +
          '<div class="stock-dock-bar">' +
            '<img id="stock-dock-art" class="stock-dock-art" alt="">' +
            '<button id="stock-dock-play" class="stock-dock-play"><span class="stock-pp">' + this._icon('play', 14) + '</span></button>' +
            '<div class="stock-dock-meta"><div id="stock-dock-title" class="stock-dock-title"></div><div id="stock-dock-sub" class="stock-dock-sub"></div></div>' +
            '<div id="stock-dock-track" class="stock-dock-track">' +
              '<canvas id="stock-dock-wave" class="stock-dock-wave"></canvas>' +
              '<div id="stock-dock-played" class="stock-dock-played"></div>' +
              '<div id="stock-dock-mask-l" class="stock-dock-mask"></div>' +
              '<div id="stock-dock-mask-r" class="stock-dock-mask"></div>' +
              '<div id="stock-dock-region" class="stock-dock-region" draggable="true" title="' + this._escAttr(this.t('stock.dragTrim')) + '"></div>' +
              '<div id="stock-dock-in" class="stock-dock-handle" title="' + this._escAttr(this.t('stock.in')) + '"></div>' +
              '<div id="stock-dock-out" class="stock-dock-handle" title="' + this._escAttr(this.t('stock.out')) + '"></div>' +
            '</div>' +
            '<span id="stock-dock-time" class="stock-dock-time">0:00 / 0:00</span>' +
            '<span id="stock-dock-inout" class="stock-dock-inout"></span>' +
            '<div class="stock-dock-actions">' +
              '<button id="stock-dock-import" class="stock-act" aria-label="' + this._escAttr(this.t('stock.import')) + '" title="' + this._escAttr(this.t('stock.import')) + '">' + this._icon('folderPlus', 15) + '</button>' +
              '<button id="stock-dock-download" class="stock-act" aria-label="' + this._escAttr(this.t('stock.download')) + '" title="' + this._escAttr(this.t('stock.download')) + '">' + this._icon('download', 15) + '</button>' +
              '<button id="stock-dock-drag" class="stock-act stock-dock-drag" draggable="true" title="' + this._escAttr(this.t('stock.dragHint')) + '">' + this._icon('layers', 15) + '</button>' +
            '</div>' +
          '</div>' +
          '<div id="stock-dock-loading" class="stock-dock-loading hidden"><span class="stock-spinner"></span> ' + this._esc(this.t('stock.preparing')) + '</div>' +
          '<audio id="stock-dock-audio"></audio>' +
        '</div>' +

        '<div id="stock-script-dialog" class="stock-dialog hidden">' +
          '<div class="stock-dialog-box">' +
            '<div class="stock-dialog-title">' + this._esc(this.t('stock.script.title')) + '</div>' +
            '<textarea id="stock-script-text" class="stock-dialog-text" rows="6" placeholder="' + this._escAttr(this.t('stock.script.placeholder')) + '"></textarea>' +
            '<div class="stock-dialog-actions">' +
              '<button id="stock-script-cancel" class="stock-btn-ghost">' + this._esc(this.t('stock.cancel')) + '</button>' +
              '<button id="stock-script-run" class="stock-btn-primary">' + this._esc(this.t('stock.script.run')) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div id="stock-lyrics-dialog" class="stock-dialog hidden">' +
          '<div class="stock-dialog-box">' +
            '<div class="stock-dialog-title" id="stock-lyrics-title"></div>' +
            '<pre id="stock-lyrics-body" class="stock-lyrics-body"></pre>' +
            '<div class="stock-dialog-actions"><button id="stock-lyrics-close" class="stock-btn-ghost">' + this._esc(this.t('stock.close')) + '</button></div>' +
          '</div>' +
        '</div>' +

        '<div id="stock-preview" class="stock-preview hidden">' +
          '<div class="stock-preview-backdrop"></div>' +
          '<div class="stock-preview-box">' +
            '<button id="stock-preview-close" class="stock-preview-close" aria-label="' + this._escAttr(this.t('stock.close')) + '">' + this._icon('x', 18) + '</button>' +
            '<div id="stock-preview-media" class="stock-preview-media"></div>' +
            '<div id="stock-preview-info" class="stock-preview-info"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    this._wire();
    this._applyGridCols();
    this._built = true;
  }

  _wire() {
    const root = document.getElementById('stock-view');
    root.querySelectorAll('.stock-tab').forEach((b) => b.addEventListener('click', () => this.switchSection(b.dataset.section)));

    const input = document.getElementById('stock-search-input');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._onSearchSubmit(); });
    const sb = document.getElementById('stock-search-btn'); if (sb) sb.addEventListener('click', () => this._onSearchSubmit());
    const vb = document.getElementById('stock-vision-btn'); if (vb) vb.addEventListener('click', () => this._openVisionMenu(vb));
    const scb = document.getElementById('stock-script-btn'); if (scb) scb.addEventListener('click', () => this._openScript());
    const sc = document.getElementById('stock-script-cancel'); if (sc) sc.addEventListener('click', () => this._closeScript());
    const sr = document.getElementById('stock-script-run'); if (sr) sr.addEventListener('click', () => this._runScript());
    const lc = document.getElementById('stock-lyrics-close'); if (lc) lc.addEventListener('click', () => document.getElementById('stock-lyrics-dialog').classList.add('hidden'));

    const range = document.getElementById('stock-grid-range');
    if (range) range.addEventListener('input', () => {
      this.gridCols = parseInt(range.value, 10) || 4;
      localStorage.setItem('kolbo_stock_grid_cols', String(this.gridCols));
      this._applyGridCols();
      if (!this.isAudio()) this._render(false); // rebuild buckets at the new column count
    });

    const ps = document.getElementById('stock-project-select'); if (ps) ps.addEventListener('click', () => this._openProjectMenu(ps));
    const results = document.getElementById('stock-results'); if (results) results.addEventListener('scroll', this._scrollHandler, { passive: true });
    const pc = document.getElementById('stock-preview-close'); if (pc) pc.addEventListener('click', () => this._closePreview());
    const pb = document.querySelector('#stock-preview .stock-preview-backdrop'); if (pb) pb.addEventListener('click', () => this._closePreview());
    this._wireDock();
  }

  // ==========================================================================
  // Sources / media types / categories / collections / facets
  // ==========================================================================
  async _loadSources() {
    try {
      const res = await this.api.stockSources();
      if (!res || res.status === false) return;
      this.sourcesList = Array.isArray(res.sources) ? res.sources : [];
      this.allMediaTypes = Array.isArray(res.mediaTypes) ? res.mediaTypes : [];
      const supported = this._supportedMediaTypes();
      // Land on the first tab (video) on first open; otherwise keep a valid type.
      if (!this._mtInit && supported.length) { this.mediaType = supported[0]; this._mtInit = true; }
      else if (supported.indexOf(this.mediaType) < 0 && supported.length) this.mediaType = supported[0];
      this._renderMediaTypes();
      this._renderSources();
      this._renderFooter();
      this._renderControls();
      this._renderRanges();
      await this._loadCategories();
      await this._loadCollections();
    } catch (err) { console.warn('[Stock] sources load failed:', err && err.message); }
  }

  _supportedMediaTypes() {
    const set = new Set();
    this.sourcesList.forEach((s) => (s.mediaTypes || []).forEach((m) => set.add(m)));
    // Curated order (video first); illustration hidden. In an NLE host (plugin),
    // hide 3D — a timeline can't place a GLB. Desktop/web keep 3D.
    const inHost = !!(this.bridge && typeof this.bridge.placeAsset === 'function');
    return StockLibraryManager.MT_ORDER.filter((m) => set.has(m) && m !== 'illustration' && !(inHost && m === '3d'));
  }
  _sourcesForMediaType(mt) { return this.sourcesList.filter((s) => (s.mediaTypes || []).indexOf(mt) >= 0); }

  _renderMediaTypes() {
    const box = document.getElementById('stock-mediatypes');
    if (!box) return;
    box.innerHTML = this._supportedMediaTypes().map((m) =>
      '<button class="stock-chip stock-chip-icon' + (m === this.mediaType ? ' active' : '') + '" data-mt="' + this._escAttr(m) + '">' +
        this._icon(StockLibraryManager.MT_ICON[m] || 'image', 14) + '<span>' + this._esc(this.t('stock.mt.' + m)) + '</span></button>').join('');
    box.querySelectorAll('.stock-chip').forEach((c) => c.addEventListener('click', () => this._selectMediaType(c.dataset.mt)));
  }

  _renderSources() {
    const box = document.getElementById('stock-sources');
    if (!box) return;
    let html = '<button class="stock-chip stock-chip-sm stock-chip-icon' + (this.source === 'all' ? ' active' : '') + '" data-src="all">' +
      this._icon('layoutGrid', 13) + '<span>' + this._esc(this.t('stock.allSources')) + '</span></button>';
    html += this._sourcesForMediaType(this.mediaType).map((s) =>
      '<button class="stock-chip stock-chip-sm stock-chip-icon' + (s.key === this.source ? ' active' : '') + '" data-src="' + this._escAttr(s.key) + '">' +
        this._sourceIconHtml(s.key, 14) + '<span>' + this._esc(s.label) + '</span></button>').join('');
    box.innerHTML = html;
    box.querySelectorAll('.stock-chip').forEach((c) => c.addEventListener('click', () => this._selectSource(c.dataset.src)));
  }

  _selectMediaType(mt) {
    if (!mt || mt === this.mediaType) return;
    this.mediaType = mt;
    if (this.source !== 'all' && this._sourcesForMediaType(mt).every((s) => s.key !== this.source)) this.source = 'all';
    // Reset type-specific filters (categories/facets/ranges) but KEEP the search
    // query so it carries across Photos ↔ Video ↔ Music ↔ SFX, etc.
    this.filters = Object.assign({}, StockLibraryManager.DEFAULT_FILTERS);
    this._openFacet = null;
    this._renderMediaTypes(); this._renderSources(); this._renderFooter();
    this._renderControls(); this._renderRanges();
    this._loadCategories(); this._loadCollections();
    this.runSearch();
  }
  _selectSource(src) {
    if (src === this.source) return;
    this.source = src || 'all';
    this.filters.category = null; this.filters.subcategory = null;
    this._renderSources(); this._renderFooter();
    this._loadCategories(); this._loadCollections();
    this.runSearch();
  }

  async _loadCategories() {
    const box = document.getElementById('stock-categories');
    if (!box) return;
    const key = (this.source || 'all') + ':' + this.mediaType;
    let entry = this._catCache[key];
    if (!entry) {
      let cats = [];
      try {
        const res = await this.api.stockCategories({ source: this.source !== 'all' ? this.source : undefined, mediaType: this.mediaType });
        cats = (res && Array.isArray(res.categories)) ? res.categories : [];
      } catch (e) { cats = []; }
      entry = { cats };
      this._catCache[key] = entry;
    }
    // Split: facet-typed (genre/mood/theme/instrument) drive the facet dropdowns;
    // the rest are plain category/query chips.
    const facetTypes = ['genre', 'mood', 'theme', 'instrument'];
    this._facetOpts = { genre: [], mood: [], theme: [], instrument: [] };
    const chips = [];
    entry.cats.forEach((c) => {
      if (facetTypes.indexOf(c.paramType) >= 0) this._facetOpts[c.paramType].push(c);
      else chips.push(c);
    });

    if (!chips.length) box.innerHTML = '';
    else {
      box.innerHTML = chips.slice(0, 40).map((c) => {
        const active = (this.filters.category && this.filters.category === c.providerParam) || (c.paramType === 'query' && this.query === c.providerParam);
        return '<button class="stock-chip stock-chip-sm' + (active ? ' active' : '') + '" data-param="' + this._escAttr(c.providerParam) + '" data-ptype="' + this._escAttr(c.paramType || 'category') + '" data-csrc="' + this._escAttr(c.source || '') + '">' + this._esc(c.label) + '</button>';
      }).join('');
      box.querySelectorAll('.stock-chip').forEach((chip) => chip.addEventListener('click', () => this._selectCategory(chip.dataset.param, chip.dataset.ptype, chip.dataset.csrc)));
    }
    this._renderFacets();
  }

  _selectCategory(param, ptype, csrc) {
    if (csrc && csrc !== 'all' && csrc !== this.source && this._sourcesForMediaType(this.mediaType).some((s) => s.key === csrc)) { this.source = csrc; this._renderSources(); this._renderFooter(); }
    if (ptype === 'query') {
      this.query = (this.query === param) ? '' : param;
      const input = document.getElementById('stock-search-input'); if (input) input.value = this.query;
      this.filters.category = null;
    } else {
      this.filters.category = (this.filters.category === param) ? null : param;
    }
    this._loadCategories();
    this.runSearch();
  }

  _renderFacets() {
    const box = document.getElementById('stock-facets');
    if (!box) return;
    const dims = ['genre', 'mood', 'theme', 'instrument'].filter((d) => (this._facetOpts[d] || []).length);
    const hasFacets = this.isAudio() && (dims.length || this.mediaType === 'music');
    box.classList.toggle('hidden', !hasFacets);
    if (!hasFacets) return;

    let html = '<div class="stock-facet-bar">';
    dims.forEach((d) => {
      const sel = this.filters[d];
      html += '<button class="stock-facet-toggle' + (this._openFacet === d ? ' open' : '') + (sel ? ' has' : '') + '" data-facet="' + d + '">' +
        this._esc(this.t('stock.facet.' + d)) + (sel ? ': ' + this._esc(sel) : '') + this._icon('chevronDown', 11) + '</button>';
    });
    if (this.mediaType === 'music') {
      const v = this.filters.vocals || 'all';
      html += '<span class="stock-seg-group">' + ['all', 'instrumental', 'vocals'].map((opt) =>
        '<button class="stock-seg' + (v === opt ? ' active' : '') + '" data-vocals="' + opt + '">' + this._esc(this.t('stock.vocals.' + opt)) + '</button>').join('') + '</span>';
    }
    const anyActive = dims.some((d) => this.filters[d]) || (this.filters.vocals);
    if (anyActive) html += '<button class="stock-facet-clear" data-clear="1">' + this._icon('x', 12) + this._esc(this.t('stock.clear')) + '</button>';
    html += '</div>';

    if (this._openFacet && (this._facetOpts[this._openFacet] || []).length) {
      html += '<div class="stock-facet-panel">' + this._facetOpts[this._openFacet].map((c) => {
        const active = this.filters[this._openFacet] === c.providerParam;
        return '<button class="stock-chip stock-chip-sm' + (active ? ' active' : '') + '" data-fval="' + this._escAttr(c.providerParam) + '">' + this._esc(c.label) + '</button>';
      }).join('') + '</div>';
    }
    box.innerHTML = html;

    box.querySelectorAll('.stock-facet-toggle').forEach((b) => b.addEventListener('click', () => {
      this._openFacet = this._openFacet === b.dataset.facet ? null : b.dataset.facet; this._renderFacets();
    }));
    box.querySelectorAll('.stock-chip[data-fval]').forEach((b) => b.addEventListener('click', () => {
      const d = this._openFacet; const val = b.dataset.fval;
      this.filters[d] = this.filters[d] === val ? null : val;
      this._openFacet = null; this._renderFacets(); this.runSearch();
    }));
    box.querySelectorAll('.stock-seg').forEach((b) => b.addEventListener('click', () => {
      this.filters.vocals = b.dataset.vocals === 'all' ? null : b.dataset.vocals; this._renderFacets(); this.runSearch();
    }));
    const clr = box.querySelector('[data-clear]');
    if (clr) clr.addEventListener('click', () => {
      ['genre', 'mood', 'theme', 'instrument', 'vocals'].forEach((k) => { this.filters[k] = null; });
      this._openFacet = null; this._renderFacets(); this.runSearch();
    });
  }

  async _loadCollections() {
    const rail = document.getElementById('stock-collections');
    if (!rail) return;
    // Owned (kolbo-ai) sfx/music only.
    const ownedSelected = this.source === 'kolbo-ai' || this.source === 'all';
    if (!ownedSelected || !this.isAudio() || typeof this.api.stockCollections !== 'function') { rail.classList.add('hidden'); rail.innerHTML = ''; return; }
    try {
      const res = await this.api.stockCollections({ mediaType: this.mediaType });
      this.collections = (res && Array.isArray(res.collections)) ? res.collections : [];
    } catch (e) { this.collections = []; }
    if (!this.collections.length) { rail.classList.add('hidden'); rail.innerHTML = ''; return; }
    rail.classList.remove('hidden');
    rail.innerHTML = this.collections.map((c) => {
      const active = this.filters.collectionId === c.id;
      const cover = c.coverUrl ? '<img src="' + this._escAttr(c.coverUrl) + '" alt="" loading="lazy">' : '';
      return '<button class="stock-coll' + (active ? ' active' : '') + '" data-coll="' + this._escAttr(c.id) + '" title="' + this._escAttr(c.title) + '">' +
        cover + '<span class="stock-coll-title">' + this._esc(c.title) + '</span></button>';
    }).join('');
    rail.querySelectorAll('.stock-coll').forEach((b) => b.addEventListener('click', () => {
      const coll = (this.collections || []).filter((x) => x.id === b.dataset.coll)[0];
      // Music collections open a dedicated album page; SFX packs just filter the grid.
      if (this.mediaType === 'music' && coll && coll.slug) { this._openAlbum(coll); return; }
      this.filters.collectionId = this.filters.collectionId === b.dataset.coll ? null : b.dataset.coll;
      this._loadCollections(); this.runSearch();
    }));
  }

  // ── Sort + surprise controls ─────────────────────────────────────────────
  _sortOptions() {
    const o = (v, k) => ({ value: v, label: this.t(k) });
    const base = [o('relevance', 'stock.sort.relevance'), o('popular', 'stock.sort.popular'), o('newest', 'stock.sort.newest')];
    if (this.isAudio()) base.push(o('bpm_asc', 'stock.sort.bpmAsc'), o('bpm_desc', 'stock.sort.bpmDesc'), o('duration_asc', 'stock.sort.durAsc'), o('duration_desc', 'stock.sort.durDesc'));
    return base;
  }
  _renderControls() {
    const box = document.getElementById('stock-controls');
    if (!box) return;
    if (this.section !== 'browse') { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    const opts = this._sortOptions();
    const cur = opts.filter((o) => o.value === (this.sortOrder || 'relevance'))[0] || opts[0];
    box.innerHTML =
      '<button id="stock-sort" class="stock-dd-trigger stock-sort" type="button" title="' + this._escAttr(this.t('stock.sort.label')) + '">' +
        this._icon('arrowUpDown', 13) + '<span>' + this._esc(cur.label) + '</span>' + this._icon('chevronDown', 12) + '</button>' +
      '<button id="stock-surprise" class="stock-ctl-btn' + (this._seedActive ? ' active' : '') + '" type="button" title="' + this._escAttr(this.t('stock.surprise')) + '">' +
        this._icon('shuffle', 14) + '<span>' + this._esc(this.t('stock.surprise')) + '</span></button>';
    const sortBtn = document.getElementById('stock-sort');
    if (sortBtn) sortBtn.addEventListener('click', () => KolboDropdown.open({
      trigger: sortBtn, noAvatar: true,
      items: opts.map((o) => ({ id: o.value, label: o.label, selected: (this.sortOrder || 'relevance') === o.value })),
      onSelect: (v) => { this.sortOrder = (v === 'relevance') ? null : v; if (this.sortOrder) { this._seedActive = false; } this._renderControls(); this.runSearch(); }
    }));
    const sp = document.getElementById('stock-surprise');
    if (sp) sp.addEventListener('click', () => { this._seedActive = true; this._seed = this._newSeed(); this.sortOrder = null; this._renderControls(); this.runSearch(); });
  }
  _newSeed() { return Math.random().toString(36).slice(2, 10); }

  // ── Music range sliders (BPM + duration) ─────────────────────────────────
  async _renderRanges() {
    const box = document.getElementById('stock-ranges');
    if (!box) return;
    const show = this.section === 'browse' && this.mediaType === 'music';
    box.classList.toggle('hidden', !show);
    if (!show) { box.innerHTML = ''; return; }
    if (!this._musicBounds && typeof this.api.stockMusicBounds === 'function') {
      try { this._musicBounds = await this.api.stockMusicBounds(); } catch (e) { this._musicBounds = { bpm: [40, 200], duration: [0, 360] }; }
    }
    const b = this._musicBounds || { bpm: [40, 200], duration: [0, 360] };
    box.innerHTML =
      this._rangeHtml('bpm', this.t('stock.range.bpm'), b.bpm[0], b.bpm[1], this.filters.bpmMin, this.filters.bpmMax, '') +
      this._rangeHtml('dur', this.t('stock.range.duration'), b.duration[0], b.duration[1], this.filters.durationMin, this.filters.durationMax, 's');
    this._wireRange(box);
  }
  _rangeValText(a, b, min, max, unit) {
    if (a <= min && b >= max) return this.t('stock.range.any');
    if (unit === 's') return this._fmtDur(a) + '–' + this._fmtDur(b);
    return a + '–' + b;
  }
  _rangeHtml(id, label, min, max, curMin, curMax, unit) {
    const lo = (curMin != null ? curMin : min), hi = (curMax != null ? curMax : max);
    return '<div class="stock-range" data-range="' + id + '" data-min="' + min + '" data-max="' + max + '" data-unit="' + unit + '">' +
      '<div class="stock-range-head"><span class="stock-range-label">' + this._esc(label) + '</span>' +
        '<span class="stock-range-val" data-rv="1">' + this._esc(this._rangeValText(lo, hi, min, max, unit)) + '</span></div>' +
      '<div class="stock-range-track">' +
        '<div class="stock-range-rail"></div><div class="stock-range-fill" data-rf="1"></div>' +
        '<input type="range" class="stock-range-lo" min="' + min + '" max="' + max + '" value="' + lo + '" step="1">' +
        '<input type="range" class="stock-range-hi" min="' + min + '" max="' + max + '" value="' + hi + '" step="1">' +
      '</div></div>';
  }
  _wireRange(box) {
    box.querySelectorAll('.stock-range').forEach((r) => {
      const id = r.dataset.range, min = +r.dataset.min, max = +r.dataset.max, unit = r.dataset.unit || '';
      const lo = r.querySelector('.stock-range-lo'), hi = r.querySelector('.stock-range-hi');
      const fill = r.querySelector('[data-rf]'), val = r.querySelector('[data-rv]');
      const span = (max - min) || 1;
      const bounds = () => { let a = +lo.value, b = +hi.value; if (a > b) { const t = a; a = b; b = t; } return [a, b]; };
      const paint = () => {
        const ab = bounds();
        if (fill) { fill.style.left = ((ab[0] - min) / span * 100) + '%'; fill.style.right = ((max - ab[1]) / span * 100) + '%'; }
        if (val) val.textContent = this._rangeValText(ab[0], ab[1], min, max, unit);
      };
      const commit = () => {
        const ab = bounds();
        const fMin = id === 'bpm' ? 'bpmMin' : 'durationMin', fMax = id === 'bpm' ? 'bpmMax' : 'durationMax';
        this.filters[fMin] = (ab[0] <= min) ? null : ab[0];
        this.filters[fMax] = (ab[1] >= max) ? null : ab[1];
        this.runSearch();
      };
      lo.addEventListener('input', paint); hi.addEventListener('input', paint);
      lo.addEventListener('change', commit); hi.addEventListener('change', commit);
      paint();
    });
  }

  // ── Album view (dedicated page: hero + tracks + similar) ──────────────────
  // Tracks come straight from GET /stock/collection/:slug (the source of truth),
  // NOT a collectionId-filtered search — mirrors kolbo-map's StockAlbumPage.
  async _openAlbum(coll) {
    if (!coll || !coll.slug) return;
    this._albumMode = true; this._albumSlug = coll.slug; this.section = 'browse';
    const panel = document.querySelector('#stock-view .stock-panel'); if (panel) panel.classList.add('stock-album-mode');
    this._stopPlayback(); this._clearResults(); this._setStatus('');
    const view = document.getElementById('stock-albumview');
    if (view) { view.classList.remove('hidden'); view.innerHTML = '<div class="stock-album-load"><span class="stock-spinner stock-spinner-lg"></span></div>'; }
    const results = document.getElementById('stock-results'); if (results) results.scrollTop = 0;
    try {
      const res = await this.api.stockGetCollection(coll.slug);
      if (!this._albumMode || this._albumSlug !== coll.slug) return; // navigated away
      if (!res || !res.collection) throw new Error(this.t('stock.error.generic'));
      this._album = res;
      this._renderAlbumView(res);
      this.assets = Array.isArray(res.tracks) ? res.tracks : [];
      this.hasMore = false; this.loading = false; this.nextCursor = null;
      this._render(false);
      this._setStatus(this.assets.length ? '' : this.t('stock.empty.browse'));
    } catch (err) {
      if (view) view.innerHTML = '<button class="stock-album-back">' + this._icon('chevronLeft', 14) + '<span>' + this._esc(this.t('stock.album.back')) + '</span></button>' +
        '<div class="stock-album-empty">' + this._esc(err.message || this.t('stock.error.generic')) + '</div>';
      const back = view && view.querySelector('.stock-album-back'); if (back) back.addEventListener('click', () => this._closeAlbum());
    }
  }
  _renderAlbumView(res) {
    const view = document.getElementById('stock-albumview'); if (!view) return;
    const c = res.collection, tracks = res.tracks || [], similar = res.similar || [];
    const bg = c.heroImageUrl || c.coverUrl || '', cover = c.coverUrl || c.heroImageUrl || '';
    const artist = c.artistName || 'Kolbo AI', count = c.trackCount || tracks.length;
    view.innerHTML =
      '<button class="stock-album-back">' + this._icon('chevronLeft', 14) + '<span>' + this._esc(this.t('stock.album.back')) + '</span></button>' +
      '<div class="stock-album-hero">' +
        (bg ? '<div class="stock-album-hero-bg" style="background-image:url(\'' + this._cssUrl(bg) + '\')"></div>' : '') +
        '<div class="stock-album-hero-scrim"></div>' +
        '<div class="stock-album-hero-row">' +
          (cover ? '<img class="stock-album-hero-cover" src="' + this._escAttr(cover) + '" alt="">' : '<div class="stock-album-hero-cover stock-album-hero-cover-empty">' + this._icon('music', 22) + '</div>') +
          '<div class="stock-album-hero-meta">' +
            '<div class="stock-album-hero-title" title="' + this._escAttr(c.title) + '">' + this._esc(c.title) + '</div>' +
            '<div class="stock-album-hero-sub">' + this._esc(this.t('stock.album.by', { artist: artist })) + ' · ' + this._esc(this.t('stock.album.tracks', { count: count })) + '</div>' +
            (c.description ? '<div class="stock-album-hero-desc">' + this._esc(c.description) + '</div>' : '') +
            '<div class="stock-album-hero-actions">' +
              '<button class="stock-album-play stock-btn-primary">' + this._icon('play', 13) + '<span>' + this._esc(this.t('stock.album.play')) + '</span></button>' +
              '<button class="stock-album-shuffle stock-btn-ghost">' + this._icon('shuffle', 13) + '<span>' + this._esc(this.t('stock.surprise')) + '</span></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (similar.length ? '<div class="stock-album-similar"><div class="stock-album-similar-title">' + this._esc(this.t('stock.album.similar')) + '</div>' +
        '<div class="stock-album-similar-rail">' + similar.map((s) =>
          '<button class="stock-sim" data-slug="' + this._escAttr(s.slug) + '" title="' + this._escAttr(s.title) + '">' +
            (s.coverUrl ? '<img src="' + this._escAttr(s.coverUrl) + '" alt="" loading="lazy">' : '<div class="stock-sim-empty">' + this._icon('music', 16) + '</div>') +
            '<span class="stock-sim-title">' + this._esc(s.title) + '</span></button>').join('') + '</div></div>' : '');
    const back = view.querySelector('.stock-album-back'); if (back) back.addEventListener('click', () => this._closeAlbum());
    const play = view.querySelector('.stock-album-play'); if (play) play.addEventListener('click', () => { if (tracks[0]) this._openDock(tracks[0]); });
    const shuf = view.querySelector('.stock-album-shuffle'); if (shuf) shuf.addEventListener('click', () => { if (tracks.length) this._openDock(tracks[Math.floor(Math.random() * tracks.length)]); });
    view.querySelectorAll('.stock-sim').forEach((b) => b.addEventListener('click', () => this._openAlbum({ slug: b.dataset.slug })));
  }
  _closeAlbum() {
    this._albumMode = false; this._albumSlug = null; this._album = null;
    const panel = document.querySelector('#stock-view .stock-panel'); if (panel) panel.classList.remove('stock-album-mode');
    const view = document.getElementById('stock-albumview'); if (view) { view.classList.add('hidden'); view.innerHTML = ''; }
    this.filters.collectionId = null;
    this._loadCollections(); this.runSearch();
  }
  _cssUrl(u) { return String(u == null ? '' : u).replace(/['"()\\]/g, ''); }

  // ==========================================================================
  // Search / pagination
  // ==========================================================================
  _onSearchSubmit() {
    const input = document.getElementById('stock-search-input');
    this.query = (input && input.value || '').trim();
    if (this.section !== 'browse') this._browseUI();
    this.runSearch();
  }
  _buildSearchParams() {
    const f = this.filters;
    const p = { source: this.source, mediaType: this.mediaType, perPage: this.perPage, smart: !!this.query };
    if (this.query) p.query = this.query;
    ['category', 'subcategory', 'genre', 'mood', 'theme', 'instrument', 'vocals', 'color', 'orientation', 'collectionId'].forEach((k) => { if (f[k]) p[k] = f[k]; });
    ['bpmMin', 'bpmMax', 'durationMin', 'durationMax'].forEach((k) => { if (f[k] != null) p[k] = f[k]; });
    if (this.sortOrder) p.order = this.sortOrder;
    if (this._seedActive && this._seed && !this.query) p.seed = this._seed;
    return p;
  }
  runSearch() {
    this.assets = []; this.page = 1; this.nextCursor = null; this.hasMore = true; this._optimizedQuery = null;
    this._stopPlayback(); this._clearResults(); this._setPartial(false); this._renderAiHint();
    this._saveState();
    this._fetch(false);
  }
  async _fetch(append) {
    if (this.loading || !this.hasMore) return;
    if (this.section !== 'browse') return this._loadList(false);
    this.loading = true; this._beginLoad();
    const reqId = ++this._reqId;
    try {
      const params = this._buildSearchParams();
      params.page = this.page;
      if (this.nextCursor) params.cursor = this.nextCursor;
      const res = await this.api.stockSearch(params);
      if (reqId !== this._reqId) return;
      if (res && res.status === false) throw new Error(res.message || this.t('stock.error.generic'));
      const incoming = Array.isArray(res && res.assets) ? res.assets : [];
      const seen = new Set(this.assets.map((a) => this._key(a)));
      let added = 0;
      incoming.forEach((a) => { const k = this._key(a); if (a && a.sourceId && !seen.has(k)) { this.assets.push(a); seen.add(k); added++; } });
      if (this.assets.length > StockLibraryManager.MAX_ASSETS) this.assets = this.assets.slice(-StockLibraryManager.MAX_ASSETS);
      this.nextCursor = res && res.nextCursor ? res.nextCursor : null;
      const backendMore = res && typeof res.hasMore === 'boolean' ? res.hasMore : (incoming.length >= this.perPage);
      this.hasMore = backendMore && !(append && added === 0);
      this.page += 1;
      this._optimizedQuery = (res && res.optimizedQuery) || null;
      this._setPartial(!!(res && res.partial), res && res.sources);
      this._renderAiHint();
      this._render(append);
      this._setStatus(this.assets.length === 0 ? this.t('stock.empty.browse') : (this.hasMore ? '' : this.t('stock.endOfResults')));
    } catch (err) {
      if (reqId === this._reqId) { console.error('[Stock] fetch error:', err); this._setStatus(err.message || this.t('stock.error.generic')); }
    } finally {
      if (reqId === this._reqId) { this.loading = false; this._showCenterLoader(false); this._showMoreLoader(false); }
    }
  }
  _onScroll() {
    if (this.loading || !this.hasMore) return;
    const el = document.getElementById('stock-results');
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 600) { if (this.section === 'browse') this._fetch(true); else this._loadList(false); }
  }

  _browseUI() {
    this.section = 'browse';
    document.querySelectorAll('.stock-tab').forEach((b) => b.classList.toggle('active', b.dataset.section === 'browse'));
  }
  switchSection(section, force) {
    const prev = this.section; this.section = section;
    document.querySelectorAll('.stock-tab').forEach((b) => b.classList.toggle('active', b.dataset.section === section));
    if (this._albumMode) this._closeAlbum();
    this._renderControls(); this._renderRanges(); this._renderFooter();
    if (section === 'browse') { if (force || prev !== 'browse') this.runSearch(); return; }
    if (!this.requireAuth()) { this.switchSection('browse', true); return; }
    this._saveState();
    this._ensureProjectText(); this._loadList(true);
  }
  async _loadList(reset) {
    if (this.loading) return;
    if (!this.requireAuth()) return;
    if (reset) { this.assets = []; this.page = 1; this.hasMore = true; this._stopPlayback(); this._clearResults(); this._setPartial(false); this._renderAiHint(); }
    if (!this.hasMore) return;
    this.loading = true; this._beginLoad();
    const reqId = ++this._reqId;
    const limit = 50; const offset = (this.page - 1) * limit;
    const projectId = this.favProjectId !== 'all' ? this.favProjectId : undefined;
    const source = this.source !== 'all' ? this.source : undefined;
    try {
      const res = this.section === 'favorites'
        ? await this.api.stockListFavorites({ limit, offset, source, projectId })
        : await this.api.stockListDownloads({ limit, offset, projectId });
      if (reqId !== this._reqId) return;
      if (res && res.status === false) throw new Error(res.message || this.t('stock.error.generic'));
      const records = this.section === 'favorites' ? (Array.isArray(res && res.favorites) ? res.favorites : []) : (Array.isArray(res && res.downloads) ? res.downloads : []);
      const incoming = records.map((r) => r.asset || r.assetSnapshot).filter((a) => a && a.sourceId);
      const seen = new Set(this.assets.map((a) => this._key(a)));
      let added = 0;
      incoming.forEach((a) => { const k = this._key(a); if (!seen.has(k)) { this.assets.push(a); seen.add(k); added++; } });
      this.hasMore = !(records.length < limit || added === 0);
      this.page += 1;
      this._render(true);
      this._setStatus(this.assets.length === 0 ? (this.section === 'favorites' ? this.t('stock.empty.favorites') : this.t('stock.empty.downloaded')) : (this.hasMore ? '' : this.t('stock.endOfResults')));
    } catch (err) {
      if (reqId === this._reqId) { console.error('[Stock] list error:', err); this._setStatus(err.message || this.t('stock.error.generic')); }
    } finally {
      if (reqId === this._reqId) { this.loading = false; this._showCenterLoader(false); this._showMoreLoader(false); }
    }
  }

  _ensureProjectText() { const t = document.getElementById('stock-project-text'); if (t) t.textContent = this._projectName(this.favProjectId); }
  _projectName(id) {
    if (!id || id === 'all') return this.t('stock.allProjects');
    const projects = (window.app && Array.isArray(window.app.projects)) ? window.app.projects : [];
    const p = projects.find((x) => x._id === id); return p ? (p.name || 'Project') : this.t('stock.allProjects');
  }
  _openProjectMenu(trigger) {
    const projects = (window.app && Array.isArray(window.app.projects)) ? window.app.projects : [];
    const items = [{ id: 'all', label: this.t('stock.allProjects'), selected: this.favProjectId === 'all' }];
    projects.forEach((p) => items.push({ id: p._id, label: p.name || 'Project', selected: this.favProjectId === p._id }));
    KolboDropdown.open({ trigger, noAvatar: true, items, onSelect: (id) => {
      this.favProjectId = id || 'all'; localStorage.setItem('kolbo_stock_fav_project', this.favProjectId);
      this._ensureProjectText(); if (this.section !== 'browse') this._loadList(true);
    } });
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================
  _key(a) { return (a.source || '') + ':' + (a.sourceId || ''); }
  _applyGridCols() { const r = document.getElementById('stock-results'); if (r) r.style.setProperty('--stock-cols', this.gridCols); }
  _clearResults() {
    const root = document.getElementById('stock-results');
    if (!root) return;
    root.querySelectorAll('.stock-audio-row').forEach((r) => { if (r._wave) { try { r._wave.destroy(); } catch (e) {} r._wave = null; } });
    root.innerHTML = '';
    this._renderedCount = 0; this._colEls = []; this._activeRowWave = null;
    root.classList.toggle('stock-audio-mode', this.isAudio());
  }

  _render(append) {
    const root = document.getElementById('stock-results');
    if (!root) return;
    const audio = this.isAudio();
    if (!append || (!audio && !this._colEls.length)) {
      // Full (re)build — also the path for a grid-density change.
      root.querySelectorAll('.stock-audio-row').forEach((r) => { if (r._wave) { try { r._wave.destroy(); } catch (e) {} r._wave = null; } });
      root.innerHTML = '';
      this._renderedCount = 0; this._colEls = []; this._activeRowWave = null;
      root.classList.toggle('stock-audio-mode', audio);
      if (!audio) {
        const cols = Math.max(2, Math.min(8, this.gridCols));
        for (let c = 0; c < cols; c++) { const col = document.createElement('div'); col.className = 'stock-col'; root.appendChild(col); this._colEls.push(col); }
      }
    }
    const start = this._renderedCount || 0;
    if (audio) {
      const frag = document.createDocumentFragment();
      for (let i = start; i < this.assets.length; i++) {
        const wrap = document.createElement('div'); wrap.innerHTML = this._audioRowHtml(this.assets[i]);
        const el = wrap.firstElementChild; if (el) { frag.appendChild(el); this._wireAudioRow(el, this.assets[i]); }
      }
      root.appendChild(frag);
    } else {
      const cols = this._colEls.length || 1;
      for (let i = start; i < this.assets.length; i++) {
        const wrap = document.createElement('div'); wrap.innerHTML = this._cardHtml(this.assets[i]);
        const el = wrap.firstElementChild; if (el) { this._colEls[i % cols].appendChild(el); this._wireCard(el, this.assets[i]); }
      }
    }
    this._renderedCount = this.assets.length;
  }

  // ── shared action rail (favorite / download / import) ────────────────────
  _actionsHtml(a, availLabels) {
    const fav = this.favorited.has(this._key(a));
    const importIcon = this.isAudio() ? 'folderPlus' : 'plus';
    let extra = '';
    if (this.isAudio() && a.meta) {
      if (a.meta.hasLyrics && a.meta.lyrics) extra += '<button class="stock-act stock-lyrics" data-act="lyrics" aria-label="' + this._escAttr(this.t('stock.lyrics')) + '" title="' + this._escAttr(this.t('stock.lyrics')) + '">' + this._icon('fileText', 15) + '</button>';
      if (a.meta.hasStems && a.meta.stems) extra += '<button class="stock-act stock-stems" data-act="stems" aria-label="' + this._escAttr(this.t('stock.stems')) + '" title="' + this._escAttr(this.t('stock.stems')) + '">' + this._icon('layers', 15) + '</button>';
    }
    return extra +
      '<button class="stock-act stock-fav' + (fav ? ' active' : '') + '" data-act="fav" aria-label="' + this._escAttr(this.t('stock.favorite')) + '" title="' + this._escAttr(this.t('stock.favorite')) + '">' + this._icon('heart', 15) + '</button>' +
      '<button class="stock-act stock-dl" data-act="download"' + (availLabels != null ? ' data-avail="' + this._escAttr(availLabels) + '"' : '') + ' aria-label="' + this._escAttr(this.t('stock.download')) + '" title="' + this._escAttr(this.t('stock.download')) + '">' + this._icon('download', 15) + '</button>' +
      '<button class="stock-act stock-import" data-act="import" aria-label="' + this._escAttr(this.t('stock.import')) + '" title="' + this._escAttr(this.t('stock.import')) + '">' + this._icon(importIcon, 15) + '</button>';
  }
  _wireActions(el, a) {
    el.querySelectorAll('.stock-act').forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'fav') this._toggleFavorite(a, btn);
      else if (act === 'download') this._download(a, btn);
      else if (act === 'import') this._import(a, btn);
      else if (act === 'lyrics') this._showLyrics(a);
      else if (act === 'stems') this._downloadStems(a, btn);
    }));
  }

  // ── visual card ──────────────────────────────────────────────────────────
  _cardHtml(a) {
    const ratio = (a.width && a.height) ? Math.max(0.5, Math.min(2.2, a.width / a.height)) : 1.4;
    const pad = (100 / ratio).toFixed(2);
    const thumb = a.thumbnailUrl || a.previewUrl || '';
    let badge = '';
    if (a.mediaType === 'video' && a.durationSeconds) badge = '<span class="stock-badge">' + this._fmtDur(a.durationSeconds) + '</span>';
    else if (a.mediaType === '3d') badge = '<span class="stock-badge">' + this._icon('box', 11) + '3D</span>';
    else if (a.mediaType === 'vector') badge = '<span class="stock-badge">SVG</span>';
    const overlay = (a.mediaType === 'video') ? '<span class="stock-card-play">' + this._icon('play', 26) + '</span>' : '';
    const media = thumb ? '<img class="stock-card-img" src="' + this._escAttr(thumb) + '" alt="" loading="lazy" decoding="async">' : '<div class="stock-card-img stock-card-empty">' + this._icon('image', 22) + '</div>';
    const vurl = a.mediaType === 'video' ? this._videoUrl(a) : '';
    return '<div class="stock-card" data-key="' + this._escAttr(this._key(a)) + '" style="--stock-pad:' + pad + '%">' +
        '<div class="stock-card-media" role="button" tabindex="0" draggable="true" title="' + this._escAttr(this.t('stock.dragHint')) + '" aria-label="' + this._escAttr(this.t('stock.preview') + ': ' + (a.title || a.source || '')) + '">' + media +
          (vurl ? '<video class="stock-card-video" muted loop playsinline preload="none" data-src="' + this._escAttr(vurl) + '"></video>' : '') +
          overlay + badge +
          '<div class="stock-card-actions">' + this._actionsHtml(a, null) + '</div>' +
        '</div>' +
        '<div class="stock-card-foot">' +
          '<div class="stock-card-title" title="' + this._escAttr(a.title || '') + '">' + this._esc(a.title || (a.author && a.author.name) || a.source) + '</div>' +
          '<div class="stock-card-attr">' + this._sourceIconHtml(a.source, 12) + '<span>' + this._esc(a.attribution || ('via ' + (a.source || ''))) + '</span></div>' +
        '</div>' +
      '</div>';
  }
  _wireCard(card, a) {
    // Stop the loading shimmer once the thumbnail is decoded (perf + polish).
    const cardImg = card.querySelector('.stock-card-img:not(.stock-card-empty)');
    if (cardImg) { if (cardImg.complete && cardImg.naturalWidth) card.classList.add('img-loaded'); else { cardImg.addEventListener('load', () => card.classList.add('img-loaded'), { once: true }); cardImg.addEventListener('error', () => card.classList.add('img-loaded'), { once: true }); } }
    else card.classList.add('img-loaded');
    const media = card.querySelector('.stock-card-media');
    const open = () => this._openPreview(a); // single click → full popup (image/video/3d), zoomed + playback
    if (media) {
      media.addEventListener('click', (e) => { if (!e.target.closest('.stock-act')) open(); });
      media.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.stock-act')) { e.preventDefault(); open(); } });
      // Native drag-out (drop into any app). Prewarm on press so the drag is instant.
      media.addEventListener('mousedown', () => this._prewarmAssetDrag(a));
      media.addEventListener('dragstart', (e) => { e.preventDefault(); this._startAssetDrag(a); });
    }
    const vid = card.querySelector('.stock-card-video');
    if (vid) {
      card.addEventListener('mouseenter', () => { if (!vid.src) vid.src = vid.dataset.src; vid.play().catch(() => {}); card.classList.add('playing'); });
      card.addEventListener('mouseleave', () => { try { vid.pause(); } catch (e) {} card.classList.remove('playing'); });
    }
    this._wireActions(card, a);
  }

  // ── audio row (full-width waveform) ──────────────────────────────────────
  _audioRowHtml(a) {
    const art = a.thumbnailUrl ? '<img class="stock-audio-art" src="' + this._escAttr(a.thumbnailUrl) + '" alt="" loading="lazy">'
      : '<div class="stock-audio-art stock-audio-art-empty">' + this._icon(a.mediaType === 'sfx' ? 'audioWaveform' : 'music', 18) + '</div>';
    const meta = [];
    if (a.meta && a.meta.bpm) meta.push(a.meta.bpm + ' BPM');
    if ((a.author && a.author.name)) meta.unshift(a.author.name);
    const tags = (a.tags || []).slice(0, 3).map((tag) => '<span class="stock-tag">' + this._esc(tag) + '</span>').join('');
    const preview = a.previewUrl || (a.downloadVariants && a.downloadVariants[0] && a.downloadVariants[0].url) || '';
    const dur = a.durationSeconds ? this._fmtDur(a.durationSeconds) : '';
    return '<div class="stock-audio-row" data-key="' + this._escAttr(this._key(a)) + '" draggable="true" title="' + this._escAttr(this.t('stock.dragHint')) + '">' +
        art +
        '<button class="stock-audio-play' + (preview ? '' : ' disabled') + '" aria-label="' + this._escAttr(this.t('stock.preview')) + '"' + (preview ? '' : ' disabled') + '><span class="stock-pp">' + this._icon('play', 14) + '</span></button>' +
        '<div class="stock-audio-main">' +
          '<div class="stock-audio-title" title="' + this._escAttr(a.title || '') + '">' + this._esc(a.title || 'Untitled') + '</div>' +
          '<div class="stock-audio-sub">' + this._esc(meta.join(' · ')) + ' ' + tags + '</div>' +
        '</div>' +
        '<div class="stock-audio-wave-wrap"><canvas class="stock-audio-wave"></canvas></div>' +
        '<span class="stock-audio-time">' + this._esc(dur) + '</span>' +
        '<div class="stock-audio-actions">' + this._actionsHtml(a, (a.downloadVariants || []).map((v) => v.label).join(',')) + '</div>' +
        (preview ? '<audio class="stock-audio-el" preload="none" src="' + this._escAttr(preview) + '"></audio>' : '') +
      '</div>';
  }
  // Provider-shipped waveform peaks (~64 gain-normalized floats in meta.waveform —
  // same data kolbo-map draws). Used directly so rows never fall back to the shared
  // skeleton; FFmpeg/WebAudio decode remains the fallback for sources without them.
  _assetPeaks(a) {
    const w = a && a.meta && a.meta.waveform;
    return (Array.isArray(w) && w.length) ? w : undefined;
  }

  _wireAudioRow(row, a) {
    const audio = row.querySelector('.stock-audio-el');
    const playBtn = row.querySelector('.stock-audio-play');
    const canvas = row.querySelector('.stock-audio-wave');
    // Row waveform is a visual scrubber only — playback + trim happen in the dock
    // (Synci pattern). Clicking the strip opens the dock and plays from that point.
    if (canvas && audio && typeof KolboWaveform !== 'undefined') {
      const url = a.previewUrl || (a.downloadVariants && a.downloadVariants[0] && a.downloadVariants[0].url);
      row._wave = KolboWaveform.create({ canvas, audio, url, peaks: this._assetPeaks(a), waveColor: 'rgba(255,255,255,0.42)', noAudioPrefetch: true, onActivate: (pct) => this._openDock(a, typeof pct === 'number' ? pct : 0) });
    }
    if (playBtn) playBtn.addEventListener('click', () => this._openDock(a));
    // Native drag-out (drop into any app).
    row.addEventListener('mousedown', (e) => { if (!e.target.closest('.stock-act') && !e.target.closest('.stock-audio-wave')) this._prewarmAssetDrag(a); });
    row.addEventListener('dragstart', (e) => { e.preventDefault(); this._startAssetDrag(a); });
    this._wireActions(row, a);
  }
  _setPlayIcon(row, playing) { const pp = row.querySelector('.stock-pp'); if (pp) pp.innerHTML = this._icon(playing ? 'pause' : 'play', 14); }
  _playAudio(row, a) {
    const audio = row.querySelector('.stock-audio-el');
    if (!audio) return;
    if (this._playing && this._playing.audio && this._playing.audio !== audio) { try { this._playing.audio.pause(); } catch (e) {} }
    if (audio.paused) { this._playing = { audio, row, asset: a }; audio.play().catch(() => {}); } else audio.pause();
  }
  _stopPlayback() { if (this._playing && this._playing.audio) { try { this._playing.audio.pause(); } catch (e) {} } this._playing = null; }

  // ==========================================================================
  // Preview modal
  // ==========================================================================
  _openPreview(a) {
    const modal = document.getElementById('stock-preview');
    const mediaBox = document.getElementById('stock-preview-media');
    const infoBox = document.getElementById('stock-preview-info');
    if (!modal || !mediaBox || !infoBox) return;
    const isVideo = a.mediaType === 'video';
    const vurl = isVideo ? this._videoUrl(a) : '';
    const url = a.previewUrl || a.thumbnailUrl || '';
    const spinner = '<div class="stock-preview-spin"><span class="stock-spinner stock-spinner-lg"></span></div>';
    this._previewAsset = a;
    let handled3d = false;
    if (a.mediaType === '3d') {
      // Real in-app interactive 3D via <model-viewer> (loads the GLB from a local
      // temp file → no CORS / no Cloudflare challenge). Falls back to thumbnail +
      // "open in browser" if model-viewer is unavailable or the GLB can't load.
      this._open3d(a, mediaBox);
      handled3d = true;
    } else if (vurl) {
      // Full zoomed player + playback. Spinner shows until the video can play.
      mediaBox.innerHTML = spinner + '<video id="stock-pv-video" src="' + this._escAttr(vurl) + '" poster="' + this._escAttr(a.thumbnailUrl || a.previewUrl || '') + '" controls autoplay playsinline></video>';
    } else {
      mediaBox.innerHTML = spinner + '<img src="' + this._escAttr(url) + '" alt="">';
    }
    // Hide the spinner once the media is ready (3D manages its own spinner).
    const mediaEl = handled3d ? null : mediaBox.querySelector('video, img, iframe');
    const hideSpin = () => { const s = mediaBox.querySelector('.stock-preview-spin'); if (s) s.remove(); };
    if (mediaEl) {
      if (mediaEl.tagName === 'IMG') { if (mediaEl.complete) hideSpin(); else { mediaEl.addEventListener('load', hideSpin, { once: true }); mediaEl.addEventListener('error', hideSpin, { once: true }); } }
      else if (mediaEl.tagName === 'VIDEO') mediaEl.addEventListener('loadeddata', hideSpin, { once: true });
      else setTimeout(hideSpin, 1200); // iframe
    }

    const lic = a.license || {};
    this._pv = { asset: a, inPct: 0, outPct: 1, localPath: null, dragPath: null, _dragKey: null };
    const trimRow = isVideo
      ? '<div class="stock-pv-trim">' +
          '<div id="stock-pv-track" class="stock-dock-track">' +
            '<div id="stock-pv-played" class="stock-dock-played"></div>' +
            '<div id="stock-pv-mask-l" class="stock-dock-mask"></div><div id="stock-pv-mask-r" class="stock-dock-mask"></div>' +
            '<div id="stock-pv-region" class="stock-dock-region" draggable="true" title="' + this._escAttr(this.t('stock.dragTrim')) + '"></div>' +
            '<div id="stock-pv-in" class="stock-dock-handle"></div><div id="stock-pv-out" class="stock-dock-handle"></div>' +
          '</div>' +
          '<span id="stock-pv-inout" class="stock-dock-inout"></span>' +
        '</div>'
      : '';
    infoBox.innerHTML =
      '<div class="stock-preview-attr">' + this._esc(a.attribution || ('via ' + (a.source || ''))) + '</div>' +
      (a.providerUrl ? '<a class="stock-preview-link" href="' + this._escAttr(a.providerUrl) + '" target="_blank" rel="noopener">' + this._esc(this.t('stock.viewSource')) + this._icon('externalLink', 11) + '</a>' : '') +
      (lic.name ? '<span class="stock-preview-lic">' + this._esc(lic.name) + '</span>' : '') +
      trimRow +
      '<div class="stock-preview-buttons">' +
        (isVideo || this.isAudio() ? '<button class="stock-act stock-pv-drag" data-pv="drag" draggable="true" title="' + this._escAttr(this.t('stock.dragHint')) + '">' + this._icon('layers', 14) + '</button>' : '') +
        '<button class="stock-btn-ghost" data-pv="download">' + this._icon('download', 14) + this._esc(this.t('stock.download')) + '</button>' +
        '<button class="stock-btn-primary" data-pv="import">' + this._icon(this.isAudio() ? 'folderPlus' : 'plus', 14) + this._esc(this.t('stock.import')) + '</button>' +
      '</div>';
    infoBox.querySelector('[data-pv="download"]').addEventListener('click', (e) => isVideo ? this._pvDownload(e.currentTarget) : this._download(a, e.currentTarget));
    infoBox.querySelector('[data-pv="import"]').addEventListener('click', (e) => this._import(a, e.currentTarget));
    const dragBtn = infoBox.querySelector('[data-pv="drag"]');
    if (dragBtn) { dragBtn.addEventListener('dragstart', (e) => { e.preventDefault(); isVideo ? this._pvDrag(dragBtn) : this._startAssetDrag(a); }); dragBtn.addEventListener('click', () => isVideo ? this._pvDownload(dragBtn) : this._download(a, dragBtn)); dragBtn.addEventListener('mousedown', () => isVideo ? this._pvPrep(false) : this._prewarmAssetDrag(a)); }
    if (isVideo && mediaEl && mediaEl.tagName === 'VIDEO') this._pvWireTrim(mediaEl);
    modal.classList.remove('hidden');
  }
  _closePreview() {
    const m = document.getElementById('stock-preview'); const mb = document.getElementById('stock-preview-media');
    if (mb) mb.innerHTML = ''; if (m) m.classList.add('hidden'); this._pv = null; this._previewAsset = null;
  }

  // Interactive 3D in-app via <model-viewer>; GLB cached to a local file to avoid
  // CORS + the Sketchfab Cloudflare challenge. Graceful fallback to thumbnail +
  // "open in browser" if the component or the GLB isn't available.
  _open3d(a, mediaBox) {
    const thumb = a.thumbnailUrl || a.previewUrl || '';
    const extLink = a.providerUrl ? '<a class="stock-3d-open" href="' + this._escAttr(a.providerUrl) + '" target="_blank" rel="noopener">' + this._icon('box', 14) + this._esc(this.t('stock.open3d')) + this._icon('externalLink', 11) + '</a>' : '';
    const hasMV = !!(window.customElements && window.customElements.get('model-viewer'));
    const fallback = () => { if (this._previewAsset !== a) return; mediaBox.innerHTML = '<img src="' + this._escAttr(thumb) + '" alt="">' + extLink; };
    if (!hasMV) { fallback(); return; }
    // model-viewer IS the interactive 3D — no external overlay button needed here
    // (the info bar's "View source" already links to Sketchfab).
    mediaBox.innerHTML = '<div class="stock-preview-spin"><span class="stock-spinner stock-spinner-lg"></span></div>' +
      '<model-viewer class="stock-3d-viewer" camera-controls auto-rotate touch-action="pan-y" interaction-prompt="none" shadow-intensity="1" environment-image="neutral" exposure="1" poster="' + this._escAttr(thumb) + '"></model-viewer>';
    const viewer = mediaBox.querySelector('model-viewer');
    const hideSpin = () => { const s = mediaBox.querySelector('.stock-preview-spin'); if (s) s.remove(); };
    viewer.addEventListener('load', hideSpin);
    viewer.addEventListener('error', fallback);
    const proxy = this.api.stockDownloadUrl(a.source, a.sourceId, undefined, '3d'); // streams the GLB via Kolbo
    if (window.kolboDesktop && window.kolboDesktop.synciCacheTrack) {
      window.kolboDesktop.synciCacheTrack(proxy, this._safeName(a.title) + '.glb')
        .then((r) => { if (this._previewAsset !== a) return; if (r && r.success && r.filePath) viewer.src = 'file:///' + String(r.filePath).replace(/\\/g, '/'); else fallback(); })
        .catch(fallback);
    } else {
      viewer.src = proxy; // plugin path: try direct (CORS-permitting); errors fall back
    }
  }

  // ── video trim inside the preview popup (reuses the Synci cache/trim/drag IPC) ──
  _pvWireTrim(video) {
    const wrap = document.getElementById('stock-pv-track'); if (!wrap) return;
    this._pvVideo = video;
    video.addEventListener('timeupdate', () => { this._pvRenderPlayed(); this._pvLoop(); });
    video.addEventListener('loadedmetadata', () => this._pvRenderRegion());
    const handle = (id, which) => {
      const h = document.getElementById(id); if (!h) return; let rect = null;
      const mv = (e) => { const d = this._pv; if (!d || !rect) return; const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); if (which === 'in') d.inPct = Math.max(0, Math.min(pct, d.outPct - 0.01)); else d.outPct = Math.min(1, Math.max(pct, d.inPct + 0.01)); this._pvRenderRegion(); };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); rect = null; const d = this._pv; if (d && video.duration) { const inS = d.inPct * video.duration; if (video.currentTime < inS) try { video.currentTime = inS; } catch (e) {} } };
      h.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); rect = wrap.getBoundingClientRect(); document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); });
    };
    handle('stock-pv-in', 'in'); handle('stock-pv-out', 'out');
    wrap.addEventListener('mousedown', (e) => { if (e.target.closest('.stock-dock-handle')) return; const r = wrap.getBoundingClientRect(); const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); if (video.duration) { try { video.currentTime = pct * video.duration; } catch (er) {} } });
    const region = document.getElementById('stock-pv-region');
    if (region) { region.addEventListener('dragstart', (e) => { e.preventDefault(); this._pvDrag(region); }); region.addEventListener('mousedown', () => this._pvPrep(false)); }
    this._pvRenderRegion();
  }
  _pvFull() { const d = this._pv; return !d || (d.inPct <= 0.005 && d.outPct >= 0.995); }
  _pvRenderRegion() {
    const d = this._pv; if (!d) return; const inS = (d.inPct * 100).toFixed(2) + '%', outS = (d.outPct * 100).toFixed(2) + '%';
    const ie = document.getElementById('stock-pv-in'), oe = document.getElementById('stock-pv-out'), ml = document.getElementById('stock-pv-mask-l'), mr = document.getElementById('stock-pv-mask-r');
    if (ie) ie.style.left = inS; if (oe) oe.style.left = outS; if (ml) { ml.style.left = '0'; ml.style.width = inS; } if (mr) { mr.style.left = outS; mr.style.right = '0'; }
    const reg = document.getElementById('stock-pv-region'); if (reg) { reg.style.left = inS; reg.style.right = (100 - d.outPct * 100).toFixed(2) + '%'; }
    d.dragPath = null; d._dragKey = null;
    const io = document.getElementById('stock-pv-inout'); const dur = (this._pvVideo && this._pvVideo.duration) || d.asset.durationSeconds || 0;
    if (io) io.textContent = this._pvFull() ? '' : (this.t('stock.in') + ' ' + this._fmtDur(d.inPct * dur) + ' · ' + this.t('stock.out') + ' ' + this._fmtDur(d.outPct * dur));
  }
  _pvRenderPlayed() { const v = this._pvVideo, el = document.getElementById('stock-pv-played'); if (v && el && v.duration) el.style.width = (v.currentTime / v.duration * 100) + '%'; }
  _pvLoop() { const v = this._pvVideo, d = this._pv; if (!v || !d || !v.duration || this._pvFull()) return; if (v.currentTime >= d.outPct * v.duration - 0.05) { try { v.currentTime = d.inPct * v.duration; } catch (e) {} } }
  async _pvPrep(overlay) {
    const d = this._pv; if (!d) return null;
    const key = this._pvFull() ? 'full' : (d.inPct.toFixed(4) + '-' + d.outPct.toFixed(4));
    if (d.dragPath && d._dragKey === key) return d.dragPath;
    if (!window.kolboDesktop || !window.kolboDesktop.synciCacheTrack) return null;
    const a = d.asset; const v = a.downloadVariants && a.downloadVariants[0] && a.downloadVariants[0].label;
    const url = this.api.stockDownloadUrl(a.source, a.sourceId, v, a.mediaType);
    const btns = document.querySelectorAll('#stock-preview-info [data-pv]'); if (overlay) btns.forEach((b) => b.classList.add('busy'));
    try {
      if (!d.localPath) { const r = await window.kolboDesktop.synciCacheTrack(url, this._safeName(a.title) + this._extFor(a, v)); if (!(r && r.success && r.filePath) || this._pv !== d) return null; d.localPath = r.filePath; }
      const dur = (this._pvVideo && this._pvVideo.duration) || a.durationSeconds || 0;
      if (this._pvFull() || !dur) { d.dragPath = d.localPath; d._dragKey = 'full'; return d.localPath; }
      try { const tr = await window.kolboDesktop.synciExportTrimmed({ inputPath: d.localPath, inPoint: d.inPct * dur, outPoint: d.outPct * dur }); d.dragPath = (tr && tr.success && tr.outputPath) ? tr.outputPath : d.localPath; } catch (e) { d.dragPath = d.localPath; }
      d._dragKey = key; return d.dragPath;
    } finally { if (overlay) btns.forEach((b) => b.classList.remove('busy')); }
  }
  async _pvDrag(btn) {
    const d = this._pv; if (!d) return;
    if (this.bridge && typeof this.bridge.placeAsset === 'function') return this._startAssetDrag(d.asset);
    if (!window.kolboDesktop || !window.kolboDesktop.synciStartDrag) { this._toast(this.t('stock.error.generic')); return; }
    const path = await this._pvPrep(true); if (!path) { this._toast(this.t('stock.error.download')); return; }
    window.kolboDesktop.synciStartDrag(path); if (this.isAuth()) this.api.stockLogDownload(d.asset, null, this._targetProjectId());
  }
  async _pvDownload(btn) {
    const d = this._pv; if (!d) return;
    if (!window.kolboDesktop || !window.kolboDesktop.synciSaveToDownloads) return this._download(d.asset, btn); // plugin: no local disk
    if (btn) btn.classList.add('busy');
    const path = await this._pvPrep(false);
    if (!path) { if (btn) btn.classList.remove('busy'); this._toast(this.t('stock.error.download')); return; }
    try { if (window.kolboDesktop && window.kolboDesktop.synciSaveToDownloads) { await window.kolboDesktop.synciSaveToDownloads(path, this._safeName(d.asset.title) + (this._pvFull() ? '' : '_trim') + this._extFor(d.asset)); this._toast(this.t('stock.downloaded')); if (this.isAuth()) this.api.stockLogDownload(d.asset, null, this._targetProjectId()); } } catch (e) { this._toast(this.t('stock.error.download')); }
    this._flashDone(btn);
  }

  // ==========================================================================
  // Now-playing / trim dock (audio + video) + native drag-out
  // ==========================================================================
  _dockEl(id) { return document.getElementById(id); }
  _dockMedia() { return (this._dock && this._dock.isVideo) ? this._dockEl('stock-dock-video') : this._dockEl('stock-dock-audio'); }

  _openDock(asset, atPct) {
    const dock = this._dockEl('stock-dock'); if (!dock || !asset) return;
    const isVideo = asset.mediaType === 'video';
    // Re-clicking the SAME track's waveform/play just seeks — don't rebuild the
    // dock (that was the flicker/lag). Mirrors Synci's _playInDockAt.
    if (this._dock && this._dock.rowKey === this._key(asset) && !dock.classList.contains('hidden')) {
      if (typeof atPct === 'number') this._dockSeek(atPct, true); else this._dockTogglePlay();
      return;
    }
    if (this._dock && this._dock.wave) { try { this._dock.wave.destroy(); } catch (e) {} }
    const prevAudio = this._dockEl('stock-dock-audio'); const prevVideo = this._dockEl('stock-dock-video');
    try { prevAudio.pause(); } catch (e) {} try { prevVideo.pause(); } catch (e) {}

    this._dock = { asset, isVideo, rowKey: this._key(asset), inPct: 0, outPct: 1, localPath: null, dragPath: null, _dragKey: null, wave: null };
    if (this.api && typeof this.api.stockTrackPlay === 'function') this.api.stockTrackPlay(asset.source, asset.sourceId, asset.mediaType); // popularity beacon (feeds "popular" sort)
    dock.classList.remove('hidden');
    const videoEl = this._dockEl('stock-dock-video');
    videoEl.classList.toggle('hidden', !isVideo);
    const media = isVideo ? videoEl : this._dockEl('stock-dock-audio');
    const srcUrl = isVideo ? this._videoUrl(asset) : (asset.previewUrl || (asset.downloadVariants && asset.downloadVariants[0] && asset.downloadVariants[0].url) || '');
    if (isVideo) media.muted = false;
    media.src = srcUrl;

    const art = this._dockEl('stock-dock-art');
    if (asset.thumbnailUrl) { art.src = asset.thumbnailUrl; art.style.display = ''; } else { art.removeAttribute('src'); art.style.display = 'none'; }
    this._dockEl('stock-dock-title').textContent = asset.title || 'Untitled';
    this._dockEl('stock-dock-sub').textContent = (asset.author && asset.author.name) || asset.source || '';

    const canvas = this._dockEl('stock-dock-wave');
    canvas.classList.toggle('hidden', isVideo);
    this._dockEl('stock-dock-played').classList.remove('hidden'); // progress fill over the waveform (audio) / bar (video)
    if (!isVideo && canvas && typeof KolboWaveform !== 'undefined') {
      this._dock.wave = KolboWaveform.create({ canvas, audio: media, url: srcUrl, peaks: this._assetPeaks(asset), waveColor: 'rgba(255,255,255,0.40)', noInteract: true });
    }
    this._renderDockRegion();
    this._updateDockTime();
    this._setDockPlay(false);
    if (typeof atPct === 'number') this._dockSeek(atPct, true); else media.play().catch(() => {});
    this._prewarmDock();
    this._updateResultsPadding();
  }
  // Reserve bottom space so the floating player never hides the last results /
  // the infinite-scroll spinner. Padding = actual dock height (audio vs video).
  _updateResultsPadding() {
    const results = document.getElementById('stock-results');
    const dock = this._dockEl('stock-dock');
    if (!results) return;
    if (dock && !dock.classList.contains('hidden')) results.style.paddingBottom = ((dock.offsetHeight || 80) + 20) + 'px';
    else results.style.paddingBottom = '';
  }

  _wireDock() {
    const dock = this._dockEl('stock-dock'); if (!dock || dock._wired) return; dock._wired = true;
    const close = this._dockEl('stock-dock-close'); if (close) close.addEventListener('click', () => this._closeDock());
    const play = this._dockEl('stock-dock-play'); if (play) play.addEventListener('click', () => this._dockTogglePlay());
    ['stock-dock-audio', 'stock-dock-video'].forEach((id) => {
      const m = this._dockEl(id); if (!m) return;
      m.addEventListener('play', () => this._setDockPlay(true));
      m.addEventListener('pause', () => this._setDockPlay(false));
      m.addEventListener('timeupdate', () => { this._updateDockTime(); this._loopWithin(); this._renderDockPlayed(); });
      m.addEventListener('loadedmetadata', () => { this._updateDockTime(); this._renderDockRegion(); this._updateResultsPadding(); });
    });
    this._wireDockHandle('stock-dock-in', 'in');
    this._wireDockHandle('stock-dock-out', 'out');
    this._wireDockSeek();
    const imp = this._dockEl('stock-dock-import'); if (imp) imp.addEventListener('click', () => this._import(this._dock && this._dock.asset, imp));
    const dl = this._dockEl('stock-dock-download'); if (dl) dl.addEventListener('click', () => this._onDockDownload(dl));
    const drag = this._dockEl('stock-dock-drag');
    if (drag) { drag.addEventListener('dragstart', (e) => { e.preventDefault(); this._onDockDrag(); }); drag.addEventListener('mousedown', () => this._prewarmDock()); drag.addEventListener('click', () => this._onDockDownload(drag)); }
    // Drag the SELECTED region out to export the trimmed clip (File Bridge / Synci gesture).
    const region = this._dockEl('stock-dock-region');
    if (region) { region.addEventListener('dragstart', (e) => { e.preventDefault(); this._onDockDrag(); }); region.addEventListener('mousedown', () => this._prewarmDock()); }
  }

  _dockTogglePlay() { const m = this._dockMedia(); if (!m) return; if (m.paused) { this._dockSeekIfOutside(); m.play().catch(() => {}); } else m.pause(); }
  _setDockPlay(p) {
    const b = this._dockEl('stock-dock-play'); const pp = b && b.querySelector('.stock-pp'); if (pp) pp.innerHTML = this._icon(p ? 'pause' : 'play', 14);
    // Sync the SOURCE row (top): play→pause icon + 'playing' highlight, mirroring Synci.
    document.querySelectorAll('.stock-audio-row.playing').forEach((r) => { r.classList.remove('playing'); const rp = r.querySelector('.stock-audio-play .stock-pp'); if (rp) rp.innerHTML = this._icon('play', 14); });
    if (p && this._dock && this._dock.rowKey) {
      const row = document.querySelector('.stock-audio-row[data-key="' + this._cssEsc(this._dock.rowKey) + '"]');
      if (row) { row.classList.add('playing'); const rp = row.querySelector('.stock-audio-play .stock-pp'); if (rp) rp.innerHTML = this._icon('pause', 14); }
      this._startRowLoop();
    } else { this._syncActiveRow(); }
  }
  // Color the active row's waveform in time with the dock (top↔bottom sync).
  _syncActiveRow() {
    const m = this._dockMedia(), d = this._dock; let wave = null, pct = 0;
    if (m && d && m.duration && isFinite(m.duration)) {
      pct = m.currentTime / m.duration;
      const row = document.querySelector('.stock-audio-row[data-key="' + this._cssEsc(d.rowKey || '') + '"]');
      wave = (row && row._wave) || null;
    }
    if (this._activeRowWave && this._activeRowWave !== wave && this._activeRowWave.setProgress) { try { this._activeRowWave.setProgress(null); } catch (e) {} }
    this._activeRowWave = wave;
    if (wave && wave.setProgress) { try { wave.setProgress(pct); } catch (e) {} }
  }
  _startRowLoop() {
    if (this._rowRaf) return;
    const tick = () => { this._syncActiveRow(); const m = this._dockMedia(); this._rowRaf = (m && !m.paused) ? requestAnimationFrame(tick) : 0; };
    this._rowRaf = requestAnimationFrame(tick);
  }
  _dockDuration() { const m = this._dockMedia(); if (m && m.duration && isFinite(m.duration)) return m.duration; return (this._dock && this._dock.asset && this._dock.asset.durationSeconds) || 0; }
  _dockSeek(pct, andPlay) {
    const m = this._dockMedia(); if (!m) return;
    const apply = () => { if (!m.duration || !isFinite(m.duration)) return; try { m.currentTime = Math.max(0, Math.min(1, pct)) * m.duration; } catch (e) {} this._updateDockTime(); if (andPlay) m.play().catch(() => {}); };
    if (m.duration && isFinite(m.duration)) apply(); else m.addEventListener('loadedmetadata', apply, { once: true });
  }
  _dockSeekIfOutside() { const m = this._dockMedia(), d = this._dock; if (!m || !d || !m.duration || !isFinite(m.duration)) return; const inS = d.inPct * m.duration, outS = d.outPct * m.duration; if (m.currentTime < inS || m.currentTime >= outS - 0.02) { try { m.currentTime = inS; } catch (e) {} } }
  _loopWithin() { const m = this._dockMedia(), d = this._dock; if (!m || !d || !m.duration || this._dockFull()) return; const outS = d.outPct * m.duration; if (m.currentTime >= outS - 0.02) { try { m.currentTime = d.inPct * m.duration; } catch (e) {} } }
  _dockFull() { const d = this._dock; return !d || (d.inPct <= 0.005 && d.outPct >= 0.995); }
  _updateDockTime() {
    const d = this._dock; if (!d) return;
    const dur = this._dockDuration(), cur = (this._dockMedia() && this._dockMedia().currentTime) || 0;
    const t = this._dockEl('stock-dock-time'); if (t) t.textContent = this._fmtDur(cur) + ' / ' + this._fmtDur(dur);
    const io = this._dockEl('stock-dock-inout'); if (io) io.textContent = this._dockFull() ? '' : (this.t('stock.in') + ' ' + this._fmtDur(d.inPct * dur) + ' · ' + this.t('stock.out') + ' ' + this._fmtDur(d.outPct * dur));
  }
  _renderDockPlayed() { const m = this._dockMedia(), el = this._dockEl('stock-dock-played'); if (!m || !el || !m.duration) return; el.style.width = (Math.max(0, Math.min(1, m.currentTime / m.duration)) * 100) + '%'; }
  _renderDockRegion() {
    const d = this._dock; if (!d) return;
    const inS = (d.inPct * 100).toFixed(2) + '%', outS = (d.outPct * 100).toFixed(2) + '%';
    const inEl = this._dockEl('stock-dock-in'), outEl = this._dockEl('stock-dock-out'), mL = this._dockEl('stock-dock-mask-l'), mR = this._dockEl('stock-dock-mask-r');
    if (inEl) inEl.style.left = inS; if (outEl) outEl.style.left = outS;
    if (mL) { mL.style.left = '0'; mL.style.width = inS; } if (mR) { mR.style.left = outS; mR.style.right = '0'; }
    const reg = this._dockEl('stock-dock-region'); if (reg) { reg.style.left = inS; reg.style.right = (100 - d.outPct * 100).toFixed(2) + '%'; }
    this._updateDockTime(); this._invalidateDockDrag();
  }
  _wireDockHandle(id, which) {
    const h = this._dockEl(id), wrap = this._dockEl('stock-dock-track'); if (!h || !wrap) return;
    let rect = null;
    const mv = (e) => { const d = this._dock; if (!d || !rect) return; const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); if (which === 'in') d.inPct = Math.max(0, Math.min(pct, d.outPct - 0.01)); else d.outPct = Math.min(1, Math.max(pct, d.inPct + 0.01)); this._renderDockRegion(); };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); rect = null; this._dockSeekIfOutside(); };
    h.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); rect = wrap.getBoundingClientRect(); document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); });
  }
  _wireDockSeek() {
    const wrap = this._dockEl('stock-dock-track'); if (!wrap || wrap._seek) return; wrap._seek = true;
    wrap.addEventListener('mousedown', (e) => { if (e.target.closest('.stock-dock-handle')) return; const r = wrap.getBoundingClientRect(); this._dockSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), true); });
  }
  _closeDock() {
    const m = this._dockMedia(); if (m) { try { m.pause(); } catch (e) {} }
    if (this._dock && this._dock.wave) { try { this._dock.wave.destroy(); } catch (e) {} }
    if (this._rowRaf) { cancelAnimationFrame(this._rowRaf); this._rowRaf = 0; }
    if (this._activeRowWave && this._activeRowWave.setProgress) { try { this._activeRowWave.setProgress(null); } catch (e) {} }
    this._activeRowWave = null;
    document.querySelectorAll('.stock-audio-row.playing').forEach((r) => { r.classList.remove('playing'); const rp = r.querySelector('.stock-audio-play .stock-pp'); if (rp) rp.innerHTML = this._icon('play', 14); });
    const d = this._dockEl('stock-dock'); if (d) d.classList.add('hidden'); this._dock = null;
    this._updateResultsPadding();
  }

  // ── trim/export (reuse the Synci IPC: cache → ffmpeg trim → native drag) ──
  _dockKey() { const d = this._dock; return this._dockFull() ? 'full' : (d.inPct.toFixed(4) + '-' + d.outPct.toFixed(4)); }
  _invalidateDockDrag() { const d = this._dock; if (d) { d.dragPath = null; d._dragKey = null; } }
  _prewarmDock() { if (this._dock && window.kolboDesktop && window.kolboDesktop.synciCacheTrack) this._ensureDockFile(false); }
  async _cacheDockFull() {
    const d = this._dock; if (!d) return null; if (d.localPath) return d.localPath;
    if (!window.kolboDesktop || !window.kolboDesktop.synciCacheTrack) return null;
    const a = d.asset; const v = a.downloadVariants && a.downloadVariants[0] && a.downloadVariants[0].label;
    const url = this.api.stockDownloadUrl(a.source, a.sourceId, v, a.mediaType);
    try { const res = await window.kolboDesktop.synciCacheTrack(url, this._safeName(a.title) + this._extFor(a, v)); if (res && res.success && res.filePath && this._dock === d) { d.localPath = res.filePath; return res.filePath; } } catch (e) {}
    return null;
  }
  async _ensureDockFile(overlay) {
    const d = this._dock; if (!d) return null;
    const key = this._dockKey(); if (d.dragPath && d._dragKey === key) return d.dragPath;
    if (overlay) this._showDockLoading(true);
    try {
      const full = await this._cacheDockFull(); if (!full || this._dock !== d) return null;
      if (this._dockFull()) { d.dragPath = full; d._dragKey = 'full'; return full; }
      const dur = this._dockDuration(); if (!dur) { d.dragPath = full; d._dragKey = 'full'; return full; }
      try { const res = await window.kolboDesktop.synciExportTrimmed({ inputPath: full, inPoint: d.inPct * dur, outPoint: d.outPct * dur }); d.dragPath = (res && res.success && res.outputPath) ? res.outputPath : full; } catch (e) { d.dragPath = full; }
      d._dragKey = key; return d.dragPath;
    } finally { if (overlay) this._showDockLoading(false); }
  }
  _showDockLoading(s) { const el = this._dockEl('stock-dock-loading'); if (el) el.classList.toggle('hidden', !s); }
  // Host-side audio trim: when the dock has an in/out selection, place only that
  // range (Premiere sets the clip in/out). Full selection / video → null (full).
  _dockTrimOpts() {
    const d = this._dock; if (!d) return null;
    const isAud = StockLibraryManager.AUDIO_TYPES.indexOf(d.asset.mediaType) >= 0;
    if (!isAud || this._dockFull()) return null;
    const dur = this._dockDuration(); if (!dur) return null;
    return { inPoint: +(d.inPct * dur).toFixed(3), outPoint: +(d.outPct * dur).toFixed(3) };
  }
  async _onDockDrag() {
    const d = this._dock; if (!d) return;
    if (this.bridge && typeof this.bridge.placeAsset === 'function') return this._startAssetDrag(d.asset, this._dockTrimOpts()); // plugin: place (trimmed) asset on the host timeline
    if (!window.kolboDesktop || !window.kolboDesktop.synciStartDrag) { this._toast(this.t('stock.error.generic')); return; }
    const path = await this._ensureDockFile(true); if (!path) { this._toast(this.t('stock.error.download')); return; }
    window.kolboDesktop.synciStartDrag(path);
    if (this.isAuth()) this.api.stockLogDownload(d.asset, null, this._targetProjectId());
  }
  async _onDockDownload(btn) {
    const d = this._dock; if (!d) return;
    // CEP plugin has no ffmpeg, but audio trim is applied host-side (Premiere sets
    // the clip in/out), so honor the dock's In/Out selection when placing.
    if (this.bridge && typeof this.bridge.placeAsset === 'function') return this._placeDockTrimmed(btn);
    if (btn) btn.classList.add('busy');
    const path = await this._ensureDockFile(true);
    if (!path) { if (btn) btn.classList.remove('busy'); this._toast(this.t('stock.error.download')); return; }
    try { if (window.kolboDesktop && window.kolboDesktop.synciSaveToDownloads) { const fn = this._safeName(d.asset.title) + (this._dockFull() ? '' : '_trim') + this._extFor(d.asset); await window.kolboDesktop.synciSaveToDownloads(path, fn); this._toast(this.t('stock.downloaded')); if (this.isAuth()) this.api.stockLogDownload(d.asset, null, this._targetProjectId()); } } catch (e) { this._toast(this.t('stock.error.download')); }
    this._flashDone(btn);
  }

  // Dock "download" button (plugin) — place the (trimmed) audio on the timeline
  // with busy/done feedback + a toast, honoring the In/Out selection.
  async _placeDockTrimmed(btn) {
    const d = this._dock; if (!d) return;
    if (btn && btn.classList.contains('busy')) return;
    if (btn) btn.classList.add('busy');
    const asset = d.asset;
    const vlabel = asset.downloadVariants && asset.downloadVariants[0] && asset.downloadVariants[0].label;
    try {
      const url = this.api.stockDownloadUrl(asset.source, asset.sourceId, vlabel, asset.mediaType);
      const filename = this._safeName(asset.title) + this._extFor(asset, vlabel);
      const res = await this.bridge.placeAsset(url, filename, asset.mediaType, this._dockTrimOpts());
      if (res && res.success === false) throw new Error(res.error || this.t('stock.error.download'));
      this._toast(this.t('stock.placed'));
      if (this.isAuth()) this.api.stockLogDownload(asset, vlabel, this._targetProjectId());
      this._flashDone(btn);
    } catch (err) { console.error('[Stock] dock place failed:', err); this._toast(err.message || this.t('stock.error.download')); if (btn) btn.classList.remove('busy'); }
  }

  // ── universal native drag-out for ANY card/row (full asset unless opts.trim) ─
  async _startAssetDrag(asset, opts) {
    if (!asset) return;
    const v = asset.downloadVariants && asset.downloadVariants[0] && asset.downloadVariants[0].label;
    const url = this.api.stockDownloadUrl(asset.source, asset.sourceId, v, asset.mediaType);
    const filename = this._safeName(asset.title) + this._extFor(asset, v);
    if (this.bridge && typeof this.bridge.placeAsset === 'function') { try { await this.bridge.placeAsset(url, filename, asset.mediaType, opts || null); } catch (e) {} return; }
    if (!window.kolboDesktop || !window.kolboDesktop.synciCacheTrack || !window.kolboDesktop.synciStartDrag) return;
    try {
      const cached = this._dragCache && this._dragCache[this._key(asset)];
      const path = cached || (await window.kolboDesktop.synciCacheTrack(url, filename).then((r) => (r && r.success && r.filePath) ? r.filePath : null));
      if (!path) return;
      this._dragCache = this._dragCache || {}; this._dragCache[this._key(asset)] = path;
      window.kolboDesktop.synciStartDrag(path);
      if (this.isAuth()) this.api.stockLogDownload(asset, v, this._targetProjectId());
    } catch (e) {}
  }
  _prewarmAssetDrag(asset) {
    if (!asset || (this.bridge && this.bridge.placeAsset)) return;
    if (!window.kolboDesktop || !window.kolboDesktop.synciCacheTrack) return;
    const key = this._key(asset); this._dragCache = this._dragCache || {};
    if (this._dragCache[key]) return;
    const v = asset.downloadVariants && asset.downloadVariants[0] && asset.downloadVariants[0].label;
    const url = this.api.stockDownloadUrl(asset.source, asset.sourceId, v, asset.mediaType);
    window.kolboDesktop.synciCacheTrack(url, this._safeName(asset.title) + this._extFor(asset, v)).then((r) => { if (r && r.success && r.filePath) this._dragCache[key] = r.filePath; }).catch(() => {});
  }

  // ==========================================================================
  // Actions
  // ==========================================================================
  async _toggleFavorite(a, btn) {
    if (!this.requireAuth()) return;
    const key = this._key(a); const was = this.favorited.has(key);
    if (was) this.favorited.delete(key); else this.favorited.add(key);
    if (btn) btn.classList.toggle('active', !was);
    try {
      if (was) await this.api.stockRemoveFavorite(a.source, a.sourceId);
      else await this.api.stockAddFavorite(a, this._targetProjectId());
    } catch (err) {
      if (was) this.favorited.add(key); else this.favorited.delete(key);
      if (btn) btn.classList.toggle('active', was);
      this._toast(err.message || this.t('stock.error.generic')); return;
    }
    if (was && this.section === 'favorites') {
      this.assets = this.assets.filter((x) => this._key(x) !== key);
      this._render(false);
      if (this.assets.length === 0) this._setStatus(this.t('stock.empty.favorites'));
    }
  }
  _variants(a) { return Array.isArray(a.downloadVariants) ? a.downloadVariants : []; }
  async _download(a, btn) {
    const variants = this._variants(a);
    if (variants.length > 1) {
      KolboDropdown.open({ trigger: btn, noAvatar: true, items: variants.map((v) => ({ id: v.label, label: this._variantLabel(v) })), onSelect: (label) => this._doDownload(a, label, btn) });
      return;
    }
    this._doDownload(a, variants[0] && variants[0].label, btn);
  }
  async _doDownload(a, variantLabel, btn) {
    if (btn && btn.classList.contains('busy')) return;
    if (btn) btn.classList.add('busy');
    this._setCardProcessing(a, true);
    try {
      const url = this.api.stockDownloadUrl(a.source, a.sourceId, variantLabel, a.mediaType);
      const filename = this._safeName(a.title || a.source) + this._extFor(a, variantLabel);
      let placed = false;
      if (this.bridge && typeof this.bridge.placeAsset === 'function') {
        const res = await this.bridge.placeAsset(url, filename, a.mediaType);
        placed = !(res && res.success === false);
        if (!placed) throw new Error((res && res.error) || this.t('stock.error.download'));
      } else if (window.kolboDesktop && typeof window.kolboDesktop.synciDownloadToDisk === 'function') {
        const res = await window.kolboDesktop.synciDownloadToDisk(url, filename);
        placed = !!(res && res.success !== false);
        if (!placed) throw new Error((res && res.error) || this.t('stock.error.download'));
      }
      if (placed) {
        const toTimeline = this.bridge && typeof this.bridge.placeAsset === 'function';
        this._toast(this.t(toTimeline ? 'stock.placed' : 'stock.downloaded'));
        if (this.isAuth()) this.api.stockLogDownload(a, variantLabel, this._targetProjectId());
      }
      this._setCardProcessing(a, false);
      this._flashDone(btn);
    } catch (err) { console.error('[Stock] download failed:', err); this._setCardProcessing(a, false); this._toast(err.message || this.t('stock.error.download')); if (btn) btn.classList.remove('busy'); }
  }
  async _import(a, btn) {
    if (!this.requireAuth()) return;
    if (btn && btn.classList.contains('busy')) return;
    if (btn) btn.classList.add('busy');
    this._setCardProcessing(a, true);
    try {
      const res = await this.api.stockImport({ source: a.source, id: a.sourceId, mediaType: a.mediaType, projectId: this._targetProjectId() });
      if (!res || res.status === false) throw new Error((res && res.message) || this.t('stock.error.import'));
      this._toast(res.alreadyImported ? this.t('stock.alreadyImported') : this.t('stock.imported'));
      this._setCardProcessing(a, false);
      this._flashDone(btn);
    } catch (err) { console.error('[Stock] import failed:', err); this._setCardProcessing(a, false); this._toast(err.message || this.t('stock.error.import')); if (btn) btn.classList.remove('busy'); }
  }
  _showLyrics(a) {
    const dlg = document.getElementById('stock-lyrics-dialog');
    if (!dlg) return;
    document.getElementById('stock-lyrics-title').textContent = a.title || 'Lyrics';
    document.getElementById('stock-lyrics-body').textContent = (a.meta && a.meta.lyrics) || '';
    dlg.classList.remove('hidden');
  }
  _downloadStems(a, btn) {
    const stems = a.meta && a.meta.stems;
    if (!stems) return;
    const items = Object.keys(stems).filter((k) => stems[k]).map((k) => ({ id: k, label: this.t('stock.stem.' + k) || k }));
    if (!items.length) return;
    KolboDropdown.open({ trigger: btn, noAvatar: true, items, onSelect: (k) => {
      const url = stems[k]; const filename = this._safeName(a.title) + '-' + k + '.mp3';
      if (this.bridge && typeof this.bridge.placeAsset === 'function') this.bridge.placeAsset(url, filename, 'music');
      else if (window.kolboDesktop && window.kolboDesktop.synciDownloadToDisk) window.kolboDesktop.synciDownloadToDisk(url, filename);
    } });
  }
  _flashDone(btn) { if (!btn) return; btn.classList.remove('busy'); btn.classList.add('done'); setTimeout(() => btn.classList.remove('done'), 1600); }
  // Full-tile processing overlay (download / add-to-timeline can take seconds for
  // video) — covers the whole asset, not just the tiny action button.
  _setCardProcessing(a, on) {
    if (!a) return;
    const key = this._cssEsc(this._key(a));
    const host = document.querySelector('.stock-card[data-key="' + key + '"] .stock-card-media') || document.querySelector('.stock-audio-row[data-key="' + key + '"]');
    if (!host) return;
    let ov = host.querySelector('.stock-processing');
    if (on) { if (!ov) { ov = document.createElement('div'); ov.className = 'stock-processing'; ov.innerHTML = '<span class="stock-spinner stock-spinner-lg"></span>'; host.appendChild(ov); } }
    else if (ov) ov.remove();
  }

  // ==========================================================================
  // Smart search
  // ==========================================================================
  _openScript() { if (!this.requireAuth()) return; const d = document.getElementById('stock-script-dialog'); if (d) d.classList.remove('hidden'); }
  _closeScript() { const d = document.getElementById('stock-script-dialog'); if (d) d.classList.add('hidden'); }
  async _runScript() {
    const ta = document.getElementById('stock-script-text'); const runBtn = document.getElementById('stock-script-run');
    const text = (ta && ta.value || '').trim(); if (!text) return;
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = this.t('stock.script.analyzing'); }
    try {
      const res = await this.api.stockAnalyzeScript(text, this.mediaType);
      if (!res || res.status === false) throw new Error((res && res.message) || this.t('stock.error.generic'));
      this._closeScript();
      if (res.mediaType && res.mediaType !== this.mediaType && this._supportedMediaTypes().indexOf(res.mediaType) >= 0) {
        this.mediaType = res.mediaType; this.source = 'all';
        this._renderMediaTypes(); this._renderSources(); this._renderFooter(); await this._loadCategories();
      }
      this._applyQuery((res.queries && res.queries[0]) || '');
    } catch (err) { this._toast(err.message || this.t('stock.error.generic')); }
    finally { if (runBtn) { runBtn.disabled = false; runBtn.textContent = this.t('stock.script.run'); } }
  }
  _openVisionMenu(trigger) {
    if (!this.requireAuth()) return;
    const items = [];
    // "From timeline frame" — grab the current playhead frame (host-gated, like Synci).
    if (this.bridge && typeof this.bridge.exportFrameAsBase64 === 'function') items.push({ id: 'frame', label: this.t('stock.vision.frame') });
    items.push({ id: 'image', label: this.t('stock.vision.image') });
    items.push({ id: 'video', label: this.t('stock.vision.video') });
    KolboDropdown.open({ trigger, noAvatar: true, items, onSelect: (id) => {
      if (id === 'frame') return this._suggestFromFrame();
      this._suggestFromUpload(id === 'video' ? 'video/*' : 'image/*');
    } });
  }
  async _suggestFromFrame() {
    if (!this.requireAuth()) return;
    this._setBusy(true, this.t('stock.analyze.capturing'));
    try {
      const res = await this.bridge.exportFrameAsBase64();
      if (!res || !res.success || !res.imageData) throw new Error((res && res.error) || this.t('stock.error.frame'));
      const blob = this._dataURLToBlob(res.imageData);
      const file = new File([blob], 'timeline_frame.jpg', { type: blob.type || 'image/jpeg' });
      if (file.size > StockLibraryManager.MEDIA_MAX_BYTES) { this._setBusy(false); this._toast(this.t('stock.analyze.tooLarge')); return; }
      this._setBusy(true, this.t('stock.analyze.analyzing'));
      const analysis = await this.api.stockAnalyzeMedia(file);
      if (!analysis || analysis.status === false || !analysis.query) throw new Error((analysis && analysis.message) || this.t('stock.error.generic'));
      this._setBusy(false); this._applyQuery(analysis.query);
    } catch (err) {
      this._setBusy(false); console.error('[Stock] frame analyze failed:', err);
      this._toast(err.message || this.t('stock.error.frame'));
    }
  }
  _dataURLToBlob(dataURL) {
    const parts = String(dataURL).split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const bin = atob(parts[1] || '');
    const len = bin.length; const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }
  _promptFile(accept) { return new Promise((resolve) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => resolve((i.files && i.files[0]) || null); i.click(); }); }
  async _suggestFromUpload(accept) {
    const file = await this._promptFile(accept); if (!file) return;
    if (file.size > StockLibraryManager.MEDIA_MAX_BYTES) { this._toast(this.t('stock.analyze.tooLarge')); return; }
    this._setBusy(true, this.t('stock.analyze.analyzing'));
    try {
      const res = await this.api.stockAnalyzeMedia(file);
      if (!res || res.status === false || !res.query) throw new Error((res && res.message) || this.t('stock.error.generic'));
      this._setBusy(false); this._applyQuery(res.query);
    } catch (err) { this._setBusy(false); this._toast(err.message || this.t('stock.error.generic')); }
  }
  _applyQuery(q) {
    this.query = q || ''; const i = document.getElementById('stock-search-input'); if (i) i.value = this.query;
    if (this.section !== 'browse') this._browseUI(); this.runSearch();
  }

  // ==========================================================================
  // Hint / footer / favorites hydration / helpers
  // ==========================================================================
  _renderAiHint() {
    const el = document.getElementById('stock-ai-hint'); if (!el) return;
    if (this._optimizedQuery) { el.innerHTML = this._icon('sparkles', 12) + '<span>' + this._esc(this.t('stock.aiSearch')) + ' ' + this._esc(this._optimizedQuery) + '</span>'; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  }
  // Provider attribution + terms — mirrors kolbo-map's StockFooter: a distinct
  // "Stock Library Terms" chip first, then EITHER a clean "Powered by [source]"
  // (specific source selected) OR the full descriptive credits row (All sources /
  // Favorites / Downloaded). Listing all six providers under a single source is
  // noise; each shown provider still gets its licence-required link.
  _renderFooter() {
    const el = document.getElementById('stock-footer'); if (!el) return;
    const credits = StockLibraryManager.CREDITS;
    const link = (href, inner) => '<a href="' + this._escAttr(href) + '" target="_blank" rel="noopener noreferrer nofollow">' + inner + '</a>';
    const termsLink = (href) => href ? link(href, this._esc(this.t('stock.footer.termsShort'))) : '';
    let html =
      '<a class="stock-footer-terms" href="https://app.kolbo.ai/legal/stock-library-terms" target="_blank" rel="noopener noreferrer">' +
        this._sourceIconHtml('kolbo-ai', 12) + this._esc(this.t('stock.footer.terms')) + '</a>' +
      '<span class="stock-footer-div" aria-hidden="true"></span>';
    const primary = (this.section === 'browse' && this.source !== 'all') ? this.source : null;
    if (primary) {
      // Kolbo-owned sources (kolbo-ai / Synci music) get the branded mark without a link.
      const c = credits[primary] || {};
      const label = (this.sourcesList.find((s) => s.key === primary) || {}).label || primary;
      const mark = this._sourceIconHtml(primary, 13) + this._esc(label) + (c.href ? this._icon('externalLink', 10) : '');
      html += '<span class="stock-footer-credit stock-footer-powered">' + this._esc(this.t('stock.footer.poweredBy')) + ' ' +
        (c.href ? link(c.href, mark) : '<span class="stock-footer-mark">' + mark + '</span>') +
        (c.terms ? ' <span class="stock-footer-tos">' + termsLink(c.terms) + '</span>' : '') + '</span>';
    } else {
      html += Object.keys(credits).map((key) => {
        const c = credits[key];
        return '<span class="stock-footer-credit">' +
          link(c.href, this._sourceIconHtml(key, 12) + this._esc(this.t('stock.credit.' + key)) + this._icon('externalLink', 10)) +
          (c.terms ? ' <span class="stock-footer-tos">' + termsLink(c.terms) + '</span>' : '') + '</span>';
      }).join('');
    }
    el.innerHTML = html;
  }
  async _loadFavoriteIds() {
    try {
      const ids = await this.api.stockListFavoriteIds();
      this.favorited = new Set(ids); this._favIdsLoaded = true;
      document.querySelectorAll('[data-key]').forEach((el) => { const h = el.querySelector('.stock-fav'); if (h) h.classList.toggle('active', this.favorited.has(el.dataset.key)); });
    } catch (err) { console.warn('[Stock] favorite ids load failed:', err && err.message); }
  }
  _setPartial(on, sources) {
    const el = document.getElementById('stock-partial'); if (!el) return;
    if (on) {
      const failed = Array.isArray(sources) ? sources.filter((s) => s.error).map((s) => s.source) : [];
      el.innerHTML = this._icon('alertTriangle', 14) + '<span>' + (failed.length ? this._esc(this.t('stock.partialNamed', { sources: failed.join(', ') })) : this._esc(this.t('stock.partial'))) + '</span>';
      el.classList.remove('hidden');
    } else el.classList.add('hidden');
  }
  _setStatus(msg) { const el = document.getElementById('stock-status'); if (el) el.textContent = msg || ''; }
  _beginLoad() { if (this.assets.length === 0) { this._showCenterLoader(true); this._setStatus(''); } else { this._showMoreLoader(true); } }
  // "Loading more…" pill for infinite scroll — floats above the dock (which would
  // otherwise cover a bottom-of-list spinner) so it's always visible.
  _showMoreLoader(show) {
    const el = document.getElementById('stock-more'); if (!el) return;
    if (show) {
      const dock = this._dockEl('stock-dock');
      const dockOpen = dock && !dock.classList.contains('hidden');
      el.style.bottom = (dockOpen ? (dock.offsetHeight || 90) + 18 : 44) + 'px';
      el.classList.remove('hidden');
    } else { el.classList.add('hidden'); }
  }
  _showCenterLoader(show) { this._setBusy(show, show ? this.t('stock.loading') : null); }
  _setBusy(show, msg) { const el = document.getElementById('stock-loading'); if (!el) return; const t = el.querySelector('.stock-loading-text'); if (t && msg) t.textContent = msg; el.classList.toggle('hidden', !show); }
  _toast(msg) { if (window.app && typeof window.app.showToast === 'function') { window.app.showToast(msg); return; } this._setStatus(msg); }
  _fmtDur(sec) { sec = Math.round(sec || 0); const m = Math.floor(sec / 60); const s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  _variantLabel(v) { const p = []; if (v.label) p.push(String(v.label).toUpperCase()); if (v.width && v.height) p.push(v.width + '×' + v.height); else if (v.ext) p.push(String(v.ext).toUpperCase()); return p.join(' · ') || (v.ext || 'file'); }
  _extFor(a, variantLabel) {
    const v = this._variants(a).find((x) => x.label === variantLabel) || this._variants(a)[0];
    let ext = (v && v.ext) || ''; if (!ext && v && v.url) ext = (v.url.split('?')[0].split('.').pop() || '').slice(0, 5);
    if (!ext) ext = a.mediaType === 'video' ? 'mp4' : (this.isAudio() ? 'mp3' : 'jpg');
    return '.' + ext.replace(/^\./, '');
  }
  _safeName(title) { return (title || 'stock').replace(/[^\w\-\s.]/g, '').slice(0, 80).trim() || 'stock'; }
  // Real provider brand logo (falls back to a Lucide glyph for unknown sources).
  // Apps are dark-only, so the monochrome marks (unsplash / kolbo-ai / synci) use
  // their white variant.
  _sourceIconHtml(source, size) {
    const file = StockLibraryManager.SRC_LOGO[source];
    const s = size || 14;
    if (file) return '<img class="stock-brand" src="' + file + '" alt="" width="' + s + '" height="' + s + '">';
    return this._icon(StockLibraryManager.SRC_ICON[source] || 'layoutGrid', s);
  }
  // Playable video URL: for video assets previewUrl is often a POSTER image
  // (Coverr/Pixabay), so prefer the real video file from downloadVariants.
  _videoUrl(a) {
    const v = this._variants(a).find((x) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(x.url || '') || /^(mp4|webm|mov|m4v)$/i.test(x.ext || '')) || this._variants(a)[0];
    return (v && v.url) || a.previewUrl || '';
  }
  _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  _cssEsc(s) { return String(s == null ? '' : s).replace(/["\\]/g, '\\$&'); }
  _escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
}

StockLibraryManager.DEFAULT_FILTERS = { category: null, subcategory: null, genre: null, mood: null, theme: null, instrument: null, vocals: null, color: null, orientation: null, collectionId: null, bpmMin: null, bpmMax: null, durationMin: null, durationMax: null };

// Media-type → Lucide icon name; source key → Lucide icon name (matches kolbo-map).
// Curated media-type tab order (video first → music → sfx → vector → image → 3d).
StockLibraryManager.MT_ORDER = ['video', 'music', 'sfx', 'vector', 'image', '3d'];
StockLibraryManager.MT_ICON = { image: 'image', vector: 'penTool', video: 'video', '3d': 'box', music: 'music', sfx: 'audioWaveform' };
StockLibraryManager.SRC_ICON = { 'kolbo-ai': 'sparkles', pexels: 'camera', unsplash: 'camera', pixabay: 'images', coverr: 'film', freesound: 'audioWaveform', sketchfab: 'box', music: 'music' };
// Real provider brand logos (apps are dark-only → monochrome marks use white).
// Provider credits — labels/links mirror kolbo-map's StockFooter (Pexels' link +
// Coverr's clickable logo are API-required; Unsplash/Freesound also link terms).
StockLibraryManager.CREDITS = {
  pexels: { href: 'https://www.pexels.com' },
  unsplash: { href: 'https://unsplash.com', terms: 'https://unsplash.com/terms' },
  pixabay: { href: 'https://pixabay.com' },
  coverr: { href: 'https://coverr.co' },
  freesound: { href: 'https://freesound.org', terms: 'https://freesound.org/help/tos_web/' },
  sketchfab: { href: 'https://sketchfab.com' },
};

StockLibraryManager.SRC_LOGO = {
  pexels: 'images/stock-sources/pexels.png',
  pixabay: 'images/stock-sources/pixabay.svg',
  sketchfab: 'images/stock-sources/sketchfab.png',
  coverr: 'images/stock-sources/coverr.png',
  freesound: 'images/stock-sources/freesound.png',
  unsplash: 'images/stock-sources/unsplash-symbol-white.png',
  'kolbo-ai': 'images/kolbo-icon-white.svg',
  music: 'images/synci-symbol-white.png',
};

// Exact Lucide icon path data (24×24). Inline so it renders without the lucide runtime.
StockLibraryManager.ICONS = {
  search: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
  imagePlus: '<path d="M16 5h6"></path><path d="M19 2v6"></path><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"></path><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path><circle cx="9" cy="9" r="2"></circle>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M16 13H8"></path><path d="M16 17H8"></path><path d="M10 9H8"></path>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line>',
  plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
  folderPlus: '<path d="M12 10v6"></path><path d="M9 13h6"></path><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>',
  play: '<polygon points="6 3 20 12 6 21 6 3"></polygon>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path>',
  music: '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>',
  audioWaveform: '<path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"></path>',
  externalLink: '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
  x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  chevronDown: '<path d="m6 9 6 6 6-6"></path>',
  chevronLeft: '<path d="m15 18-6-6 6-6"></path>',
  alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"></path><path d="m22 12.18-9.17 4.16a2 2 0 0 1-1.66 0L2 12.18"></path><path d="m22 17.18-9.17 4.16a2 2 0 0 1-1.66 0L2 17.18"></path>',
  video: '<path d="m22 8-6 4 6 4V8Z"></path><rect x="2" y="6" width="14" height="12" rx="2"></rect>',
  penTool: '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"></path><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.45 15.918a1 1 0 0 0 .776.746L13 18"></path><path d="m2.3 2.3 7.286 7.286"></path><circle cx="11" cy="11" r="2"></circle>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>',
  layoutGrid: '<rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle>',
  images: '<path d="M18 22H4a2 2 0 0 1-2-2V6"></path><path d="m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18"></path><circle cx="12" cy="8" r="2"></circle><rect width="16" height="16" x="6" y="2" rx="2"></rect>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M7 3v18"></path><path d="M3 7.5h4"></path><path d="M3 12h18"></path><path d="M3 16.5h4"></path><path d="M17 3v18"></path><path d="M17 7.5h4"></path><path d="M17 16.5h4"></path>',
  grid2x2: '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 12h18"></path><path d="M12 3v18"></path>',
  grid3x3: '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path><path d="M3 15h18"></path><path d="M9 3v18"></path><path d="M15 3v18"></path>',
  arrowUpDown: '<path d="m21 16-4 4-4-4"></path><path d="M17 20V4"></path><path d="m3 8 4-4 4 4"></path><path d="M7 4v16"></path>',
  shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path>',
};

StockLibraryManager.FALLBACK = {
  'stock.title': 'Stock Library',
  'stock.gridDensity': 'Grid density',
  'stock.tab.browse': 'Browse', 'stock.tab.favorites': 'Favorites', 'stock.tab.downloaded': 'Downloaded',
  'stock.search.placeholder': 'Search photos, video, music, SFX, 3D…', 'stock.search.go': 'Search',
  'stock.allSources': 'All sources',
  'stock.smart.vision': 'Search from an image or video', 'stock.smart.script': 'Find footage from a script',
  'stock.aiSearch': 'AI search:',
  'stock.mt.image': 'Photos', 'stock.mt.illustration': 'Illustrations', 'stock.mt.vector': 'Vectors', 'stock.mt.video': 'Video', 'stock.mt.3d': '3D', 'stock.mt.music': 'Music', 'stock.mt.sfx': 'Sound FX',
  'stock.facet.genre': 'Genre', 'stock.facet.mood': 'Mood', 'stock.facet.theme': 'Theme', 'stock.facet.instrument': 'Instrument',
  'stock.clear': 'Clear',
  'stock.sort.label': 'Sort', 'stock.sort.relevance': 'Relevance', 'stock.sort.popular': 'Most popular', 'stock.sort.newest': 'Newest',
  'stock.sort.bpmAsc': 'BPM · slowest', 'stock.sort.bpmDesc': 'BPM · fastest', 'stock.sort.durAsc': 'Length · shortest', 'stock.sort.durDesc': 'Length · longest',
  'stock.surprise': 'Surprise me',
  'stock.range.bpm': 'Tempo (BPM)', 'stock.range.duration': 'Length', 'stock.range.any': 'Any',
  'stock.album.tracks': '{{count}} tracks', 'stock.album.back': 'Back to library', 'stock.album.by': 'Album by {{artist}}', 'stock.album.play': 'Play', 'stock.album.similar': 'Similar albums',
  'stock.vocals.all': 'All', 'stock.vocals.instrumental': 'Instrumental', 'stock.vocals.vocals': 'With vocals',
  'stock.vision.image': 'Upload an image', 'stock.vision.video': 'Upload a video', 'stock.vision.frame': 'From timeline frame',
  'stock.script.title': 'Find footage from a script', 'stock.script.placeholder': 'Paste your script or voiceover here…', 'stock.script.run': 'Find footage', 'stock.script.analyzing': 'Analyzing…',
  'stock.projectScope': 'Project', 'stock.allProjects': 'All projects',
  'stock.loading': 'Loading…', 'stock.endOfResults': 'End of results',
  'stock.partial': 'Some sources are temporarily unavailable.', 'stock.partialNamed': 'Some sources are unavailable ({{sources}}).',
  'stock.empty.browse': 'No results. Try another keyword or source.', 'stock.empty.favorites': 'No favorites yet. Tap the heart on any asset to save it.', 'stock.empty.downloaded': 'Nothing imported or downloaded yet.',
  'stock.preview': 'Preview', 'stock.favorite': 'Favorite', 'stock.download': 'Download', 'stock.import': 'Add to library',
  'stock.lyrics': 'Lyrics', 'stock.stems': 'Download stems', 'stock.stem.vocals': 'Vocals', 'stock.stem.instrumental': 'Instrumental',
  'stock.downloaded': 'Saved to your downloads', 'stock.placed': 'Added to your timeline', 'stock.imported': 'Added to your media library', 'stock.alreadyImported': 'Already in your library',
  'stock.viewSource': 'View source', 'stock.close': 'Close', 'stock.cancel': 'Cancel',
  'stock.in': 'In', 'stock.out': 'Out', 'stock.dragHint': 'Drag onto your timeline / any app', 'stock.preparing': 'Preparing…',
  'stock.dragTrim': 'Drag the selection out to save the trimmed clip', 'stock.dragOut': 'drag out', 'stock.open3d': 'Open interactive 3D',
  'stock.analyze.analyzing': 'Analyzing…', 'stock.analyze.capturing': 'Capturing frame…', 'stock.analyze.tooLarge': 'That file is too large (max 50 MB).',
  'stock.error.generic': 'Something went wrong. Please try again.', 'stock.error.download': 'Could not download that asset.', 'stock.error.import': 'Could not add that asset to your library.', 'stock.error.frame': 'Could not capture the timeline frame.',
  'stock.footer.terms': 'Stock Library Terms', 'stock.footer.poweredBy': 'Powered by', 'stock.footer.termsShort': 'Terms',
  'stock.credit.pexels': 'Photos & videos provided by Pexels', 'stock.credit.unsplash': 'Photos provided by Unsplash',
  'stock.credit.pixabay': 'Content from Pixabay', 'stock.credit.coverr': 'Videos provided by Coverr',
  'stock.credit.freesound': 'Sounds provided by Freesound', 'stock.credit.sketchfab': '3D models from Sketchfab',
};

if (typeof window !== 'undefined') window.StockLibraryManager = StockLibraryManager;
if (typeof module !== 'undefined' && module.exports) module.exports = StockLibraryManager;

// Kolbo Studio - Quick Tools: Timeline Sync
// Drop cameras + recorders → sync by sound → FCP7 XML timeline (Premiere / Resolve)

class AudioSyncTool {
  constructor(manager) {
    this.manager = manager;
    this.files = []; // { path, name }
    this.results = null; // last analyze() items keyed by path
    this.outputPath = null;
    this.isProcessing = false;
    this.dropzone = document.getElementById('qt-sync-dropzone');
    this.workspace = document.getElementById('qt-sync-workspace');
    window.kolboDesktop?.quickTools?.onAudioSyncProgress?.(({ message }) => {
      const el = document.getElementById('qt-sync-progress-msg');
      if (el) el.textContent = message;
    });
  }

  t(key, fallback) { const k = `quickTools.sync.${key}`; const v = window.t ? window.t(k) : null; return v && v !== k ? v : fallback; }

  addFiles(files) {
    for (const f of files) {
      if (!f.path || this.files.some((x) => x.path === f.path)) continue;
      const entry = { path: f.path, name: f.name, file: f, visual: null };
      this.files.push(entry);
      this.makeVisual(entry);
    }
    this.results = null; this.outputPath = null;
    if (this.files.length) {
      this.dropzone.classList.add('hidden');
      this.workspace.classList.remove('hidden');
    }
    this.render();
  }

  render() {
    const rows = this.files.map((f, i) => {
      const r = this.results?.[f.path];
      let status = '';
      if (r) {
        if (r.synced) {
          const off = r.offset >= 0 ? `+${r.offset.toFixed(2)}s` : `${r.offset.toFixed(2)}s`;
          const ref = r.confidence === null ? ` · ${this.t('reference', 'reference')}` : '';
          status = `<span style="color:#22c55e">${this.t('synced', 'Synced')} ${off}${ref}</span>`;
        } else {
          status = `<span style="color:#ef4444">${this.t('unsynced', 'No match')}${r.error ? ` · ${r.error}` : ''}</span>`;
        }
      }
      return `
      <div class="qt-merger-clip" data-index="${i}">
        <div class="qt-merger-clip-info">
          <div class="qt-merger-clip-name">${f.name}</div>
          <div class="qt-merger-clip-meta">${status}</div>
        </div>
        <div class="qt-merger-clip-actions">
          <button class="qt-merger-clip-btn remove" data-index="${i}" title="Remove" ${this.isProcessing ? 'disabled' : ''}>${Icons.get('x', 14)}</button>
        </div>
      </div>`;
    }).join('');

    this.workspace.innerHTML = `
      ${this.timelineHtml()}
      <div class="qt-merger-clips">${rows}</div>
      <div id="qt-sync-progress" class="qt-progress-container ${this.isProcessing ? '' : 'hidden'}">
        <div class="qt-progress-header">
          <span class="qt-progress-label">${this.t('syncing', 'Syncing by sound…')}</span>
          <span class="qt-progress-percent" id="qt-sync-progress-msg"></span>
        </div>
        <div class="qt-progress-bar"><div class="qt-progress-fill indeterminate" style="width:100%"></div></div>
      </div>
      ${this.outputPath ? `
      <div class="qt-progress-container">
        <div class="qt-progress-header">
          <span class="qt-progress-label">${this.t('done', 'Timeline XML saved')}: ${this.outputPath.split(/[/\\\\]/).pop()}</span>
          <button class="qt-btn qt-btn-secondary qt-btn-sm" id="qt-sync-show-btn">${this.t('showInFolder', 'Show in folder')}</button>
        </div>
        <div class="qt-progress-label" style="opacity:.7">${this.t('importHint', 'Premiere / Resolve: File → Import this XML')}</div>
      </div>` : ''}
      ${this.results && !this.outputPath ? `
      <div class="qt-progress-container">
        <div class="qt-progress-label">${this.t('reviewHint', 'Review the offsets above, then save the timeline XML where you want it.')}</div>
      </div>` : ''}
      <div class="qt-action-bar">
        <div class="qt-action-bar-left">
          <button class="qt-btn qt-btn-secondary" id="qt-sync-clear-btn" ${this.isProcessing ? 'disabled' : ''}>${this.t('clearAll', 'Clear All')}</button>
          <button class="qt-btn qt-btn-secondary" id="qt-sync-add-btn" ${this.isProcessing ? 'disabled' : ''}>${Icons.get('plus', 16)} ${this.t('addMore', 'Add Files')}</button>
        </div>
        <div class="qt-action-bar-right">
          <button class="qt-btn ${this.canSave() ? 'qt-btn-secondary' : 'qt-btn-primary'}" id="qt-sync-run-btn" ${this.files.length < 2 || this.isProcessing ? 'disabled' : ''}>${Icons.get('audio-waveform', 16)} ${this.t('sync', 'Sync')}</button>
          ${this.canSave() ? `<button class="qt-btn qt-btn-primary" id="qt-sync-save-btn">${Icons.get('save', 16)} ${this.t('saveXml', 'Save Timeline XML…')}</button>` : ''}
        </div>
      </div>`;

    this.workspace.querySelectorAll('.qt-merger-clip-btn.remove').forEach((b) => b.addEventListener('click', () => {
      this.files.splice(parseInt(b.dataset.index, 10), 1);
      this.results = null; this.outputPath = null;
      this.files.length ? this.render() : this.reset();
    }));
    document.getElementById('qt-sync-clear-btn')?.addEventListener('click', () => this.reset());
    document.getElementById('qt-sync-add-btn')?.addEventListener('click', () => this.manager.fileInputs.sync?.click());
    document.getElementById('qt-sync-run-btn')?.addEventListener('click', () => this.run());
    document.getElementById('qt-sync-save-btn')?.addEventListener('click', () => this.save());
    document.getElementById('qt-sync-show-btn')?.addEventListener('click', () => window.kolboDesktop.showInFolder(this.outputPath));
  }

  async run() {
    if (this.isProcessing) return;
    this.isProcessing = true; this.outputPath = null; this.render();
    const res = await window.kolboDesktop.quickTools.audioSync({ files: this.files.map((f) => f.path) });
    this.isProcessing = false;
    if (res.result) {
      this.results = {};
      for (const it of res.result.items) {
        this.results[it.file] = { ...it, confidence: it.file === res.result.reference ? null : it.confidence };
      }
    }
    if (!res.success) {
      this.manager.showToast(res.error === 'no-match' ? this.t('noMatch', 'Could not find matching audio between the files') : (res.error || 'Sync failed'), 'error');
    }
    this.render();
  }

  /** Filmstrip (video) or waveform (audio) as a data URL, used as the timeline bar background. */
  async makeVisual(entry) {
    try {
      const isVideo = /\.(mp4|mov|mkv|webm|avi|m4v|mxf)$/i.test(entry.name);
      entry.visual = isVideo ? await this.filmstrip(entry.file) : await this.waveformImage(entry.path);
    } catch { entry.visual = null; }
    if (this.results) this.render();
  }

  filmstrip(file, frames = 8, fw = 96, fh = 54) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata'; video.muted = true;
      video.src = URL.createObjectURL(file);
      const canvas = document.createElement('canvas');
      canvas.width = fw * frames; canvas.height = fh;
      const ctx = canvas.getContext('2d');
      let i = 0;
      const finish = (ok) => { URL.revokeObjectURL(video.src); resolve(ok ? canvas.toDataURL('image/jpeg', 0.6) : null); };
      const timer = setTimeout(() => finish(i > 0), 15000);
      video.onloadedmetadata = () => { video.currentTime = (video.duration * (i + 0.5)) / frames; };
      video.onseeked = () => {
        ctx.drawImage(video, i * fw, 0, fw, fh);
        i++;
        if (i >= frames) { clearTimeout(timer); finish(true); }
        else video.currentTime = (video.duration * (i + 0.5)) / frames;
      };
      video.onerror = () => { clearTimeout(timer); finish(false); };
    });
  }

  async waveformImage(path, bars = 240, w = 960, h = 54) {
    const res = await window.kolboDesktop.fileExplorer.analyzeWaveform(path, bars);
    if (!res?.success || !res.peaks?.length) return null;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const bw = w / res.peaks.length;
    res.peaks.forEach((p, i) => { const bh = Math.max(2, p * (h - 6)); ctx.fillRect(i * bw + 1, (h - bh) / 2, Math.max(1, bw - 2), bh); });
    return canvas.toDataURL('image/png');
  }

  visualStyle(r) {
    const v = this.files.find((f) => f.path === r.file)?.visual;
    if (!v) return '';
    return r.info.hasVideo
      ? `background-image:url(${v});background-size:auto 100%;background-repeat:repeat-x;`
      : `background-image:url(${v});background-size:100% 100%;background-repeat:no-repeat;`;
  }

  /** Horizontal preview: one lane per synced file, bars at their offsets on a shared ruler. */
  timelineHtml() {
    const all = Object.values(this.results || {}).filter((r) => r.info);
    const synced = all.filter((r) => r.synced);
    const unmatched = all.filter((r) => !r.synced);
    if (!all.length) return '';
    const start = synced.length ? Math.min(...synced.map((r) => r.offset)) : 0;
    const end = synced.length ? Math.max(...synced.map((r) => r.offset + r.info.duration)) : 0;
    const span = Math.max(end - start, ...unmatched.map((r) => r.info.duration), 1);
    const fmt = (sec) => this.manager.formatTimeShort(Math.max(0, sec));
    const stepFor = [5, 10, 30, 60, 120, 300, 600, 900, 1800, 3600].find((st) => span / st <= 12) || 3600;
    let ticks = '';
    for (let t = 0; t <= span; t += stepFor) ticks += `<span class="qt-sync-tick" style="left:${(t / span) * 100}%">${fmt(t)}</span>`;
    const lanes = synced.sort((a, b) => a.offset - b.offset).map((r) => {
      const left = ((r.offset - start) / span) * 100, width = (r.info.duration / span) * 100;
      const cls = `qt-sync-clip${r.info.hasVideo ? '' : ' audio'}${r.confidence === null ? ' reference' : ''}`;
      const name = r.file.split(/[/\\]/).pop();
      return `<div class="qt-sync-lane"><div class="qt-sync-lane-name" title="${name}">${name}</div>
        <div class="qt-sync-lane-track"><div class="${cls}" style="left:${left}%;width:${width}%;${this.visualStyle(r)}" title="${name} · ${fmt(r.offset - start)} → ${fmt(r.offset - start + r.info.duration)}">${fmt(r.info.duration)}</div></div></div>`;
    }).join('') + unmatched.map((r) => {
      const name = r.file.split(/[/\\]/).pop();
      return `<div class="qt-sync-lane"><div class="qt-sync-lane-name" title="${name}">${name}</div>
        <div class="qt-sync-lane-track"><div class="qt-sync-clip unmatched" style="left:0;width:${Math.min(100, (r.info.duration / span) * 100)}%;${this.visualStyle(r)}" title="${name}">${this.t('unsynced', 'No match')} · ${fmt(r.info.duration)}</div></div></div>`;
    }).join('');
    return `<div class="qt-sync-timeline"><div class="qt-sync-ruler">${ticks}</div>${lanes}
      <div class="qt-sync-legend">${this.t('legend', 'Blue = video · Green = audio · Outlined = reference')}</div></div>`;
  }

  canSave() { return !!this.results && Object.values(this.results).filter((r) => r.synced).length >= 2; }

  async save() {
    const items = Object.values(this.results || {}).filter((r) => r.synced);
    const res = await window.kolboDesktop.quickTools.audioSyncSave({ items });
    if (res.canceled) return;
    if (res.success) {
      this.outputPath = res.outputPath;
      this.manager.showToast(this.t('done', 'Timeline XML saved'), 'success');
      this.render();
    } else {
      this.manager.showToast(res.error || 'Save failed', 'error');
    }
  }

  reset() {
    this.files = []; this.results = null; this.outputPath = null;
    this.workspace.innerHTML = '';
    this.workspace.classList.add('hidden');
    this.dropzone.classList.remove('hidden');
  }
}

window.AudioSyncTool = AudioSyncTool;

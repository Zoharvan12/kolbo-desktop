// ============================================================================
// Kolbo.AI Adobe Plugin - Shared Canvas Waveform (KolboWaveform)
// ============================================================================
// Renders an Artlist/kolbo-map-style audio waveform on a <canvas>, tied to an
// HTMLAudioElement for two-tone played/unplayed progress + click-to-seek.
//
// Real peaks are decoded with the Web Audio API (RMS per bucket, normalized).
// In CEP the panel origin is file://, so:
//   - audio bytes are fetched via Node (require('https')) to bypass browser CORS
//   - peaks are cached in a session Map (always) + IndexedDB (best-effort)
//   - decoding is lazy (IntersectionObserver) and concurrency-capped (max 3)
// Until real peaks load, a deterministic skeleton waveform is drawn.
//
// Usage:
//   var wave = KolboWaveform.create({ canvas, audio, url, waveColor, progressColor });
//   ... wave.destroy();   // on row teardown
// ============================================================================

var KolboWaveform = (function () {
  'use strict';

  var NUM_PEAKS = 400;            // decode resolution (downsampled to fit width)
  var MAX_CONCURRENT = 3;         // simultaneous decodes
  var CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
  var MEM_MAX = 300;              // session Map entries before LRU evict

  // ── Session (L1) cache ────────────────────────────────────────────────────
  var _mem = new Map();           // key -> { peaks, duration }
  function _memGet(key) {
    if (!_mem.has(key)) return null;
    var v = _mem.get(key);
    _mem.delete(key); _mem.set(key, v); // bump LRU
    return v;
  }
  function _memPut(key, val) {
    _mem.set(key, val);
    if (_mem.size > MEM_MAX) { _mem.delete(_mem.keys().next().value); }
  }

  // ── IndexedDB (L2) cache — best effort, may be unavailable on file:// ──────
  var DB_NAME = 'kolbo_waveforms', STORE = 'peaks', _dbPromise = null, _dbBad = false;
  function _db() {
    if (_dbBad) return Promise.reject();
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      try {
        if (!window.indexedDB) { _dbBad = true; return reject(); }
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { _dbBad = true; reject(); };
      } catch (e) { _dbBad = true; reject(); }
    });
    return _dbPromise;
  }
  function _idbGet(key) {
    return _db().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readonly');
          var r = tx.objectStore(STORE).get(key);
          r.onsuccess = function () {
            var v = r.result;
            if (v && v.ts && (Date.now() - v.ts) < CACHE_TTL) resolve(v);
            else resolve(null);
          };
          r.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }
  function _idbPut(key, val) {
    return _db().then(function (db) {
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ peaks: val.peaks, duration: val.duration, ts: Date.now() }, key);
      } catch (e) {}
    }).catch(function () {});
  }

  function _hash(url) {
    var h = 2166136261, s = String(url || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  // ── Decode concurrency gate ───────────────────────────────────────────────
  var _active = 0, _queue = [];
  function _acquire() {
    return new Promise(function (res) {
      if (_active < MAX_CONCURRENT) { _active++; res(); } else _queue.push(res);
    });
  }
  function _release() {
    _active--;
    if (_queue.length) { _active++; _queue.shift()(); }
  }

  // Fetch raw bytes — prefer Node (CEP) to dodge file:// CORS; else window.fetch.
  function _fetchArrayBuffer(url) {
    if (typeof require === 'function') {
      return _nodeFetch(url, 0).catch(function () { return _browserFetch(url); });
    }
    return _browserFetch(url);
  }
  function _browserFetch(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('fetch ' + r.status);
      return r.arrayBuffer();
    });
  }
  function _nodeFetch(url, depth) {
    return new Promise(function (resolve, reject) {
      if (depth > 5) return reject(new Error('too many redirects'));
      var mod = url.indexOf('https:') === 0 ? require('https') : require('http');
      var req = mod.get(url, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          var next = res.headers.location;
          if (next.indexOf('http') !== 0) {
            var u = require('url'); next = u.resolve(url, next);
          }
          _nodeFetch(next, depth + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('http ' + res.statusCode)); }
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var b = Buffer.concat(chunks);
          resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, function () { req.destroy(new Error('timeout')); });
    });
  }

  function _decodePeaks(url) {
    // DESKTOP: Chromium's native Web Audio decodeAudioData crashes the renderer
    // (access violation 0xC0000005) from a file:// origin — both AudioContext
    // and OfflineAudioContext. So when the Electron bridge is present we compute
    // peaks in the main process via FFmpeg instead. Falls back to Web Audio
    // (OfflineAudioContext) only outside Electron.
    if (typeof window !== 'undefined' && window.kolboDesktop && typeof window.kolboDesktop.synciWaveformPeaks === 'function') {
      return _acquire().then(function () {
        return window.kolboDesktop.synciWaveformPeaks(url, NUM_PEAKS).then(function (res) {
          _release();
          if (res && res.success && res.peaks && res.peaks.length) {
            return { peaks: res.peaks, duration: res.duration };
          }
          throw new Error((res && res.error) || 'peaks failed');
        }, function (err) { _release(); throw err; });
      });
    }
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error('no OfflineAudioContext'));
    return _acquire().then(function () {
      // Minimal context — only used to host decodeAudioData. The decoded buffer
      // keeps the file's own sample rate regardless of these args.
      var ctx = new OAC(1, 1, 44100);
      return _fetchArrayBuffer(url)
        .then(function (buf) {
          return new Promise(function (resolve, reject) {
            // Callback form is the most compatible across Chromium builds.
            ctx.decodeAudioData(buf, resolve, reject);
          });
        })
        .then(function (audioBuf) {
          var data = audioBuf.getChannelData(0);
          var block = Math.max(1, Math.floor(data.length / NUM_PEAKS));
          var peaks = new Array(NUM_PEAKS), max = 0;
          for (var i = 0; i < NUM_PEAKS; i++) {
            var start = i * block, end = Math.min(start + block, data.length), sum = 0;
            for (var j = start; j < end; j++) { var v = data[j]; sum += v * v; }
            var rms = Math.sqrt(sum / Math.max(1, end - start));
            peaks[i] = rms; if (rms > max) max = rms;
          }
          if (max > 0) for (var k = 0; k < NUM_PEAKS; k++) peaks[k] = peaks[k] / max;
          return { peaks: peaks, duration: audioBuf.duration };
        })
        .then(function (res) { _release(); return res; },
              function (err) { _release(); throw err; });
    });
  }

  function _loadPeaks(url) {
    var key = _hash(url);
    var m = _memGet(key);
    if (m) return Promise.resolve(m);
    return _idbGet(key).then(function (hit) {
      if (hit && hit.peaks && hit.peaks.length) { _memPut(key, hit); return hit; }
      return _decodePeaks(url).then(function (res) {
        _memPut(key, res); _idbPut(key, res); return res;
      });
    });
  }

  // ── Skeleton (deterministic pseudo-waveform, kolbo-map formula) ────────────
  function _skBar(i, n) {
    var a = Math.abs(Math.sin(i * 0.45));
    var b = Math.abs(Math.sin(i * 0.13 + 1.7));
    var noise = ((i * 928371 + 12345) % 1000) / 1000;
    var env = 0.55 + 0.45 * Math.sin((i / n) * Math.PI);
    return Math.min(1, Math.max(0.1, (0.45 * a + 0.3 * b + 0.25 * noise) * env + 0.1));
  }

  // Average the 400 decoded peaks down into `n` display buckets.
  function _resample(peaks, n) {
    if (peaks.length === n) return peaks;
    var out = new Array(n), step = peaks.length / n;
    for (var i = 0; i < n; i++) {
      var s = Math.floor(i * step), e = Math.floor((i + 1) * step), sum = 0, c = 0;
      for (var j = s; j < e && j < peaks.length; j++) { sum += peaks[j]; c++; }
      out[i] = c ? sum / c : 0;
    }
    return out;
  }

  function _roundRect(c, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ── Component ─────────────────────────────────────────────────────────────
  function create(opts) {
    var canvas = opts.canvas, audio = opts.audio;
    var url = opts.url || (audio && audio.currentSrc) || (audio && audio.getAttribute('src'));
    var waveColor = opts.waveColor || 'rgba(255,255,255,0.24)';
    var progressColor = opts.progressColor || '#ffffff';
    if (!canvas || !audio) return { destroy: function () {} };

    var peaks = null, destroyed = false, raf = null, io = null, ro = null;
    // When set (0..1), progress is driven externally (e.g. a row waveform
    // mirroring the now-playing dock) instead of from this element's <audio>.
    var progressOverride = null;
    var dpr = window.devicePixelRatio || 1;
    var pendingSeek = null;   // pct to apply once duration is known (preload="none")

    function _cssW() { return canvas.clientWidth || canvas.offsetWidth || 120; }
    function _cssH() { return canvas.clientHeight || 32; }
    function _size() {
      canvas.width = Math.max(1, Math.round(_cssW() * dpr));
      canvas.height = Math.max(1, Math.round(_cssH() * dpr));
    }
    function _progress() {
      if (progressOverride != null) return progressOverride;
      return (audio && audio.duration) ? (audio.currentTime / audio.duration) : 0;
    }

    function _draw() {
      if (destroyed) return;
      var c = canvas.getContext('2d');
      if (!c) return;
      var W = canvas.width, H = canvas.height;
      c.clearRect(0, 0, W, H);
      // ~1 bar per 3 CSS px keeps it crisp at any width (24–400 bars).
      var n = Math.max(24, Math.min(400, Math.floor(_cssW() / 3)));
      var vals = peaks ? _resample(peaks, n) : null;
      var slot = W / n;
      var barW = Math.max(dpr, slot * 0.62);
      var radius = Math.min(barW / 2, 1.5 * dpr);
      var prog = _progress();
      var progX = prog * W;
      for (var i = 0; i < n; i++) {
        var v = vals ? vals[i] : _skBar(i, n);
        var bh = Math.max(dpr, v * H);
        var x = i * slot + (slot - barW) / 2;
        var y = (H - bh) / 2;
        c.fillStyle = (x + barW / 2 < progX) ? progressColor : waveColor;
        _roundRect(c, x, y, barW, bh, radius);
        c.fill();
      }
    }

    function _loop() {
      if (destroyed) return;
      _draw();
      raf = (audio && !audio.paused) ? requestAnimationFrame(_loop) : null;
    }
    function _startLoop() { if (!raf) _loop(); }

    // Fully buffer the audio (preload="auto") so the browser seeks from real decoded
    // data instead of ESTIMATING the position from byte offsets — that estimation is
    // what makes click-to-seek land slightly behind on compressed (MP3) audio.
    function _prefetchMeta() {
      try {
        if (audio.preload !== 'auto') audio.preload = 'auto';
        if (audio.readyState === 0) audio.load();
      } catch (e) {}
    }
    function _applyPendingSeek() {
      if (pendingSeek != null && audio.duration) {
        audio.currentTime = pendingSeek * audio.duration;
        pendingSeek = null;
        _draw();
      }
    }
    function _seek(e) {
      if (!audio) return;
      var r = canvas.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      // Preview-only waveforms (the row list) don't drive their own <audio> —
      // they just report the clicked position to the host, which plays it in the
      // dock. Skipping the prefetch/seek avoids loading every row's audio.
      if (!opts.noAudioPrefetch) {
        _prefetchMeta(); // buffer fully so this (and subsequent) seeks are accurate
        if (audio.duration) {
          audio.currentTime = pct * audio.duration; _draw();
        } else {
          // Duration not known yet: remember the spot and apply on metadata.
          pendingSeek = pct;
          audio.addEventListener('loadedmetadata', _applyPendingSeek, { once: true });
        }
      }
      if (opts.onActivate) { try { opts.onActivate(pct); } catch (e2) {} }
    }

    // initial paint (skeleton)
    _size();
    _draw();

    // lazy real-peak decode when on/near screen
    function _kick() {
      if (peaks || destroyed || !url) return;
      _loadPeaks(url).then(function (res) {
        if (destroyed) return;
        peaks = res.peaks;
        _draw();
      }).catch(function () { /* keep skeleton */ });
    }
    if (window.IntersectionObserver) {
      io = new IntersectionObserver(function (ents) {
        if (ents.some(function (e) { return e.isIntersecting; })) { io.disconnect(); io = null; _kick(); }
      }, { rootMargin: '300px 0px' });
      io.observe(canvas);
    } else { _kick(); }

    // keep crisp on layout/resize changes
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () { _size(); _draw(); });
      ro.observe(canvas);
    }

    var onTime = function () { _draw(); };
    var onPlay = function () { _startLoop(); };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('seeked', onTime);
    audio.addEventListener('play', onPlay);
    // When noInteract is set the host owns all pointer interaction (e.g. the
    // Synci dock handles click-to-seek AND drag-to-select-in/out itself).
    var onHover = function () { if (!opts.noAudioPrefetch) _prefetchMeta(); _kick(); };
    if (!opts.noInteract) {
      canvas.addEventListener('click', _seek);
      canvas.addEventListener('mouseenter', onHover);
    }

    return {
      redraw: _draw,
      // Drive progress externally (0..1), or pass null to revert to the <audio>.
      setProgress: function (p) {
        progressOverride = (p == null) ? null : Math.max(0, Math.min(1, p));
        _draw();
      },
      destroy: function () {
        destroyed = true;
        if (raf) cancelAnimationFrame(raf);
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        audio.removeEventListener('timeupdate', onTime);
        audio.removeEventListener('seeked', onTime);
        audio.removeEventListener('play', onPlay);
        canvas.removeEventListener('click', _seek);
        canvas.removeEventListener('mouseenter', onHover);
      }
    };
  }

  return { create: create };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KolboWaveform;
}

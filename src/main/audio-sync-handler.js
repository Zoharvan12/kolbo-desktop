// Kolbo Studio - Audio Sync (PluralEyes-style)
// Finds the time offset between recordings of the same event by cross-correlating
// their audio envelopes. Pure Node — no Electron dependency so it also runs from scripts/.

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const ENV_RATE = 200;        // envelope samples per second (5 ms resolution)
const DECODE_RATE = 8000;    // ffmpeg output sample rate
const BLOCK = DECODE_RATE / ENV_RATE;
const HP_WINDOW = ENV_RATE / 2;   // 0.5 s moving average removed (high-pass)
const MIN_CONFIDENCE = 8;         // z-score of the correlation peak
const DRIFT_SEG_SEC = 300;        // first/last segment length for drift estimate
const DRIFT_SEARCH_SEC = 2;

function resolveFfmpeg() {
  if (process.env.KOLBO_FFMPEG) return process.env.KOLBO_FFMPEG;
  let p = require('@ffmpeg-installer/ffmpeg').path;
  if (p.includes('app.asar')) p = p.replace('app.asar', 'app.asar.unpacked');
  return p;
}

// ---------- decode → envelope ----------

/** Probe via `ffmpeg -i` stderr (no ffprobe is bundled with @ffmpeg-installer). */
function probe(ffmpegPath, file) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-i', file]);
    let out = '';
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
      if (!dur) return resolve(null);
      const v = /Stream #\d+:\d+.*?: Video: .*?(\d{2,5})x(\d{2,5}).*?(?:,\s*([\d.]+) fps)?/.exec(out);
      const a = /Stream #\d+:\d+.*?: Audio: .*?(\d+) Hz,\s*([^,]+)/.exec(out);
      const chanWord = a ? a[2].trim() : '';
      const channels = !a ? 0 : chanWord === 'mono' ? 1 : chanWord === 'stereo' ? 2 : (parseInt(chanWord, 10) || 2);
      resolve({
        duration: (+dur[1]) * 3600 + (+dur[2]) * 60 + (+dur[3]),
        hasVideo: !!v, hasAudio: !!a, fps: v && v[3] ? parseFloat(v[3]) : null,
        width: v ? +v[1] : 0, height: v ? +v[2] : 0,
        sampleRate: a ? +a[1] : 0, channels,
      });
    });
  });
}

/** Stream-decode a file to a 200 Hz log-RMS envelope (Float64Array). */
function decodeEnvelope(ffmpegPath, file) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-vn', '-i', file, '-ac', '1', '-ar', String(DECODE_RATE), '-f', 'f32le', 'pipe:1'];
    const p = spawn(ffmpegPath, args);
    const env = [];
    let carry = Buffer.alloc(0);
    p.stdout.on('data', (chunk) => {
      let buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const blockBytes = BLOCK * 4;
      const nBlocks = Math.floor(buf.length / blockBytes);
      for (let b = 0; b < nBlocks; b++) {
        let sum = 0;
        const base = b * blockBytes;
        for (let i = 0; i < BLOCK; i++) { const s = buf.readFloatLE(base + i * 4); sum += s * s; }
        env.push(Math.log(1e-4 + Math.sqrt(sum / BLOCK)));
      }
      carry = buf.subarray(nBlocks * blockBytes);
    });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (!env.length) return reject(new Error(err.trim() || `ffmpeg exited ${code} with no audio`));
      resolve(whiten(Float64Array.from(env)));
    });
  });
}

/** Remove slow level changes and normalize to zero-mean / unit-variance. */
function whiten(env) {
  const n = env.length, out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += env[i];
    if (i >= HP_WINDOW) acc -= env[i - HP_WINDOW];
    out[i] = env[i] - acc / Math.min(i + 1, HP_WINDOW);
  }
  let mean = 0; for (let i = 0; i < n; i++) mean += out[i]; mean /= n;
  let v = 0; for (let i = 0; i < n; i++) { out[i] -= mean; v += out[i] * out[i]; }
  const sd = Math.sqrt(v / n) || 1;
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

// ---------- FFT cross-correlation ----------

function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/**
 * corr[k] = Σ a[n+k]·b[n]. Returns the lag k (may be negative) at which b starts
 * relative to a, plus a z-score confidence.
 */
function correlate(a, b) {
  const N = a.length, M = b.length;
  let P = 1; while (P < N + M - 1) P <<= 1;
  const ar = new Float64Array(P), ai = new Float64Array(P), br = new Float64Array(P), bi = new Float64Array(P);
  ar.set(a); br.set(b);
  fft(ar, ai, false); fft(br, bi, false);
  for (let i = 0; i < P; i++) { // A · conj(B)
    const r = ar[i] * br[i] + ai[i] * bi[i], im = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = r; ai[i] = im;
  }
  fft(ar, ai, true);
  // valid lags: -(M-1) .. N-1 ; negative lag k lives at index P+k
  let best = -Infinity, bestLag = 0, sum = 0, sumSq = 0, count = 0;
  const visit = (idx, lag) => {
    const v = ar[idx]; sum += v; sumSq += v * v; count++;
    if (v > best) { best = v; bestLag = lag; }
  };
  for (let k = 0; k < N; k++) visit(k, k);
  for (let k = 1; k < M; k++) visit(P - k, -k);
  const mean = sum / count, sd = Math.sqrt(Math.max(sumSq / count - mean * mean, 1e-12));
  return { lag: bestLag, confidence: (best - mean) / sd };
}

/** Correlate a slice of b against the matching region of a (±search) to refine a local offset. */
function localLag(a, b, bStart, len, expectedLagIdx, searchIdx) {
  const aStart = expectedLagIdx + bStart - searchIdx;
  const aEnd = aStart + len + 2 * searchIdx;
  if (aStart < 0 || aEnd > a.length || bStart + len > b.length) return null;
  const r = correlate(a.subarray(aStart, aEnd), b.subarray(bStart, bStart + len));
  return { lag: r.lag - searchIdx + expectedLagIdx, confidence: r.confidence };
}

// ---------- orchestration ----------

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

/**
 * @param {string[]} files
 * @param {{ ffmpegPath?: string, onProgress?: (msg:string)=>void }} opts
 * @returns {Promise<{ reference: string, items: Array<{file, info, offset, confidence, synced, drift, error}> }>}
 */
async function analyze(files, opts = {}) {
  const ffmpegPath = opts.ffmpegPath || resolveFfmpeg();
  const progress = opts.onProgress || (() => {});
  const items = await mapLimit(files, os.cpus().length, async (file) => {
    const item = { file, info: null, env: null, offset: null, confidence: 0, synced: false, drift: null, error: null };
    item.info = await probe(ffmpegPath, file);
    if (!item.info) { item.error = 'probe failed'; return item; }
    if (!item.info.hasAudio) { item.error = 'no audio stream'; return item; }
    try { item.env = await decodeEnvelope(ffmpegPath, file); progress(`decoded ${path.basename(file)}`); }
    catch (e) { item.error = e.message; }
    return item;
  });

  const usable = items.filter((i) => i.env);
  if (!usable.length) return { reference: null, items: items.map(strip) };
  const ref = usable.reduce((a, b) => (b.env.length > a.env.length ? b : a));
  ref.offset = 0; ref.confidence = Infinity; ref.synced = true;
  const placed = [ref];

  // ponytail: O(n²) worst case when chaining; fine for a folder of clips, revisit past ~100 files.
  for (const it of usable) {
    if (it === ref) continue;
    let best = null;
    for (const anchor of placed.slice().sort((x, y) => y.confidence - x.confidence)) {
      const r = correlate(anchor.env, it.env);
      const cand = { offset: anchor.offset + r.lag / ENV_RATE, confidence: r.confidence, anchor };
      if (!best || cand.confidence > best.confidence) best = cand;
      if (cand.confidence >= MIN_CONFIDENCE) break;
    }
    it.offset = best.offset; it.confidence = best.confidence;
    it.synced = best.confidence >= MIN_CONFIDENCE;
    progress(`${path.basename(it.file)} → ${it.synced ? 'synced' : 'UNSYNCED'} (z=${best.confidence.toFixed(1)})`);
    if (it.synced) { placed.push(it); it.drift = estimateDrift(best.anchor, it, best.offset - best.anchor.offset); }
  }
  return { reference: ref.file, items: items.map(strip) };
}

function estimateDrift(anchor, it, relOffset) {
  const seg = DRIFT_SEG_SEC * ENV_RATE, search = DRIFT_SEARCH_SEC * ENV_RATE;
  const lagIdx = Math.round(relOffset * ENV_RATE);
  // region of `it` that overlaps the anchor, with a search margin on both ends
  const ovStart = Math.max(0, -lagIdx) + search;
  const ovEnd = Math.min(it.env.length, anchor.env.length - lagIdx) - search;
  if (ovEnd - ovStart < seg * 2.5) return null;
  const first = localLag(anchor.env, it.env, ovStart, seg, lagIdx, search);
  const lastStart = ovEnd - seg;
  const last = localLag(anchor.env, it.env, lastStart, seg, lagIdx, search);
  if (!first || !last || first.confidence < MIN_CONFIDENCE || last.confidence < MIN_CONFIDENCE) return null;
  const driftSec = (last.lag - first.lag) / ENV_RATE;
  const spanSec = (lastStart - ovStart) / ENV_RATE;
  return { seconds: driftSec, ppm: (driftSec / spanSec) * 1e6, spanSec };
}

function strip(it) { const { env, ...rest } = it; return rest; }

// ---------- self-check ----------

function selfCheck() {
  const assert = require('assert');
  const n = 60 * ENV_RATE, shift = 1234; // 60 s of noise, b starts 6.17 s after a
  const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = Math.random() - 0.5;
  const b = a.subarray(shift, shift + 20 * ENV_RATE);
  const r = correlate(whiten(a), whiten(Float64Array.from(b)));
  assert.strictEqual(r.lag, shift, `lag ${r.lag} != ${shift}`);
  assert.ok(r.confidence > MIN_CONFIDENCE, `confidence ${r.confidence}`);
  const r2 = correlate(whiten(Float64Array.from(b)), whiten(a)); // negative lag
  assert.strictEqual(r2.lag, -shift);
  console.log(`selfcheck ok (lag=${r.lag}, z=${r.confidence.toFixed(1)})`);
}

if (require.main === module && process.argv.includes('--selfcheck')) selfCheck();

module.exports = { analyze, correlate, whiten, ENV_RATE, MIN_CONFIDENCE, resolveFfmpeg };

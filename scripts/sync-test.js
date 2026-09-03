#!/usr/bin/env node
// Audio Sync engine CLI: node scripts/sync-test.js [--out file.xml] <files or folders...>
const fs = require('fs');
const path = require('path');
const { analyze } = require('../src/main/audio-sync-handler');
const { buildXmeml } = require('../src/main/timeline-xml');

const MEDIA = /\.(mp4|mov|mxf|mkv|avi|m4v|wav|mp3|aac|m4a|flac|aif|aiff)$/i;
const argv = process.argv.slice(2);
let out = null;
const inputs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') out = argv[++i];
  else inputs.push(argv[i]);
}
const files = inputs.flatMap((p) => fs.statSync(p).isDirectory()
  ? fs.readdirSync(p).filter((f) => MEDIA.test(f)).map((f) => path.join(p, f))
  : [p]);
if (!files.length) { console.error('no media files'); process.exit(1); }

(async () => {
  const t0 = Date.now();
  const res = await analyze(files, { onProgress: (m) => console.log('  ' + m) });
  console.log(`\nreference: ${path.basename(res.reference || '-')}\n`);
  for (const it of res.items) {
    const off = it.offset == null ? '-' : `${it.offset.toFixed(3)}s`;
    const drift = it.drift ? ` drift=${it.drift.seconds.toFixed(3)}s over ${Math.round(it.drift.spanSec)}s (${it.drift.ppm.toFixed(0)} ppm)` : '';
    console.log(`${it.synced ? 'OK  ' : 'FAIL'} ${path.basename(it.file).padEnd(16)} offset=${off.padStart(10)} z=${it.confidence === Infinity ? 'ref' : it.confidence.toFixed(1)}${drift}${it.error ? ' error=' + it.error : ''}`);
  }
  const xml = buildXmeml({ name: 'Kolbo Sync', items: res.items });
  const outPath = out || path.join(path.dirname(files[0]), 'kolbo-synced.xml');
  fs.writeFileSync(outPath, xml);
  console.log(`\nwrote ${outPath}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
})();

// Self-check for the "downloads come out as separate audio + video files" bug class.
//
// Covers the whole chain that has to hold for ANY platform (YouTube, LinkedIn, Instagram,
// Facebook, ...) whose formats arrive as separate video-only + audio-only streams:
//   1. ffmpeg resolves to a real, runnable, non-asar binary — otherwise yt-dlp silently
//      refuses to merge and leaves .fNNN halves behind.
//   2. findOutputFile never passes a .fNNN per-format stream off as the finished file.
//   3. yt-dlp's own --print-to-file report is preferred over guessing by folder scan.
//   4. mergeLeftoverStreams actually recovers a stranded pair, on real media.
//   5. cleanupTempFiles removes the crumbs but never the finished file.
//
// Run: node scripts/test-ytdlp-output.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const YtdlpHandler = require('../src/main/ytdlp-handler.js');
const { getFfmpegPath, verifyFfmpeg } = require('../src/main/ffmpeg-path.js');

// Exercise the methods without booting Electron (the constructor reaches for app.getPath).
const h = Object.create(YtdlpHandler.prototype);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kolbo-ytdlp-test-'));
const cleanupDirs = [tmp];

function makeDir(name) {
  const d = path.join(tmp, name);
  fs.mkdirSync(d);
  return d;
}

function ffmpeg(args, label) {
  const r = spawnSync(getFfmpegPath(), args, { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `${label} failed: ${String(r.stderr).slice(-400)}`);
}

async function main() {
  // ── 1. ffmpeg must be real and runnable ─────────────────────────────────────
  const ff = getFfmpegPath();
  assert.ok(ff && fs.existsSync(ff), 'ffmpeg not resolved: ' + ff);
  assert.ok(!/app\.asar[\\/]/.test(ff), 'ffmpeg path is inside asar (not executable): ' + ff);
  const verdict = await verifyFfmpeg();
  assert.ok(verdict.ok, 'ffmpeg is not runnable: ' + verdict.error);
  assert.strictEqual(h.getFfmpegPath(), ff, 'ytdlp-handler must use the shared resolver');

  // ── 2. a per-format stream is never the finished file ───────────────────────
  {
    const d = makeDir('unmerged');
    const base = 'Some Video';
    fs.writeFileSync(path.join(d, base + '.f299.mp4'), 'x'.repeat(9000));
    fs.writeFileSync(path.join(d, base + '.f140.m4a'), 'x'.repeat(9000));

    const guessed = h.findOutputFile(d, base, 'mp4');
    assert.ok(!/\.f\d+\./.test(path.basename(guessed)), 'leaked a per-format stream: ' + guessed);
    assert.ok(!h.validateOutputFile(guessed), 'unmerged download must not validate as done');

    fs.writeFileSync(path.join(d, base + '.mp4'), 'x'.repeat(9000));
    assert.strictEqual(h.findOutputFile(d, base, 'mp4'), path.join(d, base + '.mp4'));
  }

  // ── 3. yt-dlp's printed path wins over the folder scan ──────────────────────
  {
    const d = makeDir('manifest');
    const real = path.join(d, 'Actual Name.mp4');
    fs.writeFileSync(real, 'x'.repeat(9000));
    const manifest = path.join(d, 'out.path');

    fs.writeFileSync(manifest, real + '\n');
    assert.strictEqual(h.readFinalPathManifest(manifest), real);

    // A path yt-dlp printed but that no longer exists must not be trusted.
    fs.writeFileSync(manifest, path.join(d, 'gone.mp4') + '\n');
    assert.strictEqual(h.readFinalPathManifest(manifest), null);
    assert.strictEqual(h.readFinalPathManifest(path.join(d, 'nope.path')), null);
  }

  // ── 4. a stranded pair really does get merged (real media, not fixtures) ────
  {
    const d = makeDir('merge');
    const base = 'Stranded Clip';
    const videoOnly = path.join(d, base + '.f299.mp4');
    const audioOnly = path.join(d, base + '.f140.m4a');

    ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc=size=320x240:rate=15:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      videoOnly], 'video fixture');
    ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', audioOnly], 'audio fixture');

    assert.deepStrictEqual(await h.probeStreams(videoOnly), { video: true, audio: false });
    assert.deepStrictEqual(await h.probeStreams(audioOnly), { video: false, audio: true });

    const merged = await h.mergeLeftoverStreams(d, base, 'mp4', null);
    assert.strictEqual(merged, path.join(d, base + '.mp4'), 'merge did not produce the expected file');
    assert.ok(h.validateOutputFile(merged), 'merged file failed validation');
    assert.deepStrictEqual(await h.probeStreams(merged), { video: true, audio: true },
      'merged file must carry BOTH streams');

    // mp3 requests want the audio half handed straight to the converter.
    assert.strictEqual(await h.mergeLeftoverStreams(d, base, 'mp3', null), audioOnly);

    // ── 5. cleanup takes the crumbs, keeps the result ─────────────────────────
    fs.writeFileSync(path.join(d, base + '.meta'), ';FFMETADATA1\n');
    fs.writeFileSync(path.join(d, base + '.mp4.part'), 'x');
    h.cleanupTempFiles(d, base, merged);

    const left = fs.readdirSync(d);
    assert.deepStrictEqual(left, [base + '.mp4'], 'cleanup left the wrong files: ' + left.join(', '));
    assert.ok(fs.existsSync(merged), 'cleanup deleted the finished file');
  }

  // ── 6. no real title? still find and clean the streams by shape ─────────────
  {
    const d = makeDir('untitled');
    fs.writeFileSync(path.join(d, 'Whatever.f251.webm'), 'x'.repeat(9000));
    const group = h.findStreamGroup(d, '%(title)s');
    assert.ok(group && group.base === 'Whatever', 'template title must not defeat stream lookup');
  }


  // Named DASH formats, as seen in the user's Instagram downloads.
  {
    const d = makeDir('dash');
    const base = 'Video by alex';
    fs.writeFileSync(path.join(d, base + '.fdash-123v.mp4'), 'x'.repeat(9000));
    fs.writeFileSync(path.join(d, base + '.fdash-456a.m4a'), 'x'.repeat(9000));
    assert.ok(!h.validateOutputFile(h.findOutputFile(d, base, 'mp4')));
    assert.strictEqual(h.findStreamGroup(d, base).files.length, 2);
    const manifest = path.join(d, 'reported.path');
    fs.writeFileSync(manifest, path.join(d, base + '.fdash-123v.mp4'));
    assert.strictEqual(h.readFinalPathManifest(manifest), null);
    h.cleanupTempFiles(d, base);
    assert.deepStrictEqual(fs.readdirSync(d), ['reported.path']);
  }

  // Exercise complete attempt finalization, including concurrent equal titles.
  {
    const { EventEmitter } = require('events');
    const d = makeDir('attempts');
    const video = path.join(tmp, 'source-video.mp4');
    const audio = path.join(tmp, 'source-audio.m4a');
    ffmpeg(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=15:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], 'attempt video');
    ffmpeg(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', audio], 'attempt audio');
    h.activeDownloads = new Map();
    h.getJsRuntimeArgs = () => [];
    h.ytdlp = { exec(args) {
      const events = new EventEmitter();
      setImmediate(() => {
        const template = args[args.indexOf('-o') + 1].replace('%(title)s', 'Resolved title');
        const stem = template.replace('.%(ext)s', '');
        fs.copyFileSync(video, stem + '.fdash-123v.mp4');
        fs.copyFileSync(audio, stem + '.fdash-456a.m4a');
        const manifest = args[args.indexOf('--print-to-file') + 2];
        fs.writeFileSync(manifest, stem + '.fdash-123v.mp4');
        events.emit('close');
      });
      return events;
    }};
    const unrelated = path.join(d, 'Other.f140.m4a');
    fs.copyFileSync(audio, unrelated);
    const results = await Promise.all([1,2].map(id => h._runDownloadAttempt({ id: 'test-'+id, url: 'https://example.com/video', title: 'Same title', outputFolder:d, outputFormat:'mp4',quality:'1080' })));
    assert.notStrictEqual(results[0],results[1], 'concurrent downloads must not overwrite');
    for(const result of results) assert.deepStrictEqual(await h.probeStreams(result),{video:true,audio:true});
    assert.ok(fs.existsSync(unrelated),'cleanup touched unrelated download');
    assert.strictEqual(fs.readdirSync(d).length,3,'staging files leaked after success');
    const untitled = await h._runDownloadAttempt({id:'untitled',url:'https://example.com/video',outputFolder:d,outputFormat:'mp4',quality:'1080'});
    assert.strictEqual(path.basename(untitled),'Resolved title.mp4');
    assert.deepStrictEqual(await h.probeStreams(untitled),{video:true,audio:true});

    // An unusable merger must fail visibly and preserve the bytes for recovery.
    const oldResolver=h.getFfmpegPath;
    h.getFfmpegPath=()=>null;
    await assert.rejects(h._runDownloadAttempt({id:'no-ffmpeg',url:'https://example.com/video',title:'Keep me',outputFolder:d,outputFormat:'mp4',quality:'1080'}),e=>/could not merge/.test(e.message));
    h.getFfmpegPath=oldResolver;
    const failed=fs.readdirSync(d).find(x=>x.startsWith('.kolbo-download-'));
    assert.ok(failed);
    assert.strictEqual(fs.readdirSync(path.join(d,failed)).length,2,'failed merge discarded streams');

  }

  cleanupDirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  console.log('OK — 8 check groups passed. ffmpeg', verdict.version, 'at', ff);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

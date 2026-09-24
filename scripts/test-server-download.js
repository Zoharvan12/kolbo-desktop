'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServerDownloader } = require('../src/main/server-download');
const Handler = require('../src/main/ytdlp-handler');
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('server recovery submits once, polls, streams file, preserves existing names and keeps auth off CDN', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kolbo-recovery-test-'));
  const calls = [];
  fs.writeFileSync(path.join(folder, 'Clip.mp4'), 'existing');
  let polls = 0;
  const download = createServerDownloader({ apiUrl: 'https://api.kolbo.ai/api', getToken: () => 'test-token', pollMs: 1,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') return json({ jobId: 'fixture-job' });
      if (url.endsWith('/progress')) return json(++polls === 1 ? { status: 'processing' } : { status: 'completed', resultUrl: 'https://media.kolbo.ai/clip.mp4' });
      return new Response('video bytes', { headers: { 'content-length': '11' } });
    } });
  const result = await download({ url: 'https://youtube.com/watch?v=fixture', title: 'Clip', quality: '1080p', outputFormat: 'mp4', outputFolder: folder });
  assert.equal(path.basename(result), 'Clip (1).mp4');
  assert.equal(fs.readFileSync(result, 'utf8'), 'video bytes');
  assert.equal(fs.readFileSync(path.join(folder, 'Clip.mp4'), 'utf8'), 'existing');
  assert.equal(calls.filter(x => x.options.method === 'POST').length, 1);
  assert.equal(calls.at(-1).options.headers, undefined);
  assert.deepEqual(fs.readdirSync(folder).sort(), ['Clip (1).mp4', 'Clip.mp4']);
  for (const name of fs.readdirSync(folder)) fs.unlinkSync(path.join(folder, name));
  fs.rmdirSync(folder);
});

test('cancellation cancels the server job without retrying submission', async () => {
  const controller = new AbortController();
  const calls = [];
  const download = createServerDownloader({ apiUrl: 'https://api.kolbo.ai/api', getToken: () => 'test-token', pollMs: 1,
    fetchImpl: async (url, options) => {
      calls.push(options.method);
      if (options.method === 'POST') return json({ jobId: 'fixture-job' });
      if (options.method === 'DELETE') return json({ success: true });
      controller.abort(); return json({ status: 'processing' });
    } });
  await assert.rejects(download({ url: 'https://youtube.com/watch?v=fixture' }, { signal: controller.signal }), /abort/i);
  assert.deepEqual(calls, ['POST', 'GET', 'DELETE']);
});

test('reject untrusted result URL and missing login before saving', async () => {
  const download = createServerDownloader({ apiUrl: 'https://api.kolbo.ai/api', getToken: () => 'token',
    fetchImpl: async (url, options) => json(options.method === 'POST' ? { jobId: 'job' } : { status: 'completed', resultUrl: 'https://evil.example/clip.mp4' }) });
  await assert.rejects(download({ url: 'https://youtube.com/watch?v=fixture' }), /Invalid server download result/);
  const anonymous = createServerDownloader({ apiUrl: '', getToken: () => null, fetchImpl: () => assert.fail('must not fetch') });
  await assert.rejects(anonymous({}), /Sign in/);
});

test('download ladder falls back once, emits complete only on success, and skips cancelled jobs', async () => {
  const h = Object.create(Handler.prototype);
  Object.assign(h, { initialized: true, ytdlp: {}, activeDownloads: new Map(), isDirectMediaUrl: () => false,
    detectPlatform: () => 'generic', buildAttempts: () => [{ label: 'default', args: [] }],
    isExtractionFailure: () => false, isCookieInfraFailure: () => false, isPermanentlyUnavailable: () => false,
    _runDownloadAttempt: async () => { throw new Error('Cannot merge'); },
  });
  const events = [];
  h.mainWindow = { isDestroyed: () => false, webContents: { send: (...args) => events.push(args) } };
  let calls = 0;
  h.serverFallback = async () => { calls++; return 'recovered.mp4'; };
  assert.equal(await h.downloadMedia({ id: 'x', url: 'https://example.com/page' }), 'recovered.mp4');
  assert.equal(calls, 1);
  assert.equal(events.filter(x => x[0] === 'dl:complete').length, 1);
  h._runDownloadAttempt = async () => { throw { aborted: true }; };
  await assert.rejects(h.downloadMedia({ id: 'cancel', url: 'https://example.com/page' }), e => e.aborted);
  assert.equal(calls, 1);
});

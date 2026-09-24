'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { setTimeout: delay } = require('timers/promises');

const MAX_BYTES = 500 * 1024 * 1024;
const MEDIA_HOSTS = new Set(['media.kolbo.ai', 'media-staging.kolbo.ai', 'media-dev.kolbo.ai',
  'kolboai-production.ams3.digitaloceanspaces.com', 'kolboai-production.ams3.cdn.digitaloceanspaces.com',
  'kolboai-development.ams3.digitaloceanspaces.com', 'kolboai-development.ams3.cdn.digitaloceanspaces.com',
  'kolboai-staging.ams3.digitaloceanspaces.com', 'kolboai-staging.ams3.cdn.digitaloceanspaces.com']);

function createServerDownloader({ apiUrl, getToken, fetchImpl = fetch, pollMs = 2000 }) {
  return async function serverDownload(job, { signal, onProgress = () => {} } = {}) {
    const token = await getToken();
    if (!token) throw new Error('Sign in to use download recovery');
    const deadline = AbortSignal.timeout(12 * 60 * 1000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let jobId, temp;
    const api = async (suffix, method = 'GET', body, requestSignal = combined) => {
      const response = await fetchImpl(`${apiUrl}/utility${suffix}`, {
        method, redirect: 'error', signal: requestSignal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'KolboStudio/Downloader' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Server download recovery failed');
      return data;
    };
    try {
      const quality = String(job.quality || 'best').toLowerCase();
      const height = quality.match(/2160|1440|1080|720|480|360/)?.[0];
      const result = await api('/download', 'POST', {
        url: job.url, quality: quality.includes('4k') ? '2160' : (height || 'best'),
        outputType: job.outputFormat === 'mp3' ? 'audio' : 'video',
      });
      jobId = result.jobId;
      if (typeof jobId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(jobId)) throw new Error('Invalid server download job');
      let finished;
      for (;;) {
        combined.throwIfAborted();
        const state = await api(`/${jobId}/progress`);
        if (state.status === 'completed') { finished = state; break; }
        if (['failed', 'cancelled'].includes(state.status)) throw new Error(state.error || 'Server download failed');
        onProgress({ phase: 'recovering' });
        await delay(pollMs, undefined, { signal: combined });
      }
      const url = new URL(finished.resultUrl || finished.url);
      if (url.protocol !== 'https:' || !MEDIA_HOSTS.has(url.hostname) || url.username || url.password) {
        throw new Error('Invalid server download result URL');
      }
      onProgress({ phase: 'saving' });
      // Never forward account credentials to the media host or follow a redirect.
      const response = await fetchImpl(url.href, { signal: combined, redirect: 'error' });
      if (!response.ok || !response.body) throw new Error('Could not save the recovered download');
      const expected = Number(response.headers.get('content-length') || 0);
      if (expected > MAX_BYTES) throw new Error('Recovered download exceeds the size limit');
      const ext = job.outputFormat === 'mp3' ? 'mp3' : 'mp4';
      const name = String(job.title || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || 'download';
      temp = path.join(job.outputFolder, `.kolbo-recovery-${randomUUID()}.part`);
      let bytes = 0;
      const guard = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(bytes > MAX_BYTES ? new Error('Recovered download exceeds the size limit') : null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), guard, fs.createWriteStream(temp, { flags: 'wx' }), { signal: combined });
      if (!bytes || (expected && bytes !== expected)) throw new Error('Recovered download is incomplete');
      combined.throwIfAborted();
      let output = path.join(job.outputFolder, `${name}.${ext}`);
      for (let suffix = 1;; suffix++) {
        try { await fs.promises.copyFile(temp, output, fs.constants.COPYFILE_EXCL); break; }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          output = path.join(job.outputFolder, `${name} (${suffix}).${ext}`);
        }
      }
      return output;
    } finally {
      if (temp) await fs.promises.unlink(temp).catch(() => {});
      if (combined.aborted && jobId) {
        await api(`/${jobId}`, 'DELETE', undefined, AbortSignal.timeout(5000)).catch(() => {});
      }
    }
  };
}

module.exports = { createServerDownloader };

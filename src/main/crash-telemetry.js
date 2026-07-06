// Crash telemetry — reports renderer/GPU process deaths to PostHog so we can
// see how many users hit crashes in the field (and why: oom vs gpu vs killed).
// Fire-and-forget: must NEVER throw or block app recovery paths.
const https = require('https');
const os = require('os');
const { app } = require('electron');
const Store = require('electron-store');

const POSTHOG_HOST = 'us.i.posthog.com';
const POSTHOG_API_KEY = 'phc_G5PttdlcFZOirehYjJZMFoCMiOgax6uDvunCJ41ATUc';

const store = new Store();

// Stable anonymous id per install so PostHog can count affected users,
// not just raw crash events.
function getDistinctId() {
  let id = store.get('telemetry_anonymous_id');
  if (!id) {
    id = 'desktop-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    store.set('telemetry_anonymous_id', id);
  }
  return id;
}

function baseProperties() {
  return {
    app_version: app.getVersion(),
    electron_version: process.versions.electron,
    chrome_version: process.versions.chrome,
    platform: process.platform,
    os_release: os.release(),
    total_ram_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    free_ram_gb: Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10,
    uptime_min: Math.round(process.uptime() / 60)
  };
}

/**
 * Send an event to PostHog. Swallows every failure silently — telemetry must
 * never affect the app, especially in crash-recovery paths.
 */
function capture(eventName, properties = {}) {
  try {
    const payload = JSON.stringify({
      api_key: POSTHOG_API_KEY,
      event: eventName,
      distinct_id: getDistinctId(),
      properties: { ...baseProperties(), ...properties }
    });

    const req = https.request({
      hostname: POSTHOG_HOST,
      path: '/i/v0/e/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 5000
    });
    req.on('error', () => {});
    req.on('timeout', () => { try { req.destroy(); } catch {} });
    req.write(payload);
    req.end();
  } catch {
    // Never let telemetry break anything.
  }
}

/**
 * Report a dead renderer/GPU process.
 * kind: 'main-window' | 'webapp-iframe' | 'child-process'
 * details: Electron's RenderProcessGoneDetails ({ reason, exitCode })
 */
function reportProcessGone(kind, details, extra = {}) {
  capture('desktop_renderer_crash', {
    crash_kind: kind,
    reason: details?.reason || 'unknown',
    exit_code: details?.exitCode,
    ...extra
  });
}

module.exports = { capture, reportProcessGone };

#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const isolated = args.has('--isolated');
const outputArgIndex = process.argv.indexOf('--output');
const surfaceArgIndex = process.argv.indexOf('--surface');
const requestedSurface = surfaceArgIndex >= 0 ? process.argv[surfaceArgIndex + 1] : null;
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
  ? path.resolve(process.argv[outputArgIndex + 1])
  : path.join(os.tmpdir(), 'kolbo-ui-audit', runId);

const surfaces = [
  ['kolbo-ai', '#webapp-tab', 1800],
  ['my-media', '#media-tab', 800],
  ['stock-library', '#stock-tab', 1200],
  ['stock-library-visual-category-menu', '#stock-tab', 900, '#stock-mediatypes [data-mt="image"]', `(() => {
    const trigger = document.querySelector('#stock-category-select');
    if (!trigger) return { ok: false, reason: 'missing-category-picker' };
    trigger.click();
    return { ok: true };
  })()`],
  ['stock-library-favorites', '#stock-tab', 700, '.stock-tab[data-section="favorites"]'],
  ['stock-library-music', '#stock-tab', 1200, '#stock-mediatypes [data-mt="music"]'],
  ['stock-library-music-filters', '#stock-tab', 700, '#stock-mediatypes [data-mt="music"]', `(() => {
    return new Promise((resolve) => {
      const started = Date.now();
      const openRanges = () => {
        const toggle = document.querySelector('.stock-range-toggle');
        if (toggle) { toggle.click(); resolve({ ok: true }); return; }
        if (Date.now() - started > 6000) { resolve({ ok: false, reason: 'missing-range-toggle' }); return; }
        setTimeout(openRanges, 150);
      };
      openRanges();
    });
  })()`],
  ['stock-library-music-filter-values', '#stock-tab', 700, '#stock-mediatypes [data-mt="music"]', `(() => {
    return new Promise((resolve) => {
      const started = Date.now();
      const updateRanges = () => {
        const toggle = document.querySelector('.stock-range-toggle');
        if (!toggle) {
          if (Date.now() - started > 6000) { resolve({ ok: false, reason: 'missing-range-toggle' }); return; }
          setTimeout(updateRanges, 150);
          return;
        }
        if (!toggle.classList.contains('open')) toggle.click();
        const ranges = [...document.querySelectorAll('.stock-range')];
        if (ranges.length !== 2 && Date.now() - started <= 6000) { setTimeout(updateRanges, 100); return; }
        if (ranges.length !== 2) { resolve({ ok: false, reason: 'missing-dual-ranges' }); return; }
        ranges.forEach((range) => {
          const lo = range.querySelector('.stock-range-lo');
          const hi = range.querySelector('.stock-range-hi');
          const min = Number(lo.min); const max = Number(lo.max); const span = max - min;
          lo.value = String(Math.round(min + span * 0.25));
          hi.value = String(Math.round(min + span * 0.75));
          lo.dispatchEvent(new Event('input', { bubbles: true }));
          hi.dispatchEvent(new Event('input', { bubbles: true }));
        });
        resolve({ ok: true });
      };
      updateRanges();
    });
  })()`],
  ['stock-library-music-scrolled', '#stock-tab', 700, '#stock-mediatypes [data-mt="music"]', `(() => {
    const results = document.querySelector('#stock-results');
    if (!results) return { ok: false, reason: 'missing-results' };
    results.scrollTop = Math.min(260, Math.max(0, results.scrollHeight - results.clientHeight));
    results.dispatchEvent(new Event('scroll'));
    return { ok: true, scrollTop: results.scrollTop };
  })()`],
  ['stock-library-music-returned-top', '#stock-tab', 500, '#stock-mediatypes [data-mt="music"]', `(() => {
    const results = document.querySelector('#stock-results');
    if (!results) return { ok: false, reason: 'missing-results' };
    results.scrollTop = 0;
    results.dispatchEvent(new Event('scroll'));
    return { ok: true, scrollTop: results.scrollTop };
  })()`],
  ['file-bridge', '#file-explorer-tab', 800],
  ['format-factory', '#format-factory-tab', 800],
  ['format-factory-audio', '#format-factory-tab', 400, '.ff-category-btn[data-category="audio"]'],
  ['format-factory-modal', '#format-factory-tab', 300, null, `(() => {
    const manager = window.formatFactoryManager;
    if (!manager?.createFormatSelectionModal) return { ok: false, reason: 'missing-format-manager' };
    manager.createFormatSelectionModal([], { hasVideo: false, hasAudio: false, hasImage: false });
    setTimeout(() => document.querySelector('#ff-format-modal')?.remove(), 1000);
    return { ok: true };
  })()`],
  ['downloader', '#downloader-tab', 800],
  ['quick-tools', '#quick-tools-tab', 800],
  ['quick-tools-extractor', '#quick-tools-tab', 400, '.qt-tool-card[data-tool="extractor"]'],
  ['kolbo-code', '#agent-tab', 800],
  ['settings', '#settings-btn', 800]
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForTarget(port, timeoutMs = 45000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === 'page' && /index\.html/i.test(item.url));
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Electron debugging target did not become ready: ${lastError?.message || 'timeout'}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timed out')), 10000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(event.error || new Error('CDP WebSocket connection failed'));
      }, { once: true });
      socket.addEventListener('message', (event) => this.handleMessage(event));
      socket.addEventListener('close', () => {
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new Error('CDP connection closed'));
        }
        this.pending.clear();
      });
    });
  }

  handleMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    const callbacks = this.listeners.get(message.method) || [];
    for (const callback of callbacks) callback(message.params || {});
  }

  on(method, callback) {
    const callbacks = this.listeners.get(method) || [];
    callbacks.push(callback);
    this.listeners.set(method, callbacks);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text || 'Renderer evaluation failed');
    }
    return response.result?.value;
  }

  close() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
  }
}

const pageAuditExpression = String.raw`(() => {
  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const selector = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      if (node.classList.length) part += '.' + [...node.classList].slice(0, 2).map(CSS.escape).join('.');
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const rgba = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const values = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: values[0], g: values[1], b: values[2], a: values.length > 3 ? values[3] : 1 };
  };
  const luminance = (color) => {
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const contrast = (a, b) => {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const background = (el) => {
    let node = el;
    while (node) {
      const color = rgba(getComputedStyle(node).backgroundColor);
      if (color && color.a >= 0.95) return color;
      node = node.parentElement;
    }
    return rgba(getComputedStyle(document.documentElement).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
  };

  const textElements = [...document.querySelectorAll('body *')].filter((el) => {
    if (!visible(el)) return false;
    return [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  }).slice(0, 2500);
  const lowContrast = [];
  for (const el of textElements) {
    const style = getComputedStyle(el);
    const fg = rgba(style.color);
    const bg = background(el);
    if (!fg || fg.a < 0.95 || !bg) continue;
    const ratio = contrast(fg, bg);
    const size = parseFloat(style.fontSize);
    const weight = parseInt(style.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    if (ratio + 0.05 < required) {
      lowContrast.push({ selector: selector(el), text: el.textContent.trim().slice(0, 100), ratio: Number(ratio.toFixed(2)), required, fontSize: size });
    }
  }

  const smallTargets = [...document.querySelectorAll('button, a, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')]
    .filter((el) => visible(el) && !el.disabled)
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return { selector: selector(el), text: (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 80), width: Math.round(rect.width), height: Math.round(rect.height) };
    })
    .filter((item) => item.width < 32 || item.height < 32)
    .slice(0, 100);

  const bodyText = document.body.innerText || '';
  const rawTranslationKeys = [...new Set(bodyText.match(/\b(?:settings|tabs|header|auth|common|loading|media|quickTools|downloader|formatFactory)(?:\.[A-Za-z][\w-]*){1,4}\b/g) || [])];
  const activeView = document.querySelector('.tab-btn.active')?.dataset.view || (document.querySelector('#settings-view:not(.hidden)') ? 'settings' : null);
  const fileBridgeLayout = (() => {
    const header = document.querySelector('.fe-file-header');
    const row = document.querySelector('.fe-file-item');
    if (!visible(header) || !visible(row)) return null;
    const measure = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { className: el.className, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), display: style.display, flex: style.flex };
    };
    return { header: measure(header), row: measure(row), headerChildren: [...header.children].map(measure), rowChildren: [...row.children].map(measure) };
  })();
  const stockPanel = document.querySelector('#stock-view .stock-panel');
  const stockCollections = document.querySelector('#stock-collections');
  const stockScrollState = visible(document.querySelector('#stock-view')) ? {
    collectionsHidden: !!stockPanel?.classList.contains('stock-collections-hidden'),
    collectionsHeight: stockCollections ? Math.round(stockCollections.getBoundingClientRect().height) : null,
    resultsScrollTop: Math.round(document.querySelector('#stock-results')?.scrollTop || 0),
    rangePanelVisible: visible(document.querySelector('#stock-ranges')),
    genericCategoriesVisible: visible(document.querySelector('#stock-categories')),
    categoryPickerVisible: visible(document.querySelector('#stock-category-select')),
    categoryHorizontalOverflow: (() => {
      const categories = document.querySelector('#stock-categories');
      return categories ? categories.scrollWidth > categories.clientWidth + 1 : false;
    })(),
    categoryMenuVisible: visible(document.querySelector('.kdd-list')),
    projectInsideToolbar: document.querySelector('#stock-project-bar')?.parentElement?.classList.contains('stock-source-toolbar') || false,
    filterToolbarHeight: Math.round(document.querySelector('.stock-filter-toolbar')?.getBoundingClientRect().height || 0),
    rangeValues: [...document.querySelectorAll('.stock-range')].map((range) => ({
      low: range.querySelector('.stock-range-lo')?.value || null,
      high: range.querySelector('.stock-range-hi')?.value || null,
      label: range.querySelector('[data-rv]')?.textContent?.trim() || null,
      rect: (() => { const r = range.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })(),
      display: getComputedStyle(range).display,
      visibility: getComputedStyle(range).visibility,
      opacity: getComputedStyle(range).opacity
    }))
  } : null;
  const workflowState = {
    quickTools: visible(document.querySelector('#quick-tools-view')) ? {
      activeTool: document.querySelector('.qt-tool-card.active')?.dataset.tool || null,
      activeContent: document.querySelector('.qt-tool-content.active')?.dataset.tool || null,
      semanticButtons: [...document.querySelectorAll('.qt-tool-card')].every((el) => el.tagName === 'BUTTON')
    } : null,
    downloader: visible(document.querySelector('#downloader-view')) ? {
      queueEmpty: document.querySelector('.dl-queue-section')?.classList.contains('is-empty') || false,
      queueActionsVisible: visible(document.querySelector('.dl-queue-header-actions'))
    } : null,
    formatFactory: visible(document.querySelector('#format-factory-view')) ? {
      activeCategory: document.querySelector('.ff-category-btn.active')?.dataset.category || null,
      emptyToolbarActionsVisible: visible(document.querySelector('.ff-toolbar-right')),
      disabledFolderActionVisible: visible(document.querySelector('#ff-output-folder-btn:disabled'))
    } : null
  };
  return {
    title: document.title,
    activeView,
    language: document.documentElement.lang || null,
    direction: document.documentElement.dir || getComputedStyle(document.documentElement).direction,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    loginVisible: visible(document.querySelector('#login-screen')),
    mediaVisible: visible(document.querySelector('#media-screen')),
    horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1,
    rawTranslationKeys,
    lowContrast: lowContrast.slice(0, 100),
    smallTargets,
    fileBridgeLayout,
    stockScrollState,
    workflowState
  };
})()`;

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const port = await getFreePort();
  const electronPath = require('electron');
  const startup = [];
  const rendererErrors = [];
  let child;
  let cdp;
  let originalRendererState;

  try {
    child = spawn(electronPath, [
      APP_ROOT,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*'
    ], {
      cwd: APP_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        KOLBO_ENV: process.env.KOLBO_ENV || 'development',
        NODE_ENV: process.env.NODE_ENV || 'development',
        KOLBO_UI_AUDIT: '1',
        KOLBO_UI_AUDIT_ISOLATED: isolated ? '1' : '0'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const rememberStartup = (chunk) => {
      startup.push(String(chunk));
      if (startup.join('').length > 30000) startup.shift();
    };
    child.stdout.on('data', rememberStartup);
    child.stderr.on('data', rememberStartup);

    console.log('Starting hidden Electron audit instance...');
    const target = await waitForTarget(port);
    console.log('Connected to the hidden renderer target.');
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      rendererErrors.push({ type: 'exception', text: exceptionDetails?.text || 'Unknown renderer exception' });
    });
    cdp.on('Runtime.consoleAPICalled', ({ type, args: consoleArgs }) => {
      if (!['error', 'warning'].includes(type)) return;
      rendererErrors.push({
        type,
        text: (consoleArgs || []).map((item) => item.value ?? item.description ?? '').join(' ').slice(0, 500)
      });
    });
    await Promise.all([
      cdp.send('Page.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Accessibility.enable'),
      cdp.send('Performance.enable')
    ]);

    await cdp.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const ready = document.readyState === 'complete' && document.querySelector('#login-screen') && document.querySelector('#media-screen');
        if (ready) return resolve(true);
        if (Date.now() - started > 30000) return reject(new Error('Renderer UI did not become ready'));
        setTimeout(check, 100);
      };
      check();
    })`);
    await delay(1200);

    originalRendererState = await cdp.evaluate(`({
      currentView: localStorage.getItem('kolbo_current_view')
    })`);
    const initial = await cdp.evaluate(pageAuditExpression);
    console.log(initial.mediaVisible ? 'Authenticated desktop shell detected.' : 'Sign-in screen detected.');
    const reports = [];
    const availableSurfaces = initial.mediaVisible ? surfaces : [['sign-in', '#login-screen', 300]];
    const requestedSurfaces = requestedSurface
      ? availableSurfaces.filter(([name]) => name === requestedSurface)
      : availableSurfaces;
    if (!requestedSurfaces.length) throw new Error(`Unknown audit surface: ${requestedSurface}`);

    for (const [name, selectorValue, waitMs, stateSelector, afterExpression] of requestedSurfaces) {
      console.log(`Auditing ${name}...`);
      if (name !== 'sign-in') {
        const clickResult = await cdp.evaluate(`(() => {
          const element = document.querySelector(${JSON.stringify(selectorValue)});
          if (!element) return { ok: false, reason: 'missing' };
          element.click();
          return { ok: true };
        })()`);
        if (!clickResult?.ok) {
          reports.push({ surface: name, skipped: true, reason: clickResult?.reason || 'unavailable' });
          continue;
        }
        await delay(waitMs);
        if (stateSelector) {
          const stateResult = await cdp.evaluate(`new Promise((resolve) => {
            const started = Date.now();
            const selectState = () => {
              const element = document.querySelector(${JSON.stringify(stateSelector)});
              if (element) {
                element.click();
                resolve({ ok: true });
                return;
              }
              if (Date.now() - started > 6000) {
                resolve({ ok: false, reason: 'missing-state' });
                return;
              }
              setTimeout(selectState, 150);
            };
            selectState();
          })`);
          if (!stateResult?.ok) {
            reports.push({ surface: name, skipped: true, reason: stateResult?.reason || 'state-unavailable' });
            continue;
          }
          await delay(1400);
        }
        if (afterExpression) {
          const afterResult = await cdp.evaluate(afterExpression);
          if (!afterResult?.ok) {
            reports.push({ surface: name, skipped: true, reason: afterResult?.reason || 'after-state-unavailable' });
            continue;
          }
          await delay(260);
        }
      }

      const audit = await cdp.evaluate(pageAuditExpression);
      const screenshotBase64 = await cdp.evaluate(`window.kolboUiAudit?.capturePage()`);
      if (!screenshotBase64) throw new Error('Hidden Electron screenshot bridge is unavailable');
      const screenshotName = `${String(reports.length + 1).padStart(2, '0')}-${name}.png`;
      fs.writeFileSync(path.join(outputDir, screenshotName), Buffer.from(screenshotBase64, 'base64'));
      reports.push({ surface: name, screenshot: screenshotName, ...audit });
    }

    const accessibility = await cdp.send('Accessibility.getFullAXTree');
    const metricsResponse = await cdp.send('Performance.getMetrics');
    const metrics = Object.fromEntries((metricsResponse.metrics || []).map((metric) => [metric.name, metric.value]));
    const result = {
      generatedAt: new Date().toISOString(),
      mode: isolated ? 'isolated-profile' : 'authenticated-shared-profile',
      backgroundWindow: true,
      surfaces: reports,
      accessibility: {
        nodeCount: accessibility.nodes?.length || 0,
        ignoredNodeCount: accessibility.nodes?.filter((node) => node.ignored).length || 0
      },
      performance: metrics,
      rendererErrors: rendererErrors.slice(0, 200)
    };

    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(outputDir, 'accessibility.json'), JSON.stringify(accessibility, null, 2));

    const markdown = [
      '# Kolbo Studio background UI audit',
      '',
      `Generated: ${result.generatedAt}`,
      `Mode: ${result.mode}`,
      `Renderer errors/warnings: ${result.rendererErrors.length}`,
      `Accessibility nodes: ${result.accessibility.nodeCount}`,
      '',
      '| Surface | Screenshot | Raw i18n keys | Low contrast | Small targets | Overflow |',
      '|---|---|---:|---:|---:|---|',
      ...reports.map((report) => report.skipped
        ? `| ${report.surface} | skipped (${report.reason}) | - | - | - | - |`
        : `| ${report.surface} | ${report.screenshot} | ${report.rawTranslationKeys.length} | ${report.lowContrast.length} | ${report.smallTargets.length} | ${report.horizontalOverflow ? 'yes' : 'no'} |`),
      '',
      'See `report.json` for selectors and measurements, and `accessibility.json` for the full accessibility tree.'
    ].join('\n');
    fs.writeFileSync(path.join(outputDir, 'report.md'), markdown);

    console.log(`Background UI audit complete: ${outputDir}`);
    console.log(`Captured ${reports.filter((report) => !report.skipped).length} surface(s) without showing or focusing the app window.`);
  } catch (error) {
    const logPath = path.join(outputDir, 'startup-error.log');
    fs.writeFileSync(logPath, `${error.stack || error}\n\n${startup.join('').slice(-30000)}`);
    throw new Error(`${error.message}. Diagnostics: ${logPath}`);
  } finally {
    if (cdp) {
      if (originalRendererState) {
        try {
          await cdp.evaluate(`(() => {
            const value = ${JSON.stringify(originalRendererState.currentView)};
            if (value === null) localStorage.removeItem('kolbo_current_view');
            else localStorage.setItem('kolbo_current_view', value);
          })()`);
        } catch {
          // The renderer may already be closing after a startup failure.
        }
      }
      try {
        await cdp.send('Browser.close');
      } catch {
        // The browser may close the socket before acknowledging.
      }
      cdp.close();
    }
    if (child && child.exitCode === null) child.kill();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

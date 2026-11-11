// Kolbo Studio - shared URL / HTML safety helpers (pentest PT-015/016/042/043).
// Pure functions, no Electron dependency. Loaded with require() in the main
// process and with a <script> tag in the renderer (exposes window.KolboUrlSafety).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') root.KolboUrlSafety = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function parse(url) {
    try { return new URL(String(url)); } catch (_) { return null; }
  }

  // Only schemes a browser handles safely. Blocks file:, smb:, ms-msdt:, javascript:, custom protocol handlers...
  // The string is validated exactly as given (no trim, no control chars) so what we check is what the OS opens.
  const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
  const clean = (url) => typeof url === 'string' && url === url.trim() && !/[\x00-\x1f\x7f]/.test(url);
  // mailto: is an ALLOW-LIST (mail clients decode names, accept ';' separators and treat an encoded '?' in the
  // address as a query start, so a denylist of "attach" is bypassable): plain address list, no fragment, and only
  // these decoded parameter names. Anything else (attach, attachment, control-char prefixed keys...) is refused.
  const MAILTO_PARAMS = new Set(['to', 'cc', 'bcc', 'subject', 'body']);
  const decode = (s) => { try { return decodeURIComponent(s); } catch (_) { return null; } };
  function isSafeMailto(u) {
    const addr = decode(u.pathname);
    if (addr === null || u.hash || /[?#&;=\x00-\x1f\x7f]/.test(addr) || /;/.test(u.search)) return false;
    if (!u.search) return true;
    return u.search.slice(1).split('&').every((pair) => {
      const key = decode(pair.split('=')[0]);
      return key !== null && MAILTO_PARAMS.has(key.toLowerCase());
    });
  }
  function isSafeExternalUrl(url) {
    const u = clean(url) ? parse(url) : null;
    return !!u && EXTERNAL_PROTOCOLS.has(u.protocol) && (u.protocol !== 'mailto:' || isSafeMailto(u));
  }

  // What to hand to shell.openExternal: the WHATWG-normalised href (spaces/quotes percent-encoded), so the OS
  // receives exactly the URL we validated and never extra arguments. Call only after isSafeExternalUrl.
  function externalHref(url) {
    return isSafeExternalUrl(url) ? parse(url).href : null;
  }

  function isHttpUrl(url) {
    const u = clean(url) ? parse(url) : null;
    return !!u && (u.protocol === 'https:' || u.protocol === 'http:');
  }

  // EXACT Kolbo app hosts only. Never *.kolbo.ai: sites.kolbo.ai / apps.kolbo.ai serve user-authored pages
  // with scripts, and anything on this list may receive the JWT and drive privileged postMessage actions.
  const KOLBO_APP_HOSTS = new Set(['app.kolbo.ai', 'staging.kolbo.ai', 'dev.kolbo.ai', 'sapir.kolbo.ai']);
  function isKolboHost(hostname) {
    return KOLBO_APP_HOSTS.has(String(hostname || '').toLowerCase());
  }

  // True for the Kolbo app hosts above (https) and for the configured webapp origin (whitelabel domains, localhost in dev).
  function isTrustedWebappOrigin(urlOrOrigin, webappUrl) {
    const u = typeof urlOrOrigin === 'string' ? parse(urlOrOrigin) : null;
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return false;
    if (u.protocol === 'https:' && isKolboHost(u.hostname)) return true;
    const w = webappUrl ? parse(webappUrl) : null;
    return !!w && w.origin !== 'null' && u.origin === w.origin;
  }

  // Escapes text for HTML bodies AND quoted attribute values.
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { isSafeExternalUrl, externalHref, isHttpUrl, isKolboHost, isTrustedWebappOrigin, escapeHtml };
});

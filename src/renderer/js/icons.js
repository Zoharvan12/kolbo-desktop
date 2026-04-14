// ============================================================================
// ICONS - Centralized icon system using Lucide icons
// ============================================================================
//
// Usage:
//   HTML:  <i data-lucide="download"></i>  (hydrated by Icons.init())
//   JS:    Icons.get('download')           → SVG string for template literals
//   JS:    Icons.get('download', 16)       → SVG string with custom size
//   JS:    Icons.get('download', 16, 3)    → SVG string with custom stroke-width
//
// ============================================================================

const Icons = {
  /**
   * Initialize: hydrate all <i data-lucide="..."> elements in the DOM
   * Call once after DOMContentLoaded
   */
  init() {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      lucide.createIcons();
      console.log('[Icons] Lucide icons initialized');
    } else {
      console.error('[Icons] Lucide library not loaded');
    }
  },

  /**
   * Re-hydrate icons in a specific container (for dynamically added content)
   * @param {HTMLElement} container - DOM element to scan
   */
  refresh(container) {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      lucide.createIcons({ nodes: container ? container.querySelectorAll('[data-lucide]') : undefined });
    }
  },

  /**
   * Get SVG string for use in template literals / innerHTML
   * @param {string} name - Lucide icon name in kebab-case (e.g., 'arrow-left')
   * @param {number} size - Icon size in pixels (default 24)
   * @param {number} strokeWidth - Stroke width (default 2)
   * @param {string} className - Optional CSS class
   * @returns {string} SVG markup string
   */
  get(name, size, strokeWidth, className) {
    // Convert kebab-case to PascalCase for lucide.icons lookup
    const pascalName = name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());

    if (typeof lucide === 'undefined' || !lucide.icons || !lucide.icons[pascalName]) {
      console.warn(`[Icons] Icon not found: ${name} (${pascalName})`);
      return '';
    }

    const s = size || 24;
    const sw = strokeWidth || 2;
    const cls = className ? ` class="${className}"` : '';

    const children = lucide.icons[pascalName];
    const paths = children.map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
      return `<${tag} ${attrStr}/>`;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${cls}>${paths}</svg>`;
  }
};

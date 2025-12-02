// Kolbo Studio - Custom Context Menu Component
// Beautiful, elegant context menu with icons

class CustomContextMenu {
  constructor() {
    this.currentMenu = null;
    this.icons = this.getIconSet();
  }

  /**
   * Icon set using SVG paths (Lucide-inspired icons)
   */
  getIconSet() {
    return {
      download: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,

      image: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,

      video: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>`,

      audio: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,

      copy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,

      link: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,

      externalLink: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>`,

      folder: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,

      clear: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,

      premiere: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 8h4a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H7"/><path d="M7 8v8"/></svg>`,

      back: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,

      forward: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 5 7 7-7 7"/><path d="M5 12h14"/></svg>`,

      reload: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`,

      selectAll: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect width="8" height="8" x="3" y="3" rx="1"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="1"/></svg>`,

      search: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,

      tab: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect width="18" height="12" x="3" y="6" rx="2"/><path d="M7 10h10"/></svg>`,

      window: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect width="18" height="14" x="3" y="5" rx="2"/><path d="M3 9h18"/></svg>`,

      url: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 14v.01"/></svg>`,
    };
  }

  /**
   * Get icon SVG by name
   */
  getIcon(name) {
    return this.icons[name] || this.icons.link;
  }

  /**
   * Show custom context menu
   */
  show(items, x, y) {
    // Remove existing menu
    this.hide();

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'context-menu-backdrop';
    backdrop.addEventListener('click', () => this.hide());
    backdrop.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.hide();
    });

    // Create menu container
    const menu = document.createElement('div');
    menu.className = 'context-menu';

    // Build menu items
    items.forEach(item => {
      if (item.type === 'separator') {
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        menu.appendChild(separator);
      } else {
        const menuItem = this.createMenuItem(item);
        menu.appendChild(menuItem);
      }
    });

    // Position menu
    document.body.appendChild(backdrop);
    document.body.appendChild(menu);

    // Calculate position (ensure menu stays within viewport)
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let finalX = x;
    let finalY = y;

    // Adjust horizontal position
    if (x + menuRect.width > viewportWidth) {
      finalX = viewportWidth - menuRect.width - 10;
    }

    // Adjust vertical position
    if (y + menuRect.height > viewportHeight) {
      finalY = viewportHeight - menuRect.height - 10;
    }

    menu.style.left = `${finalX}px`;
    menu.style.top = `${finalY}px`;

    // Store reference
    this.currentMenu = { menu, backdrop };

    // Handle escape key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        this.hide();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);
  }

  /**
   * Create a menu item element
   */
  createMenuItem(item) {
    const menuItem = document.createElement('div');
    menuItem.className = 'context-menu-item';

    // Add additional classes
    if (item.disabled) menuItem.classList.add('disabled');
    if (item.destructive) menuItem.classList.add('destructive');
    if (item.primary) menuItem.classList.add('primary');
    if (item.batch) menuItem.classList.add('batch-operation');

    // Icon
    if (item.icon) {
      const iconEl = document.createElement('div');
      iconEl.className = 'context-menu-icon';
      iconEl.innerHTML = this.getIcon(item.icon);
      menuItem.appendChild(iconEl);
    }

    // Label
    const labelEl = document.createElement('div');
    labelEl.className = 'context-menu-label';
    labelEl.textContent = item.label;
    menuItem.appendChild(labelEl);

    // Badge (for counts, etc.)
    if (item.badge) {
      const badgeEl = document.createElement('span');
      badgeEl.className = 'context-menu-badge';
      badgeEl.textContent = item.badge;
      labelEl.appendChild(badgeEl);
    }

    // Keyboard shortcut
    if (item.shortcut) {
      const shortcutEl = document.createElement('div');
      shortcutEl.className = 'context-menu-shortcut';
      shortcutEl.textContent = item.shortcut;
      menuItem.appendChild(shortcutEl);
    }

    // Click handler
    if (!item.disabled && item.onClick) {
      menuItem.addEventListener('click', () => {
        item.onClick();
        this.hide();
      });
    }

    return menuItem;
  }

  /**
   * Hide context menu
   */
  hide() {
    if (this.currentMenu) {
      const { menu, backdrop } = this.currentMenu;

      // Add closing animation
      menu.classList.add('closing');

      setTimeout(() => {
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        this.currentMenu = null;
      }, 100);
    }
  }

  /**
   * Build menu for media items
   */
  buildMediaItemMenu(params, handlers) {
    const { mediaItem, isMultiSelect, selectedCount } = params;
    const items = [];

    if (isMultiSelect) {
      // Batch selection menu
      items.push(
        {
          label: 'Download All',
          icon: 'download',
          badge: `${selectedCount}`,
          batch: true,
          primary: true,
          onClick: () => handlers.downloadBatch(params)
        },
        { type: 'separator' },
        {
          label: 'Copy All URLs',
          icon: 'copy',
          onClick: () => handlers.copyUrlsBatch(params)
        },
        { type: 'separator' },
        {
          label: 'Clear Selection',
          icon: 'clear',
          destructive: true,
          onClick: () => handlers.clearSelection()
        }
      );
    } else {
      // Single item menu
      const itemType = mediaItem.type;

      // Download option
      if (itemType === 'video') {
        items.push({
          label: 'Download Video',
          icon: 'video',
          primary: true,
          onClick: () => handlers.download(params)
        });
      } else if (itemType === 'image') {
        items.push(
          {
            label: 'Download Image',
            icon: 'image',
            primary: true,
            onClick: () => handlers.download(params)
          },
          {
            label: 'Copy Image',
            icon: 'copy',
            onClick: () => handlers.copyImage(mediaItem)
          }
        );
      } else if (itemType === 'audio') {
        items.push({
          label: 'Download Audio',
          icon: 'audio',
          primary: true,
          onClick: () => handlers.download(params)
        });
      }

      items.push(
        { type: 'separator' },
        {
          label: 'Copy URL',
          icon: 'link',
          onClick: () => handlers.copyUrl(mediaItem)
        },
        {
          label: 'Open in Browser',
          icon: 'externalLink',
          onClick: () => handlers.openExternal(mediaItem)
        }
      );

      // Cached file option
      if (mediaItem.cached) {
        items.push(
          { type: 'separator' },
          {
            label: 'Show in Folder',
            icon: 'folder',
            onClick: () => handlers.revealCache(params)
          }
        );
      }
    }

    return items;
  }

  /**
   * Build menu for webapp content
   */
  buildWebappMenu(params, handlers) {
    const {
      linkURL,
      srcURL,
      mediaType,
      selectionText,
      pageURL,
      canGoBack,
      canGoForward
    } = params;

    const items = [];

    // Text selection menu
    if (selectionText && selectionText.trim().length > 0) {
      items.push(
        {
          label: 'Copy',
          icon: 'copy',
          shortcut: 'Ctrl+C',
          onClick: () => handlers.copy()
        },
        { type: 'separator' },
        {
          label: `Search Google`,
          icon: 'search',
          onClick: () => handlers.searchGoogle(selectionText)
        }
      );
      return items;
    }

    // Image context menu
    if (mediaType === 'image' && srcURL) {
      items.push(
        {
          label: 'Download Image',
          icon: 'image',
          primary: true,
          onClick: () => handlers.downloadFile(srcURL, 'image')
        },
        {
          label: 'Copy Image',
          icon: 'copy',
          onClick: () => handlers.copyImage(srcURL)
        },
        {
          label: 'Copy Image Address',
          icon: 'link',
          onClick: () => handlers.copyUrl(srcURL)
        },
        { type: 'separator' },
        {
          label: 'Open in New Tab',
          icon: 'tab',
          onClick: () => handlers.openInNewTab(srcURL)
        }
      );
    }
    // Video context menu
    else if (mediaType === 'video' && srcURL) {
      items.push(
        {
          label: 'Download Video',
          icon: 'video',
          primary: true,
          onClick: () => handlers.downloadFile(srcURL, 'video')
        },
        {
          label: 'Copy Video Address',
          icon: 'link',
          onClick: () => handlers.copyUrl(srcURL)
        },
        { type: 'separator' },
        {
          label: 'Open in New Tab',
          icon: 'tab',
          onClick: () => handlers.openInNewTab(srcURL)
        }
      );
    }
    // Audio context menu
    else if (mediaType === 'audio' && srcURL) {
      items.push(
        {
          label: 'Download Audio',
          icon: 'audio',
          primary: true,
          onClick: () => handlers.downloadFile(srcURL, 'audio')
        },
        {
          label: 'Copy Audio Address',
          icon: 'link',
          onClick: () => handlers.copyUrl(srcURL)
        }
      );
    }
    // Link context menu
    else if (linkURL) {
      items.push(
        {
          label: 'Open in New Tab',
          icon: 'tab',
          onClick: () => handlers.openInNewTab(linkURL)
        },
        {
          label: 'Open in New Window',
          icon: 'window',
          onClick: () => handlers.openInNewWindow(linkURL)
        },
        { type: 'separator' },
        {
          label: 'Copy Link Address',
          icon: 'link',
          onClick: () => handlers.copyUrl(linkURL)
        }
      );
    }
    // Default menu
    else {
      items.push(
        {
          label: 'Back',
          icon: 'back',
          disabled: !canGoBack,
          onClick: () => handlers.goBack()
        },
        {
          label: 'Forward',
          icon: 'forward',
          disabled: !canGoForward,
          onClick: () => handlers.goForward()
        },
        {
          label: 'Reload',
          icon: 'reload',
          shortcut: 'Ctrl+R',
          onClick: () => handlers.reload()
        },
        { type: 'separator' },
        {
          label: 'Select All',
          icon: 'selectAll',
          shortcut: 'Ctrl+A',
          onClick: () => handlers.selectAll()
        },
        { type: 'separator' },
        {
          label: 'Copy Page URL',
          icon: 'url',
          onClick: () => handlers.copyUrl(pageURL)
        }
      );
    }

    return items;
  }
}

// Make globally available
window.CustomContextMenu = CustomContextMenu;

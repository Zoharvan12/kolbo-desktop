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
      download: Icons.get('download', 18),
      image: Icons.get('image', 18),
      video: Icons.get('film', 18),
      audio: Icons.get('music', 18),
      copy: Icons.get('copy', 18),
      link: Icons.get('link', 18),
      externalLink: Icons.get('external-link', 18),
      folder: Icons.get('folder', 18),
      clear: Icons.get('x', 18),
      premiere: Icons.get('film', 18),
      back: Icons.get('arrow-left', 18),
      forward: Icons.get('arrow-right', 18),
      reload: Icons.get('refresh-cw', 18),
      selectAll: Icons.get('check-square', 18),
      search: Icons.get('search', 18),
      tab: Icons.get('monitor', 18),
      window: Icons.get('monitor', 18),
      url: Icons.get('globe', 18),
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

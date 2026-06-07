/**
 * KolboDropdown — global custom dropdown utility for the Kolbo CEP plugin.
 *
 * Usage:
 *   KolboDropdown.open({
 *     trigger: element,          // HTMLElement — the button/div to anchor to
 *     items: [
 *       { id: 'val', label: 'Name', avatar: 'https://...', selected: true }
 *     ],
 *     onSelect: function(id) {}  // called when user picks an item
 *   });
 *
 *   KolboDropdown.close();       // close programmatically
 *
 * Features:
 *   - Portal-rendered into document.body (never clipped by overflow/stacking)
 *   - Auto-flips above trigger when more space available upward
 *   - max-height fills available space in chosen direction
 *   - Outside-click and Escape-key close
 *   - Avatar images with fallback initials
 *   - Checkmark on the selected item
 *   - Singleton: opening a second dropdown auto-closes the first
 */

var KolboDropdown = (function() {
  var _portal = null;
  var _outsideHandler = null;
  var _keyHandler = null;

  function close() {
    if (_portal) {
      _portal.remove();
      _portal = null;
    }
    if (_outsideHandler) {
      document.removeEventListener('click', _outsideHandler);
      _outsideHandler = null;
    }
    if (_keyHandler) {
      document.removeEventListener('keydown', _keyHandler);
      _keyHandler = null;
    }
  }

  function _avatarHtml(avatar, label) {
    if (avatar) {
      return '<img class="kdd-avatar" src="' + _esc(avatar) + '" alt="" ' +
             'onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'" />' +
             '<div class="kdd-avatar kdd-avatar-fb" style="display:none">' + _initial(label) + '</div>';
    }
    return '<div class="kdd-avatar kdd-avatar-fb">' + _initial(label) + '</div>';
  }

  function _initial(label) {
    return label ? _esc(label.charAt(0).toUpperCase()) : '?';
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function open(opts) {
    close(); // close any existing dropdown first

    var trigger  = opts.trigger;
    var items    = opts.items || [];
    var onSelect = opts.onSelect || function() {};

    if (!trigger || items.length === 0) return;

    var rect       = trigger.getBoundingClientRect();
    var spaceBelow = window.innerHeight - rect.bottom - 8;
    var spaceAbove = rect.top - 8;
    var openUp     = spaceAbove > spaceBelow && spaceBelow < 120;
    var maxH       = Math.min(Math.max(openUp ? spaceAbove : spaceBelow, 80), 360);

    var noAvatar = !!opts.noAvatar;

    // Build items HTML
    var itemsHtml = items.map(function(item) {
      var activeClass = item.selected ? ' kdd-item-active' : '';
      // item.icon: optional inline-SVG markup (trusted, set by callers) shown
      // in place of the avatar. Takes precedence over avatar/initials.
      var leadHtml = item.icon
        ? '<span class="kdd-icon">' + item.icon + '</span>'
        : (noAvatar ? '' : _avatarHtml(item.avatar, item.label));
      return (
        '<div class="kdd-item' + activeClass + '" data-kdd-id="' + _esc(item.id) + '">' +
          leadHtml +
          '<span class="kdd-item-label">' + _esc(item.label) + '</span>' +
          (item.selected
            ? '<svg class="kdd-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
            : '') +
        '</div>'
      );
    }).join('');

    // Create portal
    _portal = document.createElement('div');
    _portal.className = 'kdd-list';
    _portal.innerHTML = itemsHtml;

    // Position — clamp horizontally so the menu is never cropped off the left
    // or right edge of the window (right-aligned triggers near the panel edge
    // would otherwise overflow). Prefer left-aligned to the trigger; shift left
    // only as much as needed to fit.
    var margin = 8;
    var width  = Math.max(rect.width, 180);
    width = Math.min(width, window.innerWidth - margin * 2);
    var left = rect.left;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    if (left < margin) left = margin;

    var posStyle =
      'left:' + Math.round(left) + 'px;' +
      'width:' + Math.round(width) + 'px;' +
      'max-height:' + maxH + 'px;';
    posStyle += openUp
      ? 'bottom:' + (window.innerHeight - rect.top + 4) + 'px;'
      : 'top:' + (rect.bottom + 4) + 'px;';

    _portal.style.cssText = posStyle;
    _portal.style.zoom = window._kolboZoom ? window._kolboZoom() : '100%';
    document.body.appendChild(_portal);

    // Wire item clicks
    _portal.querySelectorAll('.kdd-item').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = el.getAttribute('data-kdd-id');
        close();
        onSelect(id);
      });
    });

    // Outside click
    setTimeout(function() {
      _outsideHandler = function(e) {
        if (_portal && !_portal.contains(e.target) && !trigger.contains(e.target)) {
          close();
        }
      };
      document.addEventListener('click', _outsideHandler);
    }, 0);

    // Escape key
    _keyHandler = function(e) {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', _keyHandler);
  }

  return { open: open, close: close };
})();

/**
 * KolboGroupedDropdown — grouped accordion dropdown for the Kolbo CEP plugin.
 *
 * Usage:
 *   KolboGroupedDropdown.open({
 *     trigger: element,
 *     groups: [
 *       {
 *         id: 'kling',
 *         label: 'Kling',
 *         avatar: 'https://...',      // first model avatar (or null)
 *         items: [
 *           { id: 'kling-v1', label: 'Kling v1', avatar: '...', selected: false }
 *         ]
 *       }
 *     ],
 *     onSelect: function(id) {}
 *   });
 *
 * Groups expand/collapse vertically (accordion). Clicking a sub-item selects it.
 * If only one group, it auto-expands on open.
 */

var KolboGroupedDropdown = (function() {
  var _portal = null;
  var _outsideHandler = null;
  var _keyHandler = null;

  function close() {
    if (_portal) { _portal.remove(); _portal = null; }
    if (_outsideHandler) { document.removeEventListener('click', _outsideHandler); _outsideHandler = null; }
    if (_keyHandler) { document.removeEventListener('keydown', _keyHandler); _keyHandler = null; }
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _initial(label) {
    return label ? _esc(label.charAt(0).toUpperCase()) : '?';
  }

  function _avatarHtml(avatar, label) {
    if (avatar) {
      return '<img class="kdd-avatar" src="' + _esc(avatar) + '" alt="" ' +
             'onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'" />' +
             '<div class="kdd-avatar kdd-avatar-fb" style="display:none">' + _initial(label) + '</div>';
    }
    return '<div class="kdd-avatar kdd-avatar-fb">' + _initial(label) + '</div>';
  }

  function _chevronSvg(cls) {
    return '<svg class="' + cls + '" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
  }

  function _checkSvg() {
    return '<svg class="kdd-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  function _buildHtml(groups) {
    return groups.map(function(group, gi) {
      var hasItems = group.items && group.items.length > 0;

      // Single-model group: render the model directly as a flat item (no accordion)
      if (!hasItems || group.items.length === 1) {
        var item = hasItems ? group.items[0] : { id: group.id, label: group.label, avatar: group.avatar, selected: false };
        var activeClass = item.selected ? ' kdd-item-active' : '';
        return (
          '<div class="kdd-item' + activeClass + '" data-kdd-id="' + _esc(item.id) + '" data-kgd-flat="1">' +
            _avatarHtml(item.avatar, item.label) +
            '<span class="kdd-item-label">' + _esc(item.label) + '</span>' +
            (item.selected ? _checkSvg() : '') +
          '</div>'
        );
      }

      // Multi-model group: render as accordion
      var isSelected = group.items.some(function(it) { return it.selected; });

      var headerHtml =
        '<div class="kdd-group-header" data-kgd-group="' + gi + '">' +
          _avatarHtml(group.avatar, group.label) +
          '<span class="kdd-item-label">' + _esc(group.label) + '</span>' +
          (isSelected ? _checkSvg() : '') +
          _chevronSvg('kdd-group-chevron') +
        '</div>';

      var bodyHtml = '<div class="kdd-group-body" data-kgd-body="' + gi + '" style="display:none">';
      bodyHtml += group.items.map(function(item) {
        var activeClass = item.selected ? ' kdd-item-active' : '';
        return (
          '<div class="kdd-item kdd-sub-item' + activeClass + '" data-kdd-id="' + _esc(item.id) + '">' +
            _avatarHtml(item.avatar, item.label) +
            '<span class="kdd-item-label">' + _esc(item.label) + '</span>' +
            (item.selected ? _checkSvg() : '') +
          '</div>'
        );
      }).join('');
      bodyHtml += '</div>';

      return headerHtml + bodyHtml;
    }).join('');
  }

  function _wireEvents(onSelect) {
    // Group header toggles
    _portal.querySelectorAll('.kdd-group-header').forEach(function(header) {
      header.addEventListener('click', function(e) {
        e.stopPropagation();
        var gi = header.getAttribute('data-kgd-group');
        var body = _portal.querySelector('[data-kgd-body="' + gi + '"]');
        var chevron = header.querySelector('.kdd-group-chevron');
        var isOpen = body.style.display !== 'none';
        // Close all
        _portal.querySelectorAll('.kdd-group-body').forEach(function(b) { b.style.display = 'none'; });
        _portal.querySelectorAll('.kdd-group-chevron').forEach(function(c) { c.classList.remove('kdd-group-chevron-open'); });
        // Toggle clicked
        if (!isOpen) {
          body.style.display = 'block';
          chevron.classList.add('kdd-group-chevron-open');
        }
      });
    });

    // Sub-item clicks (grouped) and flat single-model item clicks
    _portal.querySelectorAll('.kdd-sub-item, [data-kgd-flat="1"]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = el.getAttribute('data-kdd-id');
        close();
        onSelect(id);
      });
    });
  }

  function open(opts) {
    KolboDropdown.close();
    close();

    var trigger  = opts.trigger;
    var groups   = opts.groups || [];
    var onSelect = opts.onSelect || function() {};

    if (!trigger || groups.length === 0) return;

    var rect       = trigger.getBoundingClientRect();
    var spaceBelow = window.innerHeight - rect.bottom - 8;
    var spaceAbove = rect.top - 8;
    var openUp     = spaceAbove > spaceBelow && spaceBelow < 120;
    var maxH       = Math.min(Math.max(openUp ? spaceAbove : spaceBelow, 80), 400);

    _portal = document.createElement('div');
    _portal.className = 'kdd-list';
    _portal.innerHTML = _buildHtml(groups);

    var posStyle =
      'left:' + rect.left + 'px;' +
      'width:' + Math.max(rect.width, 200) + 'px;' +
      'max-height:' + maxH + 'px;';
    posStyle += openUp
      ? 'bottom:' + (window.innerHeight - rect.top + 4) + 'px;'
      : 'top:' + (rect.bottom + 4) + 'px;';

    _portal.style.cssText = posStyle;
    _portal.style.zoom = window._kolboZoom ? window._kolboZoom() : '100%';
    document.body.appendChild(_portal);

    _wireEvents(onSelect);

    // Auto-expand: find first multi-item group that contains the selected model
    // (single-model groups are flat items — no accordion to expand)
    var multiGroups = groups.filter(function(g) { return g.items && g.items.length > 1; });
    var autoExpand = null;
    if (multiGroups.length === 1) {
      // Only one real group — find its index in the original array
      for (var i = 0; i < groups.length; i++) {
        if (groups[i] === multiGroups[0]) { autoExpand = i; break; }
      }
    } else {
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].items && groups[i].items.length > 1 &&
            groups[i].items.some(function(it) { return it.selected; })) {
          autoExpand = i;
          break;
        }
      }
    }
    if (autoExpand !== null) {
      var body = _portal.querySelector('[data-kgd-body="' + autoExpand + '"]');
      var chevron = _portal.querySelector('[data-kgd-group="' + autoExpand + '"] .kdd-group-chevron');
      if (body) body.style.display = 'block';
      if (chevron) chevron.classList.add('kdd-group-chevron-open');
    }

    // Outside click
    setTimeout(function() {
      _outsideHandler = function(e) {
        if (_portal && !_portal.contains(e.target) && !trigger.contains(e.target)) {
          close();
        }
      };
      document.addEventListener('click', _outsideHandler);
    }, 0);

    _keyHandler = function(e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', _keyHandler);
  }

  return { open: open, close: close };
})();

// --- DualClip Drag-and-Drop Archive Import & Text Drop Overlay ---
(function() {
  'use strict';

  var dragDepth = 0;

  function getActiveCollectionInfo() {
    var colId = (typeof currentCollection !== 'undefined' && currentCollection) ? currentCollection : 'all';
    var displayName = 'All Clips';
    var targetCol = 'all';
    var isFavorite = false;

    if (colId === 'pins' || colId === 'favorites') {
      displayName = 'Favorites';
      targetCol = 'all';
      isFavorite = true;
    } else if (colId === 'most_used') {
      displayName = 'All Clips';
      targetCol = 'all';
      isFavorite = false;
    } else if (colId !== 'all') {
      targetCol = colId;
      displayName = colId;
      if (typeof customCollections !== 'undefined' && Array.isArray(customCollections)) {
        var found = customCollections.find(function(c) { return c && c.id === colId; });
        if (found && found.name) displayName = found.name;
      }
    }
    return { targetCol: targetCol, displayName: displayName, isFavorite: isFavorite };
  }

  function showDropZone(mode) {
    var overlay = document.getElementById('dropZoneOverlay');
    if (!overlay) return;

    var titleEl = overlay.querySelector('.drop-zone-title');
    var subEl = overlay.querySelector('.drop-zone-subtitle');

    if (mode === 'text') {
      var info = getActiveCollectionInfo();
      if (titleEl) titleEl.textContent = 'Drop text to create clip';
      if (subEl) subEl.textContent = 'Add to ' + info.displayName;
    } else {
      if (titleEl) titleEl.textContent = 'Drop archive to import';
      if (subEl) subEl.textContent = 'Import clips, collections, and images from .dualclip or .zip';
    }
    overlay.classList.add('active');
  }

  function hideDropZone() {
    dragDepth = 0;
    var overlay = document.getElementById('dropZoneOverlay');
    if (overlay) {
      overlay.classList.remove('active');
    }
  }

  function hasFilePayload(e) {
    if (!e || !e.dataTransfer || !e.dataTransfer.types) return false;
    if (hasInternalDragPayload(e)) return false;
    var types = e.dataTransfer.types;
    if (typeof types.includes === 'function') {
      return types.includes('Files');
    }
    for (var i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }

  function hasInternalDragPayload(e) {
    if (window._isNativeDragActive) return true;
    if (Array.isArray(window._draggedClipIds) && window._draggedClipIds.length > 0) return true;
    if (!e || !e.dataTransfer || !e.dataTransfer.types) return false;
    var types = e.dataTransfer.types;
    for (var i = 0; i < types.length; i++) {
      if (typeof types[i] === 'string' && (types[i].toLowerCase().indexOf('application/x-dualclip') === 0)) {
        return true;
      }
    }
    return false;
  }

  function hasTextPayload(e) {
    if (!e || !e.dataTransfer || !e.dataTransfer.types) return false;
    if (hasInternalDragPayload(e)) return false;
    var types = e.dataTransfer.types;
    if (typeof types.includes === 'function') {
      return types.includes('text/plain') || types.includes('text/html') || types.includes('text/uri-list');
    }
    for (var i = 0; i < types.length; i++) {
      if (types[i] === 'text/plain' || types[i] === 'text/html' || types[i] === 'text/uri-list') return true;
    }
    return false;
  }

  function invokeHostImport(method, namedArgs) {
    if (typeof window.callHostChecked === 'function') {
      window.callHostChecked(method, namedArgs);
    } else if (window.chrome && window.chrome.webview) {
      var positional = method === 'import_dropped_package'
        ? [namedArgs.filePath]
        : [namedArgs.fileName, namedArgs.base64];
      window.chrome.webview.postMessage({ id: 0, method: method, args: positional });
    } else {
      if (typeof window.showToast === 'function') {
        window.showToast('Import failed: bridge connection not ready. Please use Settings → Storage → Import.');
      }
    }
  }

  function handleDroppedFile(file) {
    var fileName = file.name || 'archive.dualclip';
    var lowerName = fileName.toLowerCase();

    if (!lowerName.endsWith('.dualclip') && !lowerName.endsWith('.zip')) {
      if (typeof window.showToast === 'function') {
        window.showToast('Unsupported format: drop a .dualclip or .zip archive');
      }
      return;
    }

    if (typeof window.showToast === 'function') {
      window.showToast('Importing backup archive...');
    }

    // Tier 1: Real file path from WebView2 host (if exposed)
    if (file.path && typeof file.path === 'string') {
      invokeHostImport('import_dropped_package', { filePath: file.path });
      return;
    }

    // Tier 2: ArrayBuffer / Base64 bridge upload (up to 64 MB)
    var MAX_DRAG_BYTES = 64 * 1024 * 1024;
    if (file.size > MAX_DRAG_BYTES) {
      if (typeof window.showToast === 'function') {
        window.showToast('Archive exceeds drag limit (64 MB). Please use Settings → Storage → Import.');
      }
      return;
    }

    var reader = new FileReader();
    reader.onload = function() {
      try {
        var dataUrl = reader.result;
        if (typeof dataUrl === 'string') {
          var commaIdx = dataUrl.indexOf(',');
          var b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
          invokeHostImport('import_package_base64', { fileName: fileName, base64: b64 });
        }
      } catch (err) {
        if (typeof window.showToast === 'function') {
          window.showToast('Import failed: ' + (err && err.message ? err.message : 'read error'));
        }
      }
    };
    reader.onerror = function() {
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to read dropped archive');
      }
    };
    reader.readAsDataURL(file);
  }

  window.addEventListener('dragenter', function(e) {
    if (hasInternalDragPayload(e)) return;
    if (hasFilePayload(e)) {
      e.preventDefault();
      dragDepth++;
      showDropZone('files');
    } else if (hasTextPayload(e)) {
      e.preventDefault();
      dragDepth++;
      showDropZone('text');
    }
  }, false);

  window.addEventListener('dragover', function(e) {
    if (hasInternalDragPayload(e)) return;
    if (hasFilePayload(e)) {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
      showDropZone('files');
    } else if (hasTextPayload(e)) {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
      showDropZone('text');
    }
  }, false);

  window.addEventListener('dragleave', function(e) {
    if (hasFilePayload(e) || hasTextPayload(e)) {
      dragDepth--;
      if (dragDepth <= 0) {
        hideDropZone();
      }
    }
  }, false);

  window.addEventListener('drop', function(e) {
    if (e.target && e.target.closest && e.target.closest('.col-pill')) {
      hideDropZone();
      return;
    }

    if (hasInternalDragPayload(e)) {
      hideDropZone();
      return;
    }

    e.preventDefault();
    hideDropZone();

    // 1. Files drop (archives)
    var files = e.dataTransfer ? e.dataTransfer.files : null;
    if (files && files.length > 0) {
      handleDroppedFile(files[0]);
      return;
    }

    // 2. Text drop (dragged highlighted text)
    var text = '';
    if (e.dataTransfer) {
      text = e.dataTransfer.getData('text/plain') || '';
      if (!text) {
        var html = e.dataTransfer.getData('text/html') || '';
        if (html) {
          var tmp = document.createElement('div');
          tmp.innerHTML = html;
          text = tmp.textContent || tmp.innerText || '';
        }
      }
    }

    if (text && text.trim()) {
      var info = getActiveCollectionInfo();
      if (typeof window.callHostChecked === 'function') {
        window.callHostChecked('add_text_to_collection', {
          text: text,
          collection: info.targetCol,
          favorite: info.isFavorite
        });
      } else if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage({
          id: 0,
          method: 'add_text_to_collection',
          args: [text, info.targetCol, info.isFavorite]
        });
      }
      if (typeof window.showToast === 'function') {
        window.showToast('Added clip to ' + info.displayName);
      }
    }
  }, false);

  window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      hideDropZone();
    }
  });

  window.onDropZoneShow = function() { showDropZone('files'); };
  window.onDropZoneHide = hideDropZone;
})();

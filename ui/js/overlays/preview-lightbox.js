// --- DualClip Preview Modal & Image Lightbox ---

let _previewGen = 0;

// Zoom state
let zoomMode = 'fit';
let userZoom = 1.0;
let panX = 0;
let panY = 0;
let naturalWidth = 0;
let naturalHeight = 0;

let lightboxWheelHandler = null;
let lightboxResizeHandler = null;
let lightboxResizeTimer = 0;
let lightboxMouseDownHandler = null;
let lightboxMouseMoveHandler = null;
let lightboxMouseUpHandler = null;
let lightboxClickHandler = null;
let lightboxContextMenuHandler = null;
let isPanning = false;
// ── Deterministic Anchor Restoration for Spacebar Preview ──
// Save clip.id + viewport offset + fallback scrollTop on open; restore exact offset on close.
let _previewAnchor = null; // { id, idx, scrollTop, viewportOffset }
let panStartedOnImage = false;
let panStartX = 0;
let panStartY = 0;
let panOriginX = 0;
let panOriginY = 0;
let didPan = false;
let isPreviewWrapped = true;
let _compactPreviewExpanded = false;
let _compactPreExpandSize = null;

function isDockTarget(target) {
  if (!target) return false;
  const dock = document.getElementById('prevZoomDock');
  return dock && dock.contains(target);
}

function openFullPreviewModal(clip) {
  if (!clip) {
    if (typeof selectedIndex !== 'undefined' && selectedIndex >= 0 && typeof clips !== 'undefined' && clips[selectedIndex]) {
      clip = clips[selectedIndex];
    }
  } else if (typeof clip === 'number' || typeof clip === 'string') {
    const id = clip;
    const pool = (typeof clips !== 'undefined' && Array.isArray(clips)) ? clips : [];
    const allPool = (typeof allClips !== 'undefined' && Array.isArray(allClips)) ? allClips : [];
    clip = pool.find(c => c && c.id === id) || allPool.find(c => c && c.id === id) || null;
  }
  if (!clip) return;

  if (window.dcDebugLog) {
    window.dcDebugLog('Frontend:Preview', 'openFullPreviewModal: id=' + clip.id + ', is_image=' + !!clip.is_image + ', currentSize=' + window.innerWidth + 'x' + window.innerHeight);
  }

  // ── Anchor capture (before any DOM/layout change, do NOT rebuild list) ──
  try {
    const container = document.getElementById('listContainer');
    if (container && clip && clip.id != null) {
      const savedScrollTop = container.scrollTop;
      let viewportOffset = null;
      let idx = -1;
      try {
        if (typeof clips !== 'undefined' && Array.isArray(clips)) {
          idx = clips.findIndex(c => c && c.id === clip.id);
          if (idx < 0 && typeof selectedIndex !== 'undefined' && selectedIndex >= 0) idx = selectedIndex;
        } else if (typeof selectedIndex !== 'undefined' && selectedIndex >= 0) idx = selectedIndex;
      } catch {}
      let rowEl = null;
      if (idx >= 0) { try { rowEl = document.querySelector(`.clip-row[data-idx="${idx}"]`); } catch {} }
      if (rowEl && container) {
        const cRect = container.getBoundingClientRect();
        const rRect = rowEl.getBoundingClientRect();
        viewportOffset = rRect.top - cRect.top;
      } else {
        try {
          if (typeof currentFlatItems !== 'undefined' && Array.isArray(currentFlatItems)) {
            const flat = currentFlatItems.find(it => it.type === 'clip' && it.clip && it.clip.id === clip.id);
            if (flat) viewportOffset = flat.top - savedScrollTop;
          }
        } catch {}
      }
      _previewAnchor = { id: clip.id, idx, scrollTop: savedScrollTop, viewportOffset };
      try { window.__previewAnchorPending = true; window.__previewAnchor = _previewAnchor; } catch {}
    }
  } catch {}

  try {
    const isCompact = document.documentElement.getAttribute('data-layout-preset') === 'compact' ||
                      (document.body && document.body.classList.contains('density-dense'));
    if (isCompact && !_compactPreviewExpanded) {
      const zoom = typeof currentZoomLevel !== 'undefined' ? currentZoomLevel : 1.0;
      _compactPreExpandSize = {
        w: window.innerWidth,
        h: window.innerHeight
      };
      _compactPreviewExpanded = true;
      const targetW = Math.max(Math.round(660 * zoom), window.innerWidth);
      const targetH = Math.max(Math.round(520 * zoom), window.innerHeight);
      if (window.dcDebugLog) {
        window.dcDebugLog('Frontend:Preview', 'Compact preview expansion dispatched: from ' + window.innerWidth + 'x' + window.innerHeight + ' to ' + targetW + 'x' + targetH + ' (animate=true, persist=false)');
      }
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_window_size === 'function') {
        window.pywebview.api.set_window_size(targetW, targetH, true, false);
      } else if (typeof callHost === 'function') {
        callHost('set_window_size', [targetW, targetH, true, false]);
      }
    }
  } catch (_) {}

  currentPreviewClip = clip;
  const textBody = document.getElementById('prevContent');
  const imgBody = document.getElementById('prevImageContainer');
  const saveBtn = document.getElementById('prevSaveBtn');
  if (!textBody) return;

  teardownImageLightbox();
  if (imgBody) { imgBody.innerHTML = ''; imgBody.style.display = 'none'; }
  textBody.style.display = 'block';
  textBody.classList.remove('has-lightbox-image');
  if (saveBtn) {
    saveBtn.style.display = 'inline-block';
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.5';
    saveBtn.style.cursor = 'not-allowed';
  }
  const myGen = ++_previewGen;

  const wrapBtn = document.getElementById('prevWrapToggleBtn');
  const zoomGroup = document.getElementById('prevZoomGroup');

  if (clip.is_image) {
    textBody.style.display = 'none';
    if (imgBody) { imgBody.style.display = 'flex'; imgBody.classList.add('has-lightbox-image'); }
    if (wrapBtn) wrapBtn.style.display = 'none';
    if (zoomGroup) zoomGroup.style.display = 'flex';
    const titleEl = document.getElementById('prevTitle');
    if (titleEl) titleEl.innerText = clip.title || 'Image Preview';

    zoomMode = 'fit';
    userZoom = 1.0;
    panX = 0;
    panY = 0;
    naturalWidth = 0;
    naturalHeight = 0;

    const img = document.createElement('img');
    img.id = 'previewLightboxImg';
    img.className = 'preview-image-lightbox';
    const initialSrc = (clip.image_data && !clip.image_data.startsWith('file:///')) ? clip.image_data : (clip.thumbnail_data || '');
    if (window.dcDebugLog) {
      window.dcDebugLog('Frontend:Preview', 'Image element created. initialSrc length=' + (initialSrc ? initialSrc.length : 0));
    }
    img.onerror = () => {
      if (window.dcDebugLog) window.dcDebugLog('Frontend:Preview', 'Image load error for initialSrc; falling back to thumbnail');
      if (clip.thumbnail_data && img.src !== clip.thumbnail_data) {
        img.src = clip.thumbnail_data;
      }
    };

    img.onload = () => {
      naturalWidth = img.naturalWidth || 0;
      naturalHeight = img.naturalHeight || 0;
      if (window.dcDebugLog) {
        window.dcDebugLog('Frontend:Preview', 'Image onload completed: natural=' + naturalWidth + 'x' + naturalHeight);
      }
      applyImageZoom();
      try { img.style.opacity = '1'; } catch {}
    };
    img.alt = clip.title || 'Image preview';
    try { img.style.opacity = '0'; } catch {}
    img.src = initialSrc;
    if (img.complete && img.naturalWidth) {
      naturalWidth = img.naturalWidth || 0;
      naturalHeight = img.naturalHeight || 0;
      if (window.dcDebugLog) {
        window.dcDebugLog('Frontend:Preview', 'Image was already cached/complete: natural=' + naturalWidth + 'x' + naturalHeight);
      }
      applyImageZoom();
    }

    try {
      const isThumb = !clip.image_data || clip.image_data === clip.thumbnail_data || (clip.image_data && clip.image_data.startsWith('data:')) || clip.image_data.startsWith('file:///');
      const isFullHost = clip.image_data && clip.image_data.startsWith('https://images.example');
      if (isThumb && !isFullHost && clip.id) {
        let directHostUrl = null;
        try {
          const p = clip.image_path || '';
          if (p) {
            const fileName = String(p).split(/[\\/]/).pop();
            if (fileName) directHostUrl = `https://images.example/${encodeURIComponent(fileName)}`;
          }
        } catch {}
        if (directHostUrl) {
          const cur = document.getElementById('previewLightboxImg');
          if (cur && cur === img && cur.src !== directHostUrl) {
            if (!cur.src || cur.src.startsWith('data:') || cur.src !== directHostUrl) { try { cur.style.opacity = '0'; } catch {} cur.src = directHostUrl; }
          }
        }
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_clip_temp_file === 'function') {
          const genAtCall = myGen;
          const timeoutMs = 3000;
          const filePromise = window.pywebview.api.get_clip_temp_file(clip.id);
          const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('get_clip_temp_file timeout')), timeoutMs));
          Promise.race([filePromise, timeoutPromise]).then(res => {
            if (genAtCall !== _previewGen) return;
            if (res && res.ok && res.path) {
              const raw = String(res.path).replace(/\\/g, '/');
              const fileName = raw.split('/').pop() || '';
              const fullUrl = fileName ? `https://images.example/${encodeURIComponent(fileName)}` : (raw.startsWith('http') ? raw : `https://images.example/${encodeURIComponent(raw)}`);
              const cur2 = document.getElementById('previewLightboxImg');
              if (cur2 && cur2 === img && cur2.src !== fullUrl) {
                try { cur2.style.opacity = '0'; } catch {}
                cur2.src = fullUrl;
              }
            }
          }).catch(()=>{});
        }
      }
    } catch {}

    img.setAttribute('draggable', 'true');
    img.addEventListener('dragstart', onLightboxImageDragStart);
    if (imgBody) {
      imgBody.appendChild(img);
      installImageLightboxHandlers(imgBody, img);
    }

    const statsEl = document.getElementById('prevStats');
    if (statsEl) statsEl.style.display = 'none';
    const copyBtn = document.getElementById('prevCopyBtn');
    if (copyBtn) copyBtn.innerText = 'Copy Image';
  } else {
    const statsEl = document.getElementById('prevStats');
    if (statsEl) statsEl.style.display = 'inline';
    if (zoomGroup) zoomGroup.style.display = 'none';
    if (wrapBtn) {
      wrapBtn.style.display = 'inline-block';
      wrapBtn.textContent = isPreviewWrapped ? 'Wrap: ON' : 'Wrap: OFF';
    }
    textBody.classList.toggle('wrap-off', !isPreviewWrapped);
    const titleEl = document.getElementById('prevTitle');
    if (titleEl) titleEl.innerText = clip.title || 'Item Preview';
    let text = clip.text_content || clip.preview || '';
    const needsFullFetch = clip.char_count > 4000 && text.length < clip.char_count;
    
    const updateStatsFromVal = (val) => {
      const charCount = val.length;
      const wordCount = (val.trim().match(/\S+/g) || []).length;
      const lineCount = (val.match(/\n/g) || []).length + (val.length > 0 ? 1 : 0);
      if (statsEl) {
        statsEl.innerText = `${charCount.toLocaleString()} chars • ~${wordCount.toLocaleString()} words • ${lineCount.toLocaleString()} lines`;
      }
    };

    textBody.value = text;
    try { textBody.scrollTop = 0; } catch (_) {}
    updateStatsFromVal(text);

    textBody.oninput = () => {
      updateStatsFromVal(textBody.value);
      if (saveBtn) {
        const hasChanged = textBody.value !== (clip.text_content || clip.preview || '');
        saveBtn.disabled = !hasChanged;
        saveBtn.style.opacity = hasChanged ? '1' : '0.5';
        saveBtn.style.cursor = hasChanged ? 'pointer' : 'not-allowed';
      }
    };

    textBody.onkeydown = (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        if (saveBtn && !saveBtn.disabled) {
          savePreviewClip();
        }
      }
    };

    if (needsFullFetch && window.pywebview && window.pywebview.api && clip.id) {
      const genAtCall = myGen;
      const fetchFn = typeof window.pywebview.api.get_clip_text === 'function' ? window.pywebview.api.get_clip_text : (typeof window.pywebview.api.get_clip === 'function' ? window.pywebview.api.get_clip : null);
      if (fetchFn) {
        textBody.placeholder = 'Loading full content…';
        const p = fetchFn(clip.id);
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('get_clip timeout')), 3000));
        Promise.race([p, timeout]).then(res => {
          if (genAtCall !== _previewGen) return;
          let full = null;
          if (res && res.ok) {
            if (typeof res.text === 'string' && res.text.length > 0) full = res.text;
            else if (res.clip && typeof res.clip.text_content === 'string') full = res.clip.text_content;
          }
          if (full && full.length > text.length) {
            try { clip.text_content = full; clip.char_count = full.length; } catch {}
            let keepScroll = 0;
            try { keepScroll = textBody.scrollTop || 0; } catch {}
            textBody.value = full;
            textBody.placeholder = '';
            try { textBody.scrollTop = keepScroll; } catch (_) {}
            updateStatsFromVal(full);
          }
        }).catch(() => {});
      }
    }
    const copyBtn = document.getElementById('prevCopyBtn');
    if (copyBtn) copyBtn.innerText = 'Copy';
  }
  const modal = document.getElementById('previewModal');
  if (modal) {
    modal.style.display = 'flex';
    if (window.dcDebugLog) window.dcDebugLog('Frontend:Preview', 'previewModal display set to flex');
  }
  try { applyPreviewFontForClip(clip); } catch (_) {}
  // Direct dialog-pin signal (the modal observer also sends it; belt and
  // suspenders so an outside click can never catch the flag unset).
  try { notifyModalPin(true); } catch {}
}

function onLightboxImageDragStart(e) {
  const clip = currentPreviewClip;
  if (!clip) {
    e.preventDefault();
    return;
  }
  try {
    if (typeof isFeatureEnabled === 'function' && !isFeatureEnabled('dragOut')) {
      e.preventDefault();
      return;
    }
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.start_file_drag === 'function') {
      e.preventDefault();
      window.pywebview.api.start_file_drag(clip.id).then(res => {      });
      return;
    }
  } catch (_) {}
  try {
    const rawSrc = clip.image_data || clip.thumbnail_data;
    const src = typeof sanitizeImageSrc === 'function' ? sanitizeImageSrc(rawSrc) : rawSrc;
    if (src) {
      if (/^(data:image\/|https?:|file:)/i.test(src)) {
        try { e.dataTransfer.setData('text/html', `<img src="${src}">`); } catch (_) {}
        if (src.startsWith('data:')) {
          try {
            const [meta, b64] = rawSrc.split(',');
            const mimeMatch = /data:([^;]+)/.exec(meta);
            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            const file = new File([arr], `DualClip_${clip.id}.${(mime.split('/')[1] || 'png')}`, { type: mime });
            try { e.dataTransfer.items.add(file); } catch (_) {}
          } catch (_) {}
        }
      }
    }
    if (clip.image_path) {
      const mime = 'image/png';
      const filename = `DualClip_${clip.id}.png`;
      const fileUrl = `file:///${clip.image_path.replace(/\\/g, '/')}`;
      try { e.dataTransfer.setData('DownloadURL', `${mime}:${filename}:${fileUrl}`); } catch (_) {}
    }
  } catch (err) {}
}

function installImageLightboxHandlers(body, img) {
  lightboxWheelHandler = (e) => {
    if (isDockTarget(e.target)) return;
    e.preventDefault();
    // Dampened zoom: normalize trackpad/wheel deltas to [-1, 1] notches so a
    // full wheel tick moves only 0.08 (was a jumpy fixed 0.2).
    const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (!raw) return;
    const notches = Math.max(-1, Math.min(1, raw / 100));
    changePreviewZoom(notches * 0.12);
  };
  body.addEventListener('wheel', lightboxWheelHandler, { passive: false });

  lightboxMouseDownHandler = (e) => {
    if (e.button !== 0) return;
    if (isDockTarget(e.target)) return;
    if (e.target !== img) return;
    if (zoomMode === 'fit' && userZoom <= 1.0) return;
    isPanning = true;
    panStartedOnImage = true;
    didPan = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
    img.style.transition = 'none';
    body.classList.add('is-panning');
  };
  lightboxMouseMoveHandler = (e) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (Math.abs(dx) + Math.abs(dy) > 2) {
      didPan = true;
      e.preventDefault();
    }
    panX = panOriginX + dx;
    panY = panOriginY + dy;
    applyImageTransform();
  };
  lightboxMouseUpHandler = () => {
    if (!isPanning) return;
    isPanning = false;
    img.style.transition = '';
    body.classList.remove('is-panning');
  };
  body.addEventListener('mousedown', lightboxMouseDownHandler);
  window.addEventListener('mousemove', lightboxMouseMoveHandler);
  window.addEventListener('mouseup', lightboxMouseUpHandler);
  // Refit after window morphs/resizes: fit was computed mid-morph and
  // would otherwise sit stale until the user touches zoom.
  lightboxResizeHandler = () => {
    try { clearTimeout(lightboxResizeTimer); } catch {}
    lightboxResizeTimer = setTimeout(() => {
      try {
        if (zoomMode !== 'fit') return;
        const m = document.getElementById('previewModal');
        if (!m || m.style.display !== 'flex') return;
        applyImageZoom();
      } catch {}
    }, 90);
  };
  window.addEventListener('resize', lightboxResizeHandler);

  lightboxClickHandler = (e) => {
    if (didPan) { didPan = false; return; }
    if (zoomMode === 'fit') {
      setZoomMode('one');
    } else {
      setZoomMode('fit');
    }
  };
  img.addEventListener('click', lightboxClickHandler);

  const dock = document.getElementById('prevZoomDock');
  if (dock) {
    lightboxContextMenuHandler = (e) => e.preventDefault();
    dock.addEventListener('contextmenu', lightboxContextMenuHandler);
  }

  const bindBtn = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    // Click only: binding mousedown + click fired every press twice,
    // making the +/- buttons jump two steps per click.
    const handler = (e) => {
      e.stopPropagation();
      e.preventDefault();
      fn();
    };
    el.__lightboxHandler = handler;
    el.addEventListener('click', handler);
  };
  bindBtn('prevZoomOutBtn', () => changePreviewZoom(-0.1));
  bindBtn('prevZoomInBtn', () => changePreviewZoom(0.1));
  bindBtn('prevOneToOneBtn', () => setZoomMode('one'));

  const label = document.getElementById('prevZoomLabel');
  if (label) {
    const labelHandler = (e) => {
      e.stopPropagation();
      e.preventDefault();
      setZoomMode('fit');
    };
    label.__labelHandler = labelHandler;
    label.addEventListener('click', labelHandler);
  }
}

function teardownImageLightbox() {
  const imgBody = document.getElementById('prevImageContainer');
  const textBody = document.getElementById('prevContent');
  if (imgBody && lightboxWheelHandler) imgBody.removeEventListener('wheel', lightboxWheelHandler);
  if (imgBody && lightboxMouseDownHandler) imgBody.removeEventListener('mousedown', lightboxMouseDownHandler);
  if (textBody && lightboxWheelHandler) textBody.removeEventListener('wheel', lightboxWheelHandler);
  if (textBody && lightboxMouseDownHandler) textBody.removeEventListener('mousedown', lightboxMouseDownHandler);
  if (lightboxMouseMoveHandler) window.removeEventListener('mousemove', lightboxMouseMoveHandler);
  if (lightboxMouseUpHandler) window.removeEventListener('mouseup', lightboxMouseUpHandler);
  if (lightboxResizeHandler) window.removeEventListener('resize', lightboxResizeHandler);
  try { clearTimeout(lightboxResizeTimer); } catch {}
  lightboxResizeTimer = 0;

  const img = document.getElementById('previewLightboxImg');
  if (img) {
    if (lightboxClickHandler) img.removeEventListener('click', lightboxClickHandler);
    try { const oldSrc = img.src; img.src = ''; img.removeAttribute('src'); if (oldSrc && oldSrc.startsWith('blob:')) URL.revokeObjectURL(oldSrc); } catch {}
  }
  const dock = document.getElementById('prevZoomDock');
  if (dock && lightboxContextMenuHandler) dock.removeEventListener('contextmenu', lightboxContextMenuHandler);

  ['prevZoomOutBtn', 'prevZoomInBtn', 'prevOneToOneBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.__lightboxHandler) {
      el.removeEventListener('click', el.__lightboxHandler);
      el.__lightboxHandler = null;
    }
  });
  const label = document.getElementById('prevZoomLabel');
  if (label && label.__labelHandler) {
    label.removeEventListener('click', label.__labelHandler);
    label.__labelHandler = null;
  }

  lightboxWheelHandler = null;
  lightboxResizeHandler = null;
  lightboxMouseDownHandler = null;
  lightboxMouseMoveHandler = null;
  lightboxMouseUpHandler = null;
  lightboxClickHandler = null;
  lightboxContextMenuHandler = null;
  isPanning = false;
  panStartedOnImage = false;
  didPan = false;
  panX = 0;
  panY = 0;
  userZoom = 1.0;
  zoomMode = 'fit';
  naturalWidth = 0;
  naturalHeight = 0;
  if (imgBody) {
    imgBody.style.cursor = '';
    imgBody.classList.remove('is-panning', 'has-lightbox-image');
    imgBody.onwheel = null;
  }
  if (textBody) {
    textBody.style.cursor = '';
    textBody.classList.remove('is-panning', 'has-lightbox-image');
    textBody.onwheel = null;
  }
}

function computeFitScale() {
  if (!naturalWidth || !naturalHeight) return 1.0;
  const body = document.getElementById('prevImageContainer') || document.getElementById('prevContent');
  if (!body) return 1.0;
  const rect = body.getBoundingClientRect();
  let availW = Math.max(50, rect.width);
  let availH = Math.max(50, rect.height);
  if (_compactPreviewExpanded && (availW < 300 || availH < 220)) {
    const zoom = typeof currentZoomLevel !== 'undefined' ? currentZoomLevel : 1.0;
    availW = Math.max(availW, Math.round(620 * zoom));
    availH = Math.max(availH, Math.round(440 * zoom));
  }
  return Math.min(availW / naturalWidth, availH / naturalHeight, 1.0);
}

function setZoomMode(mode) {
  zoomMode = mode;
  userZoom = 1.0;
  panX = 0;
  panY = 0;
  applyImageZoom();
}

function changePreviewZoom(delta) {
  if (zoomMode === 'fit') {
    // Smooth handoff: start from the current fit scale instead of snapping
    // to 1.0, otherwise a tall image at Fit 70% jumps on the first tick.
    zoomMode = 'one';
    userZoom = computeFitScale();
  }
  userZoom = Math.min(Math.max(0.1, userZoom + delta), 8.0);
  applyImageZoom();
}


function applyImageZoom() {
  applyImageTransform();
  updateZoomDisplay();
  updateFitButton();
}

function applyImageTransform() {
  const img = document.getElementById('previewLightboxImg');
  if (!img) return;
  let scale;
  if (zoomMode === 'fit') {
    img.classList.remove('is-one-to-one');
    scale = computeFitScale();
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.width = 'auto';
    img.style.height = 'auto';
    panX = 0;
    panY = 0;
    img.style.transform = `translate(0px, 0px) scale(${scale})`;
  } else {
    img.classList.add('is-one-to-one');
    img.style.width = `${naturalWidth || 0}px`;
    img.style.height = `${naturalHeight || 0}px`;
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    const s = userZoom;
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${s})`;
  }
}

function updateZoomDisplay() {
  const label = document.getElementById('prevZoomLabel');
  if (!label) return;
  if (zoomMode === 'fit') {
    const fitScale = computeFitScale();
    label.innerText = `Fit (${Math.round(fitScale * 100)}%)`;
  } else {
    label.innerText = `${Math.round(userZoom * 100)}%`;
  }
}

function updateFitButton() {
  const fitBtn = document.getElementById('prevFitBtn');
  const oneBtn = document.getElementById('prevOneToOneBtn');
  if (fitBtn) fitBtn.classList.toggle('active', zoomMode === 'fit');
  if (oneBtn) oneBtn.classList.toggle('active', zoomMode === 'one');
}

const PREVIEW_FONTS = [
  { name: 'Sans', value: 'sans', family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { name: 'Mono', value: 'mono', family: "var(--font-mono, 'JetBrains Mono', monospace)" },
  { name: 'Cascadia', value: 'cascadia', family: "'Cascadia Code', Consolas, monospace" }
];
function getPreviewFontValue() {
  const f = PREVIEW_FONTS[currentPreviewFontIdx];
  return f ? f.value : 'sans';
}
function syncPreviewFontSelect() {
  const sel = document.getElementById('stPreviewFontSelect');
  if (sel) sel.value = getPreviewFontValue();
}
let currentPreviewFontIdx = (() => {
  try {
    const saved = localStorage.getItem('dualclip_preview_font');
    if (saved) {
      const idx = PREVIEW_FONTS.findIndex(f => f.name.toLowerCase() === saved.toLowerCase());
      if (idx !== -1) return idx;
    }
  } catch (_) {}
  return 0; // Default to Sans
})();

let previewTextFontSize = (() => {
  try {
    const saved = parseInt(localStorage.getItem('dualclip_preview_font_size'), 10);
    if (!isNaN(saved) && saved >= 9 && saved <= 36) return saved;
  } catch (_) {}
  return 13;
})();

function applyPreviewFontForClip(clip) {
  applyPreviewFontAndSize();
}

function applyPreviewFontAndSize() {
  const font = PREVIEW_FONTS[currentPreviewFontIdx] || PREVIEW_FONTS[0];
  const body = document.getElementById('prevContent');
  if (body) {
    body.style.setProperty('font-family', font.family, 'important');
    body.style.setProperty('font-size', `${previewTextFontSize}px`, 'important');
  }
  syncPreviewFontSelect();
}

function changePreviewFontSetting(value) {
  const v = String(value || 'sans').toLowerCase();
  let idx = PREVIEW_FONTS.findIndex(f => f.value === v || f.name.toLowerCase() === v);
  if (idx < 0) idx = 0;
  currentPreviewFontIdx = idx;
  try { localStorage.setItem('dualclip_preview_font', PREVIEW_FONTS[idx].name); } catch (_) {}
  applyPreviewFontAndSize();
}
window.changePreviewFontSetting = changePreviewFontSetting;

function changePreviewTextFontSize(delta) {
  const textBody = document.getElementById('prevContent');
  if (!textBody) return;
  if (delta === 0) {
    previewTextFontSize = 13;
  } else {
    previewTextFontSize = Math.max(9, Math.min(36, previewTextFontSize + delta));
  }
  try { localStorage.setItem('dualclip_preview_font_size', String(previewTextFontSize)); } catch (_) {}
  textBody.style.setProperty('font-size', `${previewTextFontSize}px`, 'important');
}
window.changePreviewTextFontSize = changePreviewTextFontSize;

function cyclePreviewFont() {
  currentPreviewFontIdx = (currentPreviewFontIdx + 1) % PREVIEW_FONTS.length;
  try { localStorage.setItem('dualclip_preview_font', PREVIEW_FONTS[currentPreviewFontIdx].name); } catch (_) {}
  applyPreviewFontAndSize();
}
window.cyclePreviewFont = cyclePreviewFont;
window.applyPreviewFontAndSize = applyPreviewFontAndSize;
window.applyPreviewFontForClip = applyPreviewFontForClip;
try { syncPreviewFontSelect(); } catch (_) {}
try { document.addEventListener('DOMContentLoaded', syncPreviewFontSelect); } catch (_) {}

function togglePreviewWrap() {
  isPreviewWrapped = !isPreviewWrapped;
  const body = document.getElementById('prevContent');
  const btn = document.getElementById('prevWrapToggleBtn');
  if (body) {
    body.classList.toggle('wrap-off', !isPreviewWrapped);
    if (body.tagName === 'TEXTAREA') {
      body.setAttribute('wrap', isPreviewWrapped ? 'soft' : 'off');
    }
  }
  if (btn) {
    btn.textContent = isPreviewWrapped ? 'Wrap: ON' : 'Wrap: OFF';
  }
}

function notifyModalPin(open) {
  try {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_modal_open === 'function') {
      window.pywebview.api.set_modal_open(!!open);
    } else if (typeof callHost === 'function') {
      callHost('set_modal_open', [!!open]);
    }
  } catch {}
}
window.notifyModalPin = notifyModalPin;

function closePreviewModal(event, force = false) {
  // If invoked as an event handler, only proceed if the target is explicitly the close button
  if (event && (event.type === 'click' || event.type === 'mousedown' || event.type === 'pointerdown')) {
    const isCloseBtn = event.target && event.target.closest && event.target.closest('#prevHeader .close, #prevFooter button.close-btn, [data-action="close-preview"]');
    if (!isCloseBtn && !force) {
      return;
    }
  }
  teardownImageLightbox();
  try { notifyModalPin(false); } catch {}
  const zoomGroup = document.getElementById('prevZoomGroup');
  if (zoomGroup) zoomGroup.style.display = 'none';
  const modal = document.getElementById('previewModal');
  if (modal) modal.style.display = 'none';
  currentPreviewClip = null;
  _previewGen++;

  try {
    if (_compactPreviewExpanded) {
      _compactPreviewExpanded = false;
      const restoreW = _compactPreExpandSize && _compactPreExpandSize.w ? _compactPreExpandSize.w : 360;
      const restoreH = _compactPreExpandSize && _compactPreExpandSize.h ? _compactPreExpandSize.h : 260;
      _compactPreExpandSize = null;
      if (window.dcDebugLog) {
        window.dcDebugLog('Frontend:Preview', 'Compact restore dispatched: restoring to ' + restoreW + 'x' + restoreH);
      }
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_window_size === 'function') {
        // Restoring is a real, persisting size: it puts the window back on the mode's preset.
        window.pywebview.api.set_window_size(restoreW, restoreH, true, true);
      } else if (typeof callHost === 'function') {
        callHost('set_window_size', [restoreW, restoreH, true, true]);
      }
    }
  } catch (_) {}

  // ── Deterministic Anchor Restoration ──
  // Do NOT call searchInput.focus(). Restore exact viewport offset for saved clip.id.
  try {
    const anchor = _previewAnchor;
    if (!anchor || anchor.id == null) {
      const lc = document.getElementById('listContainer');
      if (lc) {
        if (!lc.hasAttribute('tabindex')) lc.setAttribute('tabindex', '-1');
        try { lc.focus({ preventScroll: true }); } catch { try { lc.focus(); } catch {} }
      }
      try { window.__previewAnchorPending = false; window.__previewAnchor = null; } catch {}
      _previewAnchor = null;
      return;
    }
    // Keep pending true so generic modals.js restoreFocus skips searchInput
    try { window.__previewAnchorPending = true; } catch {}
    const container = document.getElementById('listContainer');
    if (!container) { _previewAnchor = null; try { window.__previewAnchorPending = false; } catch {} return; }

    let targetTop = null;
    try {
      if (typeof currentFlatItems !== 'undefined' && Array.isArray(currentFlatItems)) {
        const found = currentFlatItems.find(it => it.type === 'clip' && it.clip && it.clip.id === anchor.id);
        if (found) targetTop = found.top;
      }
    } catch {}

    let newScrollTop;
    if (targetTop !== null && typeof anchor.viewportOffset === 'number' && anchor.viewportOffset !== null) {
      newScrollTop = targetTop - anchor.viewportOffset;
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      newScrollTop = Math.max(0, Math.min(newScrollTop, maxScroll));
    } else {
      newScrollTop = anchor.scrollTop;
    }

    container.scrollTop = newScrollTop;
    try { if (typeof renderVirtualWindow === 'function') renderVirtualWindow(); } catch {}

    requestAnimationFrame(() => {
      try {
        container.scrollTop = newScrollTop;
        try { if (typeof renderVirtualWindow === 'function') renderVirtualWindow(); } catch {}
        requestAnimationFrame(() => {
          try {
            container.scrollTop = newScrollTop;
            let curIdx = -1;
            try {
              if (typeof clips !== 'undefined' && Array.isArray(clips)) curIdx = clips.findIndex(c => c && c.id === anchor.id);
            } catch {}
            let rowEl = null;
            if (curIdx >= 0) { try { rowEl = document.querySelector(`.clip-row[data-idx="${curIdx}"]`); } catch {} }
            if (!rowEl && typeof anchor.idx === 'number' && anchor.idx >= 0) {
              try { rowEl = document.querySelector(`.clip-row[data-idx="${anchor.idx}"]`); } catch {}
            }
            if (rowEl) {
              if (!rowEl.hasAttribute('tabindex')) rowEl.setAttribute('tabindex', '-1');
              try { rowEl.focus({ preventScroll: true }); } catch { try { rowEl.focus(); } catch {} }
              if (container.scrollTop !== newScrollTop) container.scrollTop = newScrollTop;
            } else {
              if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
              try { container.focus({ preventScroll: true }); } catch { try { container.focus(); } catch {} }
              container.scrollTop = newScrollTop;
            }
          } catch {}
          try { window.__previewAnchorPending = false; window.__previewAnchor = null; } catch {}
          _previewAnchor = null;
        });
      } catch {}
    });
  } catch {}
}

function copyPreviewContent() {
  if (currentPreviewClip) {
    if (currentPreviewClip.is_image) {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.copy_clip === 'function') {
        window.pywebview.api.copy_clip(currentPreviewClip.id)
          .then(res => {
            if (!res || !res.ok) {
              if (typeof handleCopyImageError === 'function') handleCopyImageError();
              else if (typeof showToast === 'function') showToast('Failed to copy image');
            }
          })
          .catch(() => {
            if (typeof handleCopyImageError === 'function') handleCopyImageError();
            else if (typeof showToast === 'function') showToast('Failed to copy image');
          });
      } else {
        if (typeof handleCopyImageError === 'function') handleCopyImageError();
        else if (typeof showToast === 'function') showToast('Failed to copy image');
      }
    } else {
      if (typeof setClipboardTextSafely === 'function') {
        setClipboardTextSafely(currentPreviewClip.text_content || currentPreviewClip.preview || '');
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(currentPreviewClip.text_content || currentPreviewClip.preview || '').catch(() => {});
      }
    }
  }
}

window.openFullPreviewModal = openFullPreviewModal;
window.closePreviewModal = closePreviewModal;
window.togglePreviewWrap = togglePreviewWrap;
window.copyPreviewContent = copyPreviewContent;
window.changePreviewZoom = changePreviewZoom;

function savePreviewClip() {
  if (!currentPreviewClip || currentPreviewClip.is_image) return;
  const textBody = document.getElementById('prevContent');
  const newText = textBody ? textBody.value : '';
  if (!newText.trim()) {
    if (typeof showToast === 'function') showToast('Clip content cannot be empty');
    return;
  }
  const clipId = currentPreviewClip.id;
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.update_clip === 'function') {
    window.pywebview.api.update_clip(clipId, newText).then(res => {
      if (res && res.ok) {
        currentPreviewClip.text_content = newText;
        currentPreviewClip.preview = newText.length <= 120 ? newText.replace(/[\r\n]+/g, ' ') : newText.replace(/[\r\n]+/g, ' ').substring(0, 120) + '…';
        currentPreviewClip.char_count = newText.length;
        if (Array.isArray(window.allClips)) {
          const found = window.allClips.find(c => c.id === clipId);
          if (found) {
            found.text_content = newText;
            found.preview = currentPreviewClip.preview;
            found.char_count = newText.length;
          }
        }
        const saveBtn = document.getElementById('prevSaveBtn');
        if (saveBtn) saveBtn.style.display = 'none';
        if (typeof showToast === 'function') showToast('Saved changes');
        if (typeof renderList === 'function') renderList();
      } else {
        if (typeof showToast === 'function') showToast("Couldn't update clip");
      }
    }).catch(() => {
      if (typeof showToast === 'function') showToast("Couldn't update clip");
    });
  }
}
window.savePreviewClip = savePreviewClip;

// --- DualClip Tooltips, Popovers & Toast Notifications ---

let globalInfoTooltipTimer = null;
let activeTooltipTarget = null;
const TOOLTIP_HOVER_DELAY_MS = 1000;

function getTooltipElement() {
  let tip = document.getElementById('globalInfoTooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'globalInfoTooltip';
    tip.className = 'smart-tooltip global-info-tooltip';
    document.body.appendChild(tip);
  }
  return tip;
}

function getElementTooltipText(el) {
  if (!el || el === document.body || el === document.documentElement) return null;
  if (el.getAttribute('data-tooltip')) return el.getAttribute('data-tooltip');
  if (el.getAttribute('data-info')) return el.getAttribute('data-info');
  if (el.hasAttribute('title') && el.getAttribute('title')) {
    const text = el.getAttribute('title');
    el.setAttribute('data-tooltip', text);
    el.removeAttribute('title'); // Suppress native browser tooltip
    return text;
  }
  return null;
}

function findTooltipTarget(startEl) {
  let curr = startEl;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    const text = getElementTooltipText(curr);
    if (text && text.trim().length > 0) return curr;
    curr = curr.parentElement;
  }
  return null;
}




function positionGlobalTooltip(target, tip) {
  if (!target || !tip) return;
  const rect = target.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const OFFSET = 12;
  const EDGE_PADDING = 8;
  let left, top;
  let isBelow = false;
  // Priority 1: Right side, vertically centered
  const rightLeft = rect.right + OFFSET;
  const rightTop = rect.top + (rect.height / 2) - (tipRect.height / 2);
  if (rightLeft + tipRect.width <= window.innerWidth - EDGE_PADDING) {
    left = rightLeft;
    top = Math.max(EDGE_PADDING, Math.min(rightTop, window.innerHeight - tipRect.height - EDGE_PADDING));
  } else {
    // Priority 2: Left side
    const leftLeft = rect.left - tipRect.width - OFFSET;
    const leftTop = rect.top + (rect.height / 2) - (tipRect.height / 2);
    if (leftLeft >= EDGE_PADDING) {
      left = leftLeft;
      top = Math.max(EDGE_PADDING, Math.min(leftTop, window.innerHeight - tipRect.height - EDGE_PADDING));
    } else {
      // Priority 3: Top (above)
      const topLeft = rect.left + (rect.width / 2) - (tipRect.width / 2);
      const topTop = rect.top - tipRect.height - OFFSET;
      left = Math.max(EDGE_PADDING, Math.min(topLeft, window.innerWidth - tipRect.width - EDGE_PADDING));
      top = Math.max(EDGE_PADDING, topTop);
      // if still not enough space above, fallback to below
      if (top < EDGE_PADDING) {
        top = rect.bottom + OFFSET;
        isBelow = true;
        top = Math.min(top, window.innerHeight - tipRect.height - EDGE_PADDING);
      }
    }
  }
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.style.pointerEvents = 'none';
  tip.classList.toggle('tooltip-below', isBelow);
}

function showGlobalInfoTooltip(e) {
  const target = (e && e.currentTarget) ? e.currentTarget : (e && e.nodeType === 1 ? e : findTooltipTarget(e && e.target ? e.target : e));
  if (!target) return;

  if (target === activeTooltipTarget && globalInfoTooltipTimer) return;

  hideGlobalInfoTooltip();
  activeTooltipTarget = target;

  const text = getElementTooltipText(target);
  if (!text) return;

  globalInfoTooltipTimer = setTimeout(() => {
    if (activeTooltipTarget !== target) return;
    const tip = getTooltipElement();

    const isLight = document.body.classList.contains('theme-light') || document.documentElement.getAttribute('data-theme') === 'light';
    tip.setAttribute('data-theme', isLight ? 'light' : 'dark');

    tip.textContent = text;

    tip.style.left = '-9999px';
    tip.style.top = '-9999px';
    tip.classList.remove('visible');

    requestAnimationFrame(() => {
      if (activeTooltipTarget !== target) return;
      positionGlobalTooltip(target, tip);
      tip.classList.add('visible');
    });
  }, TOOLTIP_HOVER_DELAY_MS);
}

function hideGlobalInfoTooltip() {
  if (globalInfoTooltipTimer) {
    clearTimeout(globalInfoTooltipTimer);
    globalInfoTooltipTimer = null;
  }
  activeTooltipTarget = null;
  const tip = document.getElementById('globalInfoTooltip');
  if (tip) {
    tip.classList.remove('visible');
  }
}

(function initGlobalTooltipDelegation() {
  document.addEventListener('mouseover', (e) => {
    const target = findTooltipTarget(e.target);
    if (!target) {
      if (activeTooltipTarget && !e.target.closest('#globalInfoTooltip')) {
        hideGlobalInfoTooltip();
      }
      return;
    }
    showGlobalInfoTooltip(target);
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (!activeTooltipTarget) return;
    if (e.relatedTarget && activeTooltipTarget.contains(e.relatedTarget)) return;
    hideGlobalInfoTooltip();
  }, true);

  document.addEventListener('mousemove', (e) => {
    
    
  }, { passive: true, capture: true });

  document.addEventListener('mousedown', hideGlobalInfoTooltip, true);
  window.addEventListener('scroll', hideGlobalInfoTooltip, true);
  window.addEventListener('blur', hideGlobalInfoTooltip);
})();
let toastQueue = [];
let isToastActive = false;

function showToast(msg, options) {
  try {
    const toastsEnabled = localStorage.getItem('dualclip_toasts_enabled') !== '0';
    if (!toastsEnabled) return;
  } catch(e) {}

  const toast = document.getElementById('toast');
  if (!toast) { isToastActive = false; toastQueue = []; return; }

  if (isToastActive) {
    toastQueue.push({ msg, options });
    return;
  }

  isToastActive = true;
  toast.innerHTML = '';
  
  const textSpan = document.createElement('span');
  textSpan.textContent = msg;
  toast.appendChild(textSpan);

  if (options && options.actionLabel && typeof options.onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-action-btn';
    actionBtn.textContent = options.actionLabel;
    actionBtn.onclick = (e) => {
      e.stopPropagation();
      options.onAction();
      toast.classList.remove('show');
      toast.style.pointerEvents = 'none';
      clearTimeout(toast._hideTimer);
      isToastActive = false;
      if (toastQueue.length > 0) {
        const next = toastQueue.shift();
        setTimeout(() => showToast(next.msg, next.options), 100);
      }
    };
    toast.appendChild(actionBtn);
  }

  toast.classList.add('show');
  toast.style.pointerEvents = 'auto';

  clearTimeout(toast._hideTimer);
  const duration = (options && options.duration) || 2400;
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove('show');
    toast.style.pointerEvents = 'none';
    isToastActive = false;
    if (toastQueue.length > 0) {
      const next = toastQueue.shift();
      setTimeout(() => showToast(next.msg, next.options), 150);
    }
  }, duration);
}

function handleCopyImageResult(res) { showToast(res && res.ok ? 'Image copied' : "Couldn't copy image"); }
function handleCopyImageError() { showToast("Couldn't copy image"); }
function showLabelSaveError() {
  showToast("Couldn't save label");
}
function showCollectionNameError() { showToast('Please enter a collection name'); }

window.showGlobalInfoTooltip = showGlobalInfoTooltip;
window.hideGlobalInfoTooltip = hideGlobalInfoTooltip;
window.showToast = showToast;
window.handleCopyImageResult = handleCopyImageResult;
window.handleCopyImageError = handleCopyImageError;
window.showLabelSaveError = showLabelSaveError;
window.showCollectionNameError = showCollectionNameError;

// === Alt-Hover Floating Preview Popover (Pure Content Preview) ===
(function initFloatingPreview() {
  let hoveredClipRow = null;
  let popoverEl = null;
  let holdTimer = null;
  let lastWindowShowTime = 0;

  function isInputFocused() {
    try {
      const active = document.activeElement;
      if (!active) return false;
      return !!active.closest('input, textarea, [contenteditable="true"], select');
    } catch (_) {
      return false;
    }
  }

  function isModalOpen() {
    try {
      if (document.body && (document.body.classList.contains('modal-open') || document.body.classList.contains('in-settings'))) {
        return true;
      }
      const modal = document.querySelector('.modal-overlay:not([style*="display: none"])');
      return !!modal;
    } catch (_) {
      return false;
    }
  }

  try {
    window.addEventListener('focus', () => { lastWindowShowTime = Date.now(); });
    // Hook onWindowShow if present
    if (typeof window.onWindowShow === 'function') {
      const origShow = window.onWindowShow;
      window.onWindowShow = function() {
        lastWindowShowTime = Date.now();
        try { origShow.apply(this, arguments); } catch (_) {}
      };
    }
  } catch (_) {}

  function getPopover() {
    if (!popoverEl) {
      popoverEl = document.getElementById('ctrlHoverPreviewPopover');
      if (!popoverEl) {
        popoverEl = document.createElement('div');
        popoverEl.id = 'ctrlHoverPreviewPopover';
        popoverEl.className = 'ctrl-hover-preview-popover';
        document.body.appendChild(popoverEl);
      }
    }
    return popoverEl;
  }

  function getClipForElement(rowEl) {
    if (!rowEl) return null;
    const idxAttr = rowEl.getAttribute('data-idx') || rowEl.getAttribute('data-index');
    if (idxAttr !== null) {
      const idx = parseInt(idxAttr, 10);
      if (!isNaN(idx) && typeof clips !== 'undefined' && Array.isArray(clips) && clips[idx]) {
        return clips[idx];
      }
    }
    const idAttr = rowEl.getAttribute('data-id');
    if (idAttr !== null && typeof clips !== 'undefined' && Array.isArray(clips)) {
      const clipId = parseInt(idAttr, 10);
      const found = clips.find(c => c && c.id === clipId);
      if (found) return found;
    }
    return null;
  }

  // Q2: this closure used to shadow escapeHtml with a copy that mapped any falsy value
  // to '' (so 0 and false rendered as empty), while the canonical one in
  // namespace.js preserves them. namespace.js is loaded first (index.html:1891), so the
  // global is available here. Both call sites below pass clip text, never a number.

  function cancelHoldTimer() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  let lastRenderedClipId = null;

  function showPreview(rowEl) {
    if (!rowEl || !rowEl.isConnected) return;
    if (isModalOpen() || isInputFocused()) return;

    const clip = getClipForElement(rowEl);
    if (!clip) return;

    const pop = getPopover();

    if (lastRenderedClipId !== clip.id) {
      const rawText = clip.text_content || clip.preview || '';
      const formatTag = clip.is_image ? 'IMAGE' : ((typeof getFormatTag === 'function' ? getFormatTag(rawText) : '') || 'TEXT').toUpperCase();

      let bodyHtml = '';
      if (clip.is_image) {
        const rawImg = clip.image_data || clip.thumbnail_data || '';
        const safeImg = typeof sanitizeImageSrc === 'function' ? sanitizeImageSrc(rawImg) : rawImg;
        const safeAttr = String(safeImg).replace(/"/g, '&quot;');
        bodyHtml = `<img class="ctrl-prev-img" src="${safeAttr}" alt="Preview" />`;
      } else if (formatTag === 'CODE' || formatTag === 'JSON') {
        const previewText = rawText.length > 2500 ? rawText.slice(0, 2500) + '\n\n[Truncated...]' : rawText;
        bodyHtml = `<pre class="ctrl-prev-code"><code>${escapeHtml(previewText)}</code></pre>`;
      } else {
        const previewText = rawText.length > 2500 ? rawText.slice(0, 2500) + '\n\n[Truncated...]' : rawText;
        bodyHtml = `${escapeHtml(previewText)}`;
      }

      // Pure Content (No Header, No Footer)
      pop.innerHTML = `<div class="ctrl-prev-body">${bodyHtml}</div>`;
      lastRenderedClipId = clip.id;
    }

    const rect = rowEl.getBoundingClientRect();
    const popW = 380;
    const popH = Math.min(300, pop.offsetHeight || 240);
    let left = rect.right + 14;
    if (left + popW > window.innerWidth - 12) {
      left = rect.left - popW - 14;
    }
    if (left < 8) {
      left = Math.max(8, window.innerWidth - popW - 8);
    }
    let top = rect.top + (rect.height / 2) - (popH / 2);
    top = Math.max(12, Math.min(top, window.innerHeight - popH - 12));

    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.classList.add('visible');
  }

  function scheduleShowPreview(rowEl, immediate = false) {
    cancelHoldTimer();
    if (!rowEl || !rowEl.isConnected) return;
    if (Date.now() - lastWindowShowTime < 280) return;
    if (isModalOpen() || isInputFocused()) return;

    if (immediate) {
      showPreview(rowEl);
      return;
    }
    holdTimer = setTimeout(() => {
      showPreview(rowEl);
      holdTimer = null;
    }, 120);
  }

  function hidePreview() {
    cancelHoldTimer();
    lastRenderedClipId = null;
    if (hoveredClipRow && !hoveredClipRow.isConnected) hoveredClipRow = null;
    if (popoverEl) {
      popoverEl.classList.remove('visible');
    }
  }

  // Pointer tracking
  document.addEventListener('pointerover', (e) => {
    const row = e.target.closest('.clip-row');
    if (row) {
      hoveredClipRow = row;
      // Modifier isolation: strictly single Alt (no Ctrl / Shift / Meta, not while typing/modal)
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && !isInputFocused() && !isModalOpen()) {
        const isAlreadyVisible = popoverEl && popoverEl.classList.contains('visible');
        scheduleShowPreview(row, isAlreadyVisible);
      }
    }
  }, true);

  document.addEventListener('pointerout', (e) => {
    const row = e.target.closest('.clip-row');
    if (row) {
      if (e.relatedTarget && row.contains(e.relatedTarget)) return;
      // Smooth row-to-row glide: if moving directly into another clip row, do not hide & flicker
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.clip-row')) return;
      if (hoveredClipRow === row) {
        hoveredClipRow = null;
      }
      hidePreview();
    }
  }, true);

  // Keyboard tracking
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') {
      if (!isInputFocused() && !isModalOpen()) {
        try { e.preventDefault(); } catch (_) {}
      }
      if (e.ctrlKey || e.shiftKey || e.metaKey || isInputFocused() || isModalOpen()) {
        hidePreview();
        return;
      }
      if (hoveredClipRow) {
        scheduleShowPreview(hoveredClipRow, false);
      }
    } else if (e.key === 'Escape' || e.ctrlKey || e.shiftKey || e.metaKey) {
      hidePreview();
    }
  }, true);

  window.addEventListener('keyup', (e) => {
    if (!e.altKey) {
      hidePreview();
    }
  }, true);

  window.addEventListener('blur', hidePreview);
  window.addEventListener('scroll', hidePreview, true);
  document.addEventListener('mousedown', () => {
    hidePreview();
  }, true);

  window.showAltHoverPreview = showPreview;
  window.hideAltHoverPreview = hidePreview;
  window.showShiftHoverPreview = showPreview;
  window.hideShiftHoverPreview = hidePreview;
  window.showCtrlHoverPreview = showPreview;
  window.hideCtrlHoverPreview = hidePreview;
})();



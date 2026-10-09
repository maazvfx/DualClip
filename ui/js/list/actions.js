// --- DualClip Actions, Transforms, Clear History & Pinning ---

function toggleWindowPin() {
  isWindowPinned = !isWindowPinned;
  const pinBtn = document.getElementById('pinWindowBtn');
  if (pinBtn) {
    pinBtn.classList.toggle('active', isWindowPinned);
    try { pinBtn.blur(); } catch {}
  }
  const pinBtnSearch = document.getElementById('pinWindowBtnSearch');
  if (pinBtnSearch) {
    pinBtnSearch.classList.toggle('active', isWindowPinned);
    try { pinBtnSearch.blur(); } catch {}
  }
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_pinned === 'function') {
    window.pywebview.api.set_pinned(isWindowPinned);
  }
}

/**
 * Parameterized clip flag mutator (pin / favorite) with full invariant safety.
 * Handles single & multi-selection, optimistic UI override maps, host RPC synchronization,
 * and entry-specific nuances (time_group recalculation, sorting, and collection counts).
 */
function toggleClipProperty(property, targetIndex = null, options = {}) {
  if (typeof clipFetchSeq !== 'undefined') ++clipFetchSeq;
  window._lastBackendQuery = null;

  const isPin = property === 'pin' || property === 'pinned';
  const flagField = isPin ? 'pinned' : 'favorite';
  const overrideMap = isPin ? (typeof pendingPinOverrides !== 'undefined' ? pendingPinOverrides : null)
                            : (typeof pendingFavOverrides !== 'undefined' ? pendingFavOverrides : null);
  const rpcMethod = isPin ? 'toggle_pin' : 'toggle_favorite';

  const anchorIdx = (typeof options.anchorIndex === 'number' && options.anchorIndex >= 0)
    ? options.anchorIndex
    : (targetIndex != null && targetIndex >= 0 ? targetIndex : (typeof selectedIndex !== 'undefined' ? selectedIndex : 0));

  let referenceClip = null;
  if (targetIndex != null && targetIndex >= 0 && Array.isArray(clips) && clips[targetIndex]) {
    referenceClip = clips[targetIndex];
  } else if (typeof selectedIndex !== 'undefined' && selectedIndex >= 0 && Array.isArray(clips) && clips[selectedIndex]) {
    referenceClip = clips[selectedIndex];
  } else if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && Array.isArray(clips)) {
    referenceClip = clips[Array.from(selectedIndices)[0]];
  }
  if (!referenceClip) return;

  const targetState = referenceClip[flagField] ? 0 : 1;
  const snapIds = (typeof snapshotSelectedIds === 'function') ? snapshotSelectedIds() : null;

  const isMulti = typeof selectedIndices !== 'undefined' && selectedIndices.size > 1 &&
    (targetIndex == null || selectedIndices.has(targetIndex));

  const itemsToUpdate = [];
  if (isMulti) {
    selectedIndices.forEach(i => {
      const it = clips[i];
      if (it) itemsToUpdate.push(it);
    });
  } else {
    itemsToUpdate.push(referenceClip);
  }

  itemsToUpdate.forEach(item => {
    const prevState = item[flagField] ? 1 : 0;
    item[flagField] = targetState;
    if (isPin && typeof calcClipTimeGroup === 'function') {
      item.time_group = calcClipTimeGroup(item);
    }
    if (overrideMap) {
      overrideMap.set(item.id, isPin ? { pinned: targetState, timestamp: Date.now() } : { favorite: targetState, timestamp: Date.now() });
    }
    if (Array.isArray(allClips)) {
      const matched = allClips.find(ac => ac && ac.id === item.id);
      if (matched) {
        matched[flagField] = targetState;
        if (isPin && typeof calcClipTimeGroup === 'function') {
          matched.time_group = calcClipTimeGroup(matched);
        }
      }
    }
    if (prevState !== targetState && window.pywebview && window.pywebview.api && typeof window.pywebview.api[rpcMethod] === 'function') {
      window.pywebview.api[rpcMethod](item.id);
    }
  });

  if (typeof renderCollectionPills === 'function') renderCollectionPills();
  if (!isPin && options.invalidateCounts !== false && typeof invalidateBackendColCounts === 'function') {
    invalidateBackendColCounts();
  }
  if (isPin && typeof sortAllClips === 'function') {
    sortAllClips();
  }
  if (typeof applyFilters === 'function') applyFilters();
  if (snapIds && typeof restoreSelectionByIds === 'function') {
    restoreSelectionByIds(snapIds, anchorIdx);
  }
  if (typeof renderList === 'function') renderList();
  if (typeof renderVirtualWindow === 'function') renderVirtualWindow();
}
window.toggleClipProperty = toggleClipProperty;

// Self-capture-safe clipboard write. Routes through the host so the Write is
// suppressed by SuppressNext() — otherwise copied/merged/transformed text would
// be re-ingested as a brand-new clip at the top of history. Falls back to
// navigator.clipboard in standalone browser mode (no host bridge).
function setClipboardTextSafely(text) {
  if (!text) return;
  const fallback = () => {
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); } catch(e) {}
  };
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_clipboard_text === 'function') {
    window.pywebview.api.set_clipboard_text(text).catch(fallback);
    return;
  }
  fallback();
}

async function resolveFullClipText(clip) {
  if (!clip || clip.is_image) return '';
  const currentText = clip.text_content || clip.preview || '';
  if (clip.char_count && clip.char_count > currentText.length && window.pywebview && window.pywebview.api) {
    const fetchFn = typeof window.pywebview.api.get_clip_text === 'function'
      ? window.pywebview.api.get_clip_text
      : (typeof window.pywebview.api.get_clip === 'function' ? window.pywebview.api.get_clip : null);
    if (fetchFn) {
      try {
        const full = await fetchFn(clip.id);
        if (typeof full === 'string') {
          clip.text_content = full;
          return full;
        } else if (full && typeof full.text === 'string') {
          clip.text_content = full.text;
          return full.text;
        }
      } catch (e) {}
    }
  }
  return currentText;
}

function cleanTrackingUrl(rawUrl) {
  if (!rawUrl) return '';
  const match = rawUrl.match(/https?:\/\/[^\s]+/i);
  let target = match ? match[0] : (rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  target = target.replace(/[.,;:!?)]+$/, '');
  try {
    const url = new URL(target);
    const host = url.hostname.toLowerCase();

    const isTwitter = host === 'x.com' || host === 'twitter.com' || host === 't.co' || host.endsWith('.x.com') || host.endsWith('.twitter.com');
    const isYouTube = host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
    const isAmazon = host === 'amazon.com' || host === 'amzn.to' || host.endsWith('.amazon.com') || host.includes('amazon.');

    const globalParams = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
      'gclid', 'gclsrc', 'dclid', 'gad_source', '_ga', '_gl', 'msclkid',
      'mc_cid', 'mc_eid', 'vero_id', 'vero_conv', 'wickedid', 'oly_enc_id', 'oly_anon_id',
      'fbclid', 'igshid', 'fb_action_ids', 'fb_action_types', 's_kwcid', 'ttclid', 'twclid'
    ]);
    const globalPrefixes = ['utm_', 'pd_rd_', 'pf_rd_', 'ref_'];

    const keysToDelete = [];
    url.searchParams.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (globalParams.has(lower) || globalPrefixes.some(p => lower.startsWith(p))) {
        keysToDelete.push(key);
        return;
      }
      if (isTwitter && (lower === 't' || lower === 's' || lower === 'ref_src' || lower === 'ref_url')) {
        keysToDelete.push(key);
        return;
      }
      if (isYouTube && (lower === 'si' || lower === 'feature' || lower === 'pp')) {
        keysToDelete.push(key);
        return;
      }
      if (isAmazon && (lower === 'tag' || lower === 'linkcode' || lower === 'ref' || lower === 'psc' || lower === '_encoding' || lower === 'th' || lower === 'smid' || lower === 'qid' || lower === 'sr' || lower === 'sprefix')) {
        keysToDelete.push(key);
        return;
      }
    });

    const hasAmazonPathRef = isAmazon && /\/ref=[^/?#]+/i.test(url.pathname);

    if (keysToDelete.length === 0 && !hasAmazonPathRef) {
      return target;
    }

    keysToDelete.forEach(k => url.searchParams.delete(k));
    
    if (hasAmazonPathRef) {
      url.pathname = url.pathname.replace(/\/ref=[^/?#]+/i, '');
    }

    let cleanedHref = url.href;
    if (url.pathname === '/' && !target.endsWith('/') && !url.search && !url.hash && cleanedHref.endsWith('/')) {
      cleanedHref = cleanedHref.slice(0, -1);
    }
    return cleanedHref;
  } catch (e) {
    return target;
  }
}

function contextAction(action) {
  if (typeof closeContextMenu === 'function') closeContextMenu();
  if (contextTargetIndex < 0 || contextTargetIndex >= clips.length) return;
  const clip = clips[contextTargetIndex];
  const isMulti = selectedIndices.size > 1 && selectedIndices.has(contextTargetIndex);

  // Guard against invoking single-only actions when multi-selection is active
  if (isMulti && (action === 'preview' || action === 'edit' || action === 'paste' || action === 'paste_delete' || action === 'open_url' || action === 'copy_clean_url')) {
    return;
  }

  // Guard against invoking text-only actions on image clips
  if (clip.is_image && (action === 'copy_plain' || action === 'edit' || action === 'transform' || action === 'open_url' || action === 'copy_clean_url')) {
    return;
  }

  if (action === 'preview') {
    if (typeof openFullPreviewModal === 'function') openFullPreviewModal(clip);
  } else if (action === 'rename') {
    if (typeof openRenameModal === 'function') openRenameModal(clip);
  } else if (action === 'edit') {
    if (typeof openEditClipModal === 'function') openEditClipModal(clip);
  } else if (action === 'nickname') {
    if (typeof openNicknameModal === 'function') openNicknameModal(clip);
  } else if (action === 'copy') {
    const isMultiCopy = selectedIndices.size > 1 && selectedIndices.has(contextTargetIndex);
    if (isMultiCopy) {
      const sorted = Array.from(selectedIndices).sort((a,b)=>a-b);
      const hasImage = sorted.some(i => clips[i] && clips[i].is_image);
      if (hasImage) {
        if (typeof showToast === 'function') showToast('Bulk copy: images skipped, copying text only');
      }
      (async () => {
        const textClips = sorted.map(i => clips[i]).filter(c => c && !c.is_image);
        const pieces = await Promise.all(textClips.map(c => resolveFullClipText(c)));
        const validPieces = pieces.filter(Boolean);
        const joined = validPieces.join('\n\n');
        if (joined) {
          setClipboardTextSafely(joined);
          if (typeof showToast === 'function') showToast(`Copied ${validPieces.length} clips`);
        }
      })();
      return;
    }
    if (clip.is_image) {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.copy_clip === 'function') {
        window.pywebview.api.copy_clip(clip.id)
          .then(res => {
            if (typeof handleCopyImageResult === 'function') handleCopyImageResult(res);
            else if (typeof showToast === 'function') showToast(res && res.ok ? 'Image copied' : "Couldn't copy image");
          })
          .catch(() => {
            if (typeof handleCopyImageError === 'function') handleCopyImageError();
            else if (typeof showToast === 'function') showToast("Couldn't copy image");
          });
      }
    } else {
      resolveFullClipText(clip).then(fullText => {
        if (fullText) {
          setClipboardTextSafely(fullText);
        }
      });
    }
  } else if (action === 'copy_plain') {
    const isMultiPlain = selectedIndices.size > 1 && selectedIndices.has(contextTargetIndex);
    if (isMultiPlain) {
      const sorted = Array.from(selectedIndices).sort((a,b)=>a-b);
      (async () => {
        const textClips = sorted.map(i => clips[i]).filter(c => c && !c.is_image);
        const pieces = await Promise.all(textClips.map(c => resolveFullClipText(c)));
        const plainPieces = pieces.map(p => (p || '').replace(/\r\n/g, '\n').trim()).filter(Boolean);
        const joined = plainPieces.join('\n\n');
        if (joined) {
          setClipboardTextSafely(joined);
          if (typeof showToast === 'function') showToast(`Copied plain ${plainPieces.length} clips`);
        }
      })();
      return;
    }
    if (!clip.is_image) {
      resolveFullClipText(clip).then(fullText => {
        if (fullText) {
          const plain = fullText.replace(/\r\n/g, '\n').trim();
          setClipboardTextSafely(plain);
        }
      });
    }
  } else if (action === 'paste') {
    if (typeof executePasteClip === 'function') {
      executePasteClip(clip, selectedIndex, true);
    } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.paste_clip === 'function') {
      window.pywebview.api.paste_clip(clip.id);
    }
  } else if (action === 'paste_delete') {
    executePasteDelete(clip);
  } else if (action === 'open_url') {
    const raw = (clip.text_content || clip.preview || '').trim();
    const match = raw.match(/https?:\/\/[^\s]+/i);
    let targetUrl = match ? match[0] : (raw.startsWith('http') ? raw : `https://${raw}`);
    targetUrl = targetUrl.replace(/[.,;:!?)]+$/, '');
    try {
      const parsed = new URL(targetUrl);
      window.open(parsed.href, '_blank');
      if (typeof showToast === 'function') showToast(`Opening link: ${parsed.href}`);
    } catch (err) {
      if (typeof showToast === 'function') showToast('Invalid URL format');
    }
  } else if (action === 'copy_clean_url') {
    (async () => {
      const fullText = await resolveFullClipText(clip);
      const raw = (fullText || clip.text_content || clip.preview || '').trim();
      const cleaned = cleanTrackingUrl(raw);
      if (cleaned) {
        setClipboardTextSafely(cleaned);
        if (typeof showToast === 'function') showToast('Clean URL copied to clipboard');
      }
    })();
  } else if (action === 'favorite') {
    toggleClipProperty('favorite', contextTargetIndex, { invalidateCounts: false });
  } else if (action === 'pin') {
    toggleClipProperty('pin', contextTargetIndex);
  } else if (action === 'merge') {
    mergeSelectedClips();
  } else if (action === 'delete') {
    if (selectedIndices.size > 1 && selectedIndices.has(contextTargetIndex)) {
      const deletedItems = [];
      const toDeleteIds = [];
      const MAX_UNDO_ITEMS = 25;
      const MAX_UNDO_BYTES = 2 * 1024 * 1024; // 2MB memory budget
      let totalBytesEstimate = 0;
      let canOfferUndo = selectedIndices.size <= MAX_UNDO_ITEMS;

      selectedIndices.forEach(i => {
        const item = clips[i];
        if (item) {
          toDeleteIds.push(item.id);
          allClips = allClips.filter(c => c.id !== item.id);
          if (canOfferUndo) {
            const str = JSON.stringify(item);
            totalBytesEstimate += (str ? str.length * 2 : 0);
            if (totalBytesEstimate > MAX_UNDO_BYTES) {
              canOfferUndo = false;
              deletedItems.length = 0;
            } else {
              deletedItems.push(JSON.parse(str));
            }
          }
        }
      });
      const anchorIdx = selectedIndices.size > 0 ? Math.min(...Array.from(selectedIndices)) : 0;
      clips = clips.filter((_, i) => !selectedIndices.has(i));
      selectedIndices.clear();
      selectedIndex = clips.length === 0 ? -1 : Math.min(anchorIdx, clips.length - 1);
      if (selectedIndex >= 0) selectedIndices.add(selectedIndex);
      lastAnchorIndex = selectedIndex >= 0 ? selectedIndex : 0;
      if (expandedIndex !== -1 && (expandedIndex >= clips.length || !clips[expandedIndex])) expandedIndex = -1;
      contextTargetIndex = -1;
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.delete_clip === 'function') {
        toDeleteIds.forEach(id => window.pywebview.api.delete_clip(id));
      }
      if (typeof applyFilters === 'function') applyFilters();
      if (typeof showToast === 'function') {
        const toastOptions = canOfferUndo && deletedItems.length > 0 ? {
          actionLabel: 'Undo',
          duration: 4000,
          onAction: async () => {
            const restoreApi = window.pywebview && window.pywebview.api && window.pywebview.api.restore_clip;
            for (const item of deletedItems) {
              if (typeof restoreApi === 'function') {
                try {
                  const res = await restoreApi(item);
                  if (res && res.clip) {
                    const uiClip = typeof formatClipForUI === 'function' ? formatClipForUI(res.clip) : res.clip;
                    allClips = [uiClip, ...allClips.filter(c => c.id !== uiClip.id)];
                  }
                } catch(e) {}
              } else {
                allClips = [item, ...allClips.filter(c => c.id !== item.id)];
              }
            }
            deletedItems.length = 0;
            if (typeof applyFilters === 'function') applyFilters();
            showToast(`Restored clips`);
          }
        } : { duration: 2500 };
        showToast(`Deleted ${toDeleteIds.length} clips`, toastOptions);
      }
    } else {
      // Route single context-menu deletes through the same backend-safe Undo
      // workflow as the row quick-delete button.
      quickDeleteClip(null, contextTargetIndex);
    }
  }
}

async function mergeSelectedClips() {
  if (!selectedIndices || selectedIndices.size < 2) return;

  // Collect selected clips in list order
  const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);
  const sourceClips = sortedIndices.map(idx => clips[idx]).filter(Boolean);
  if (sourceClips.length < 2) return;

  // Filter only text clips for merge; do NOT delete or consume image clips
  const textClips = sourceClips.filter(c => !c.is_image);
  const imageCount = sourceClips.filter(c => c.is_image).length;

  if (textClips.length < 2) {
    if (typeof showToast === 'function') showToast('At least 2 text clips are required to merge');
    return;
  }

  const mergedIds = textClips.map(c => c.id);
  const deletedItems = textClips.map(c => JSON.parse(JSON.stringify(c)));

  const textPieces = [];
  for (const c of textClips) {
    const content = await resolveFullClipText(c);
    if (content.trim()) textPieces.push(content.trim());
  }

  if (textPieces.length < 2) {
    if (typeof showToast === 'function') showToast('At least 2 text clips are required to merge');
    return;
  }

  const mergedText = textPieces.join('\n\n');
  const count = textPieces.length;

  const removeOriginals = () => {
    allClips = allClips.filter(c => !mergedIds.includes(c.id));
    clips = clips.filter(c => !mergedIds.includes(c.id));
    if (expandedIndex !== -1) expandedIndex = -1;
    if (contextTargetIndex !== -1) contextTargetIndex = -1;
  };

  const selectNewClip = (newClipId) => {
    selectedIndices.clear();
    if (newClipId != null) {
      const idx = clips.findIndex(c => c && c.id === newClipId);
      if (idx >= 0) {
        selectedIndex = idx;
        selectedIndices.add(idx);
        lastAnchorIndex = idx;
        return;
      }
    }
    selectedIndex = clips.length === 0 ? -1 : 0;
    if (selectedIndex >= 0) selectedIndices.add(selectedIndex);
    lastAnchorIndex = selectedIndex >= 0 ? selectedIndex : 0;
  };

  const showMergeUndo = (mergedId) => {
    const msg = imageCount > 0
      ? `${count} text clips merged into one (${imageCount} image${imageCount > 1 ? 's' : ''} skipped)`
      : `${count} clips merged into one`;
    if (typeof showToast !== 'function') return;
    showToast(msg, {
      actionLabel: 'Undo',
      duration: 4000,
      onAction: async () => {
        const restoreApi = window.pywebview && window.pywebview.api && window.pywebview.api.restore_clip;
        for (const item of deletedItems) {
          if (typeof restoreApi === 'function') {
            try {
              const res = await restoreApi(item);
              if (res && res.clip) {
                const uiClip = typeof formatClipForUI === 'function' ? formatClipForUI(res.clip) : res.clip;
                allClips = [uiClip, ...allClips.filter(c => c.id !== uiClip.id)];
              }
            } catch(e) {}
          } else {
            allClips = [item, ...allClips.filter(c => c.id !== item.id)];
          }
        }
        const restoredCount = deletedItems.length;
        deletedItems.length = 0;
        if (typeof applyFilters === 'function') applyFilters();
        if (typeof showToast === 'function') showToast(`Restored ${restoredCount} clips`);
      }
    });
  };

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.add_clip === 'function') {
    window.pywebview.api.add_clip(mergedText)
      .then(res => {
        if (res && res.ok) {
          // Delete originals so merge is NOT a duplicate machine
          const deleteApi = window.pywebview.api.delete_clip;
          mergedIds.forEach(id => {
            if (typeof deleteApi === 'function') {
              try { deleteApi(id); } catch(e) {}
            }
          });
          const dcIcon = (res && res.app_icon)
            || (typeof window !== 'undefined' && window.DUALCLIP_APP_ICON)
            || (Array.isArray(allClips) ? (allClips.find(c => c && c.app_icon && String(c.src_process || '').toLowerCase().includes('dualclip'))?.app_icon || '') : '');
          if (dcIcon && typeof window !== 'undefined') {
            window.DUALCLIP_APP_ICON = dcIcon;
          }
          const newMergedItem = typeof formatClipForUI === 'function' ? formatClipForUI({
            id: res.id,
            title: mergedText.slice(0, 60),
            text_content: mergedText,
            preview: mergedText.slice(0, 120),
            char_count: mergedText.length,
            is_image: false,
            pinned: 0,
            favorite: 0,
            src_process: 'DualClip',
            src_title: 'DualClip',
            app_icon: dcIcon,
            app_icon_data_url: dcIcon,
            collection: 'all',
            time_group: 'today',
            created_at: new Date().toISOString()
          }) : {
            id: res.id,
            text_content: mergedText,
            preview: mergedText,
            char_count: mergedText.length,
            is_image: false,
            pinned: 0,
            src_process: 'DualClip',
            app_icon: dcIcon,
            app_icon_data_url: dcIcon
          };
          removeOriginals();
          allClips = allClips.filter(c => c && c.id !== res.id && String(c.id) !== String(res.id));
          allClips.unshift(newMergedItem);
          if (typeof applyFilters === 'function') applyFilters();
          selectNewClip(res.id);
          if (typeof renderVirtualWindow === 'function') renderVirtualWindow();
          showMergeUndo(res.id);
        } else {
          if (typeof showToast === 'function') showToast("Couldn't merge clips");
        }
      })
      .catch(() => {
        if (typeof showToast === 'function') showToast("Couldn't merge clips");
      });
  } else {
    // Standalone browser mode fallback
    const newMock = typeof formatClipForUI === 'function' ? formatClipForUI({
      id: Date.now(),
      title: mergedText.slice(0, 60),
      text_content: mergedText,
      preview: mergedText.slice(0, 120),
      is_image: false,
      pinned: 0,
      src_process: 'DualClip',
      src_title: 'DualClip',
      collection: 'all',
      time_group: 'today',
      created_at: new Date().toISOString()
    }) : {
      id: Date.now(),
      text_content: mergedText,
      preview: mergedText,
      is_image: false,
      pinned: 0
    };

    removeOriginals();
    allClips.unshift(newMock);
    selectNewClip(newMock.id);
    if (typeof applyFilters === 'function') applyFilters();
    showMergeUndo(newMock.id);
  }
}

async function contextTransform(type) {
  if (typeof closeContextMenu === 'function') closeContextMenu();
  if (contextTargetIndex < 0 || contextTargetIndex >= clips.length) return;
  const isMultiTrans = selectedIndices.size > 1 && selectedIndices.has(contextTargetIndex);
  const transformOne = (raw) => {
    let txt = raw || '';
    if (type === 'upper') txt = txt.toUpperCase();
    else if (type === 'lower') txt = txt.toLowerCase();
    else if (type === 'title') txt = txt.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
    else if (type === 'trim' || type === 'trimmed') txt = txt.trim();
    else if (type === 'unwrap') txt = txt.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    else if (type === 'removeBlank') txt = txt.split(/\r?\n/).filter(line => line.trim().length > 0).join('\n');
    else if (type === 'single_line') txt = txt.replace(/\r?\n+/g, ' ').trim();
    else if (type === 'camel') txt = txt.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    else if (type === 'snake') txt = (txt.match(/[a-zA-Z0-9]+/g) || []).map(w => w.toLowerCase()).join('_');
    else if (type === 'kebab') txt = (txt.match(/[a-zA-Z0-9]+/g) || []).map(w => w.toLowerCase()).join('-');
    else if (type === 'slug') txt = txt.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
    else if (type === 'formatJson') { try { txt = JSON.stringify(JSON.parse(txt), null, 2); } catch(e) {} }
    else if (type === 'minifyJson') { try { txt = JSON.stringify(JSON.parse(txt)); } catch(e) {} }
    else if (type === 'encodeUrl') { try { txt = encodeURIComponent(txt); } catch(e) {} }
    else if (type === 'decodeUrl' || type === 'url_decode') { try { txt = decodeURIComponent(txt); } catch(e) {} }
    else if (type === 'dedupe') { const lines = txt.split(/\r?\n/); txt = [...new Set(lines)].join('\n'); }
    else if (type === 'sort') { txt = txt.split(/\r?\n/).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).join('\n'); }
    else if (type === 'joinComma') { txt = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join(', '); }
    return txt;
  };
  if (isMultiTrans) {
    const sorted = Array.from(selectedIndices).sort((a,b)=>a-b);
    const nonImageClips = sorted.map(i => clips[i]).filter(c => c && !c.is_image);
    if (nonImageClips.length === 0) {
      if (typeof showToast === 'function') showToast('Transform is not supported for image clips');
      return;
    }
    const rawPieces = await Promise.all(nonImageClips.map(c => resolveFullClipText(c)));
    const pieces = rawPieces.map(txt => transformOne(txt)).filter(Boolean);
    const joined = pieces.join('\n\n');
    if (joined) {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.paste_text === 'function') {
        window.pywebview.api.paste_text(joined);
      } else {
        setClipboardTextSafely(joined);
        const skippedCount = sorted.length - nonImageClips.length;
        if (typeof showToast === 'function') {
          if (skippedCount > 0) {
            showToast(`Transformed ${pieces.length} text clips → clipboard (skipped ${skippedCount} image${skippedCount > 1 ? 's' : ''})`);
          } else {
            showToast(`Transformed ${pieces.length} clips → clipboard`);
          }
        }
      }
    }
    return;
  }
  const clip = clips[contextTargetIndex];
  if (!clip || clip.is_image) {
    if (typeof showToast === 'function') showToast('Transform is not supported for image clips');
    return;
  }
  let txt = await resolveFullClipText(clip);
  txt = transformOne(txt);
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.paste_text === 'function') {
    window.pywebview.api.paste_text(txt);
  } else {
    setClipboardTextSafely(txt);
  }
}

function moveToCollection(colName) {
  if (typeof closeContextMenu === 'function') closeContextMenu();
  if (contextTargetIndex < 0 || contextTargetIndex >= clips.length) return;
  
  const customCol = customCollections.find(c => c.id === colName);
  const label = customCol ? customCol.name : (colName === 'all' ? 'All Clips' : colName);

  const _moveIds = (typeof snapshotSelectedIds === 'function') ? snapshotSelectedIds() : null;
  const _moveAnchor = contextTargetIndex;
  const idsToUpdate = [];
  if (selectedIndices.size > 1 && selectedIndices.has(contextTargetIndex)) {
    selectedIndices.forEach(i => {
      if (clips[i]) {
        clips[i].collection = colName;
        idsToUpdate.push(clips[i].id);
        if (Array.isArray(allClips)) {
          const m = allClips.find(ac => ac && ac.id === clips[i].id);
          if (m) m.collection = colName;
        }
      }
    });
  } else {
    clips[contextTargetIndex].collection = colName;
    idsToUpdate.push(clips[contextTargetIndex].id);
    if (Array.isArray(allClips)) {
      const m = allClips.find(ac => ac && ac.id === clips[contextTargetIndex].id);
      if (m) m.collection = colName;
    }
  }
  // Sync to backend with failure reconciliation
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.move_to_collection === 'function') {
    idsToUpdate.forEach(id => {
      try {
        const p = window.pywebview.api.move_to_collection(id, colName);
        if (p && typeof p.then === 'function') {
          p.then(res => {
            if (res && res.ok === false) {
              if (typeof showToast === 'function') showToast("Couldn't save the move — refreshing");
              if (typeof loadClipsFromBackend === 'function') { try { loadClipsFromBackend(); } catch (_) {} }
            }
          }).catch(() => {});
        }
      } catch (_) {}
    });
  }
  if (typeof applyFilters === 'function') applyFilters();
  if (_moveIds && typeof restoreSelectionByIds === 'function') restoreSelectionByIds(_moveIds, _moveAnchor);
}

function confirmClearAll() {
  showClearModal(
    'Clear History',
    'Select what to permanently delete from your clipboard history.',
    'Delete',
    false,
    true
  );
}

function toggleCollectionsExpand(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const arrow = document.getElementById('clearCollectionsMasterArrow');
  const list = document.getElementById('clearCollectionsList');
  if (list && arrow) {
    const isExpanded = list.style.display === 'flex';
    list.style.display = isExpanded ? 'none' : 'flex';
    arrow.classList.toggle('expanded', !isExpanded);
  }
}
window.toggleCollectionsExpand = toggleCollectionsExpand;

function toggleCollectionsCheck(isChecked) {
  const list = document.getElementById('clearCollectionsList');
  if (list) {
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = isChecked;
    });
  }
  updateClearModalStats();
}
window.toggleCollectionsCheck = toggleCollectionsCheck;

function toggleSingleColExpand(el, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const colId = (typeof el === 'string') ? el : (el && el.getAttribute ? el.getAttribute('data-arrow-col') : null);
  if (!colId) return;
  const sub = document.getElementById(`clearColSub_${colId}`);
  const btn = e && e.currentTarget ? e.currentTarget : document.querySelector(`.expand-arrow-btn[data-arrow-col="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(colId) : colId}"]`);
  if (sub) {
    const isExpanded = sub.style.display === 'flex';
    sub.style.display = isExpanded ? 'none' : 'flex';
    if (btn) btn.classList.toggle('expanded', !isExpanded);
  }
}
window.toggleSingleColExpand = toggleSingleColExpand;

function toggleSingleColCheck(el, isChecked) {
  const colId = (typeof el === 'string') ? el : (el && el.getAttribute ? el.getAttribute('data-col') : null);
  if (typeof isChecked === 'undefined' && el && typeof el.checked === 'boolean') isChecked = el.checked;
  if (!colId) return;
  const sub = document.getElementById(`clearColSub_${colId}`);
  if (sub) {
    sub.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = isChecked;
    });
  }
  updateClearModalStats();
}
window.toggleSingleColCheck = toggleSingleColCheck;

function updateClearModalStats() {
  const allRows = document.querySelectorAll('#clearScrollableList input[type="checkbox"]');
  const checkedRows = document.querySelectorAll('#clearScrollableList input[type="checkbox"]:checked');
  const selectAll = document.getElementById('clearSelectAll');
  const summary = document.getElementById('clearSelectionSummary');
  const confirmBtn = document.getElementById('clearModalConfirmBtn');

  // Update right-side badges to show clean count (e.g. '42 clips').
  // Badges carrying data-count (main rows + per-collection rows) render from
  // it; sub-rows without data-count keep their render-time text.
  allRows.forEach(cb => {
    const row = cb.closest('.clear-pill-row');
    if (!row) return;
    const badge = row.querySelector('.clear-row-badge');
    if (badge) {
      const dc = badge.getAttribute('data-count');
      if (dc !== null) {
        const labelType = dc === '1' ? 'clip' : 'clips';
        badge.innerText = `${dc} ${labelType}`;
      }
      if (cb.checked) {
        badge.style.color = 'var(--danger, #dc2626)';
        badge.style.fontWeight = '500';
      } else {
        badge.style.color = 'var(--text-muted)';
        badge.style.fontWeight = 'normal';
      }
    }
  });

  const allColCbs = document.querySelectorAll('.clear-col-delete-cb');
  const chosenCols = document.querySelectorAll('.clear-col-delete-cb:checked').length;
  const masterColCb = document.getElementById('clearDeleteCollectionsMaster');
  if (masterColCb && allColCbs.length > 0) {
    masterColCb.checked = chosenCols === allColCbs.length;
    masterColCb.indeterminate = chosenCols > 0 && chosenCols < allColCbs.length;
  }

  const colBadge = document.getElementById('clearColsMasterBadge');
  if (colBadge) {
    colBadge.textContent = `${chosenCols} selected`;
  }

  if (summary) {
    summary.innerText = `${checkedRows.length} of ${allRows.length} selected`;
  }
  if (selectAll) {
    selectAll.checked = allRows.length > 0 && checkedRows.length === allRows.length;
    selectAll.indeterminate = checkedRows.length > 0 && checkedRows.length < allRows.length;
  }
  if (confirmBtn) {
    confirmBtn.innerText = 'Delete';
    confirmBtn.disabled = checkedRows.length === 0;
    confirmBtn.style.opacity = checkedRows.length === 0 ? '0.4' : '1';
    confirmBtn.style.cursor = checkedRows.length === 0 ? 'not-allowed' : 'pointer';
  }
}

function toggleClearSelectAll(masterCb) {
  const allRows = document.querySelectorAll('#clearScrollableList input[type="checkbox"]');
  allRows.forEach(cb => {
    cb.checked = masterCb.checked;
  });
  updateClearModalStats();
}

async function showClearModal(title, message, confirmText, defaultDeletePinned = false, defaultDeleteUnpinned = true) {
  const modal = document.getElementById('clearConfirmModal');
  if (!modal) {
    if (window.confirm(`${title}\n\n${message}`)) {
      executeClearHistory();
    }
    return;
  }
  const titleEl = document.getElementById('clearModalTitle');
  if (titleEl) titleEl.innerText = title || 'Clear History';

  // Count metrics for general categories (in-memory estimates first)
  const unpinnedCount = (allClips || []).filter(c => !c.pinned && !c.is_image && (!c.collection || c.collection === 'all')).length;
  const imagesCount = (allClips || []).filter(c => c.is_image && (!c.collection || c.collection === 'all')).length;
  const pinnedCount = (allClips || []).filter(c => c.pinned && (!c.collection || c.collection === 'all')).length;
  const starredCount = (allClips || []).filter(c => c.favorite && (!c.collection || c.collection === 'all')).length;

  const bUnpinned = document.getElementById('clearBadgeUnpinned');
  if (bUnpinned) bUnpinned.setAttribute('data-count', unpinnedCount);
  const bImages = document.getElementById('clearBadgeImages');
  if (bImages) bImages.setAttribute('data-count', imagesCount);
  const bPinned = document.getElementById('clearBadgePinned');
  if (bPinned) bPinned.setAttribute('data-count', pinnedCount);
  const bStarred = document.getElementById('clearBadgeStarred');
  if (bStarred) bStarred.setAttribute('data-count', starredCount);

  const cbUnpinned = document.getElementById('clearDeleteUnpinned');
  if (cbUnpinned) cbUnpinned.checked = Boolean(defaultDeleteUnpinned);
  const cbImages = document.getElementById('clearDeleteImages');
  if (cbImages) cbImages.checked = Boolean(defaultDeleteUnpinned);
  const cbPinned = document.getElementById('clearDeletePinned');
  if (cbPinned) cbPinned.checked = Boolean(defaultDeletePinned);
  const cbStarred = document.getElementById('clearDeleteStarred');
  if (cbStarred) cbStarred.checked = false;

  const renderCollectionsList = (countsMap = null) => {
    const masterRow = document.getElementById('clearCollectionsMasterRow');
    const list = document.getElementById('clearCollectionsList');
    if (!list) return;
    list.innerHTML = '';
    const available = [];
    const seen = new Set();
    if (Array.isArray(customCollections)) {
      customCollections.forEach(c => {
        if (c && c.id && c.id !== 'all' && c.id !== 'pins' && c.id !== 'most_used' && !seen.has(c.id)) {
          available.push(c);
          seen.add(c.id);
        }
      });
    }
    if (countsMap && typeof countsMap === 'object') {
      const reserved = ['all', 'pins', 'most_used'];
      const retired = ['work', 'personal', 'code', 'templates'];
      Object.keys(countsMap).forEach(cid => {
        if (!cid || seen.has(cid)) return;
        const low = String(cid).toLowerCase();
        if (reserved.includes(low) || retired.includes(cid)) return;
        available.push({ id: cid, name: cid });
        seen.add(cid);
      });
    }
    if (available.length > 0) {
      if (masterRow) masterRow.style.display = 'flex';
      available.forEach(c => {
        let clipCount = 0;
        if (countsMap && Object.prototype.hasOwnProperty.call(countsMap, c.id)) {
          clipCount = countsMap[c.id] || 0;
        } else if (typeof getCollectionClipCount === 'function') {
          clipCount = getCollectionClipCount(c.id);
        }

        let pinnedInCol = 0, favInCol = 0;
        try {
          const clipsArr = (typeof allClips !== 'undefined' && Array.isArray(allClips)) ? allClips : [];
          pinnedInCol = clipsArr.filter(x => x && x.collection === c.id && x.pinned).length;
          favInCol = clipsArr.filter(x => x && x.collection === c.id && x.favorite).length;
        } catch (_) {}

        let detailHint = `${clipCount} clips`;
        if (pinnedInCol > 0 || favInCol > 0) {
          detailHint = `${clipCount} clips (${pinnedInCol} pinned · ${favInCol} fav)`;
        }

        const item = document.createElement('label');
        item.className = 'clear-pill-row';
        item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; border-radius: 5px; cursor: pointer; user-select: none; font-size: 11.5px;';
        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" class="clear-col-delete-cb" data-col="${escapeHtml(c.id)}" onchange="updateClearModalStats()" style="accent-color: var(--accent); cursor: pointer; width: 14px; height: 14px;">
            <span>${escapeHtml(c.name || c.id)}</span>
          </div>
          <span class="clear-row-badge" style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(detailHint)}</span>
        `;

        list.appendChild(item);
      });
    } else {
      if (masterRow) masterRow.style.display = 'none';
    }
    updateClearModalStats();
  };

  renderCollectionsList();
  modal.style.display = 'flex';

  // Live backend stats update
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_clear_stats === 'function') {
    try {
      const stats = await window.pywebview.api.get_clear_stats();
      if (stats && stats.ok) {
        if (bUnpinned && typeof stats.unpinned === 'number') bUnpinned.setAttribute('data-count', stats.unpinned);
        if (bImages && typeof stats.images === 'number') bImages.setAttribute('data-count', stats.images);
        if (bPinned && typeof stats.pinned === 'number') bPinned.setAttribute('data-count', stats.pinned);
        if (bStarred && typeof stats.starred === 'number') bStarred.setAttribute('data-count', stats.starred);
        renderCollectionsList(stats.collections);
      }
    } catch (_) {}
  }
}

function closeClearConfirmModal(event) {
  if (event && event.target && event.target !== event.currentTarget) return;
  const modal = document.getElementById('clearConfirmModal');
  if (modal) modal.style.display = 'none';
}

function executeClearHistory() {
  const confirmBtn = document.getElementById('clearModalConfirmBtn');
  if (confirmBtn && confirmBtn.disabled) return;

  const checkedRows = document.querySelectorAll('#clearScrollableList input[type="checkbox"]:checked');
  if (checkedRows.length === 0) return;

  const modal = document.getElementById('clearConfirmModal');
  if (modal) modal.style.display = 'none';

  const deleteUnpinned = document.getElementById('clearDeleteUnpinned')?.checked ?? true;
  const deleteImages = document.getElementById('clearDeleteImages')?.checked ?? true;
  const deletePinned = document.getElementById('clearDeletePinned')?.checked ?? false;
  const deleteStarred = document.getElementById('clearDeleteStarred')?.checked ?? false;

  // Fully selected custom collections (parent checkbox).
  const deleteColIds = [];
  try {
    document.querySelectorAll('.clear-col-delete-cb:checked').forEach(cb => {
      const col = cb.getAttribute('data-col');
      if (col) deleteColIds.push(col);
    });
  } catch (_) {}

  const subPinParents = [];
  const subStarParents = [];

  // Excluded (kept) collections: shield all collections that are NOT explicitly checked for full deletion
  const excludedCols = [];
  const knownColIds = new Set();
  if (Array.isArray(customCollections)) {
    customCollections.forEach(c => { if (c && c.id) knownColIds.add(c.id); });
  }
  document.querySelectorAll('.clear-col-delete-cb').forEach(cb => {
    const cid = cb.getAttribute('data-col');
    if (cid) knownColIds.add(cid);
  });
  if (Array.isArray(allClips)) {
    allClips.forEach(c => { if (c && c.collection && c.collection !== 'all' && c.collection !== 'pins' && c.collection !== 'most_used') knownColIds.add(c.collection); });
  }
  knownColIds.forEach(id => {
    if (!deleteColIds.includes(id)) {
      excludedCols.push(id);
    }
  });

  const keepPinned = !deletePinned;
  const keepStarred = !deleteStarred;
  const includePinned = deletePinned;

  // Mirrors the SQL scope predicates in DatabaseService.ClearHistory exactly.
// Pinned and Favorites are explicit, unconditional scopes: ticking either deletes
// matching clips outright, including clips that are both pinned and favorited.
// Main History and Images are broad scopes and skip anything the user protected
// by leaving Pinned or Favorites unticked.
const shouldKeep = (c) => {
    if (!c) return false;
    // 1. Custom collections
    if (c.collection && c.collection !== 'all' && c.collection !== 'pins' && c.collection !== 'most_used') {
      if (deleteColIds.includes(c.collection)) {
        if (!keepStarred && c.favorite) return false;
        if (includePinned && c.pinned) return false;
        if (keepStarred && c.favorite) return true;
        if (keepPinned && c.pinned) return true;
        return false;
      }
      return true; // Kept custom collection
    }

    // 2. Main History (unorganized clips)
    if (!keepStarred && c.favorite) return false;
    if (includePinned && c.pinned) return false;
    if (keepStarred && c.favorite) return true;
    if (keepPinned && c.pinned) return true;
    if (c.is_image) return !deleteImages;
    return !deleteUnpinned;
  };

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.clear_history === 'function') {
    window.pywebview.api.clear_history(includePinned, excludedCols, keepStarred, deleteUnpinned, deleteImages, subPinParents, subStarParents, deleteColIds)
      .then(res => {
        if (res && res.ok) {
          window._lastClearAt = Date.now();
          allClips = allClips.filter(c => shouldKeep(c));
          clips = clips.filter(c => shouldKeep(c));
          selectedIndex = 0;
          selectedIndices.clear();
          if (clips.length > 0) selectedIndices.add(0);
          lastAnchorIndex = 0;
          if (typeof renderList === 'function') { try { renderList({ forceFull: true }); } catch {} }
          if (typeof applyFilters === 'function') applyFilters();
          if (typeof loadClipsFromBackend === 'function') loadClipsFromBackend();

          if (typeof showToast === 'function') showToast('Selected history cleared');
        } else {
          const errMsg = res && res.error ? 'Clear failed: ' + res.error : "Couldn't clear history";
          if (typeof showToast === 'function') showToast(errMsg, 'error');
          if (typeof loadClipsFromBackend === 'function') loadClipsFromBackend();
        }
      })
      .catch(err => {
        console.error('Failed to clear history:', err);
        if (typeof showToast === 'function') showToast("Couldn't clear history", 'error');
        if (typeof loadClipsFromBackend === 'function') loadClipsFromBackend();
      });
  } else {
    if (typeof showToast === 'function') showToast('History controls are unavailable right now.');
  }
}

function quickCopyClip(event, idx) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  if (idx < 0 || idx >= clips.length) return;
  const clip = clips[idx];
  if (!clip) return;

  selectedIndex = idx;
  selectedIndices.clear();
  selectedIndices.add(idx);

  if (clip.is_image) {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.copy_clip === 'function') {
      window.pywebview.api.copy_clip(clip.id)
        .then(res => {
          if (!res || !res.ok) {
            if (typeof handleCopyImageError === 'function') handleCopyImageError();
            else if (typeof showToast === 'function') showToast("Couldn't copy image");
          }
        })
        .catch(() => {
          if (typeof handleCopyImageError === 'function') handleCopyImageError();
          else if (typeof showToast === 'function') showToast("Couldn't copy image");
        });
    }
  } else {
    if (clip.text_content || clip.preview) {
      setClipboardTextSafely(clip.text_content || clip.preview);
    }
  }

  const rowEl = event ? event.target.closest('.clip-row') : document.querySelector('.clip-row.selected');
  if (rowEl) {
    rowEl.classList.remove('copy-flash');
    void rowEl.offsetWidth;
    rowEl.classList.add('copy-flash');
    setTimeout(() => rowEl.classList.remove('copy-flash'), 350);
  }
}

function quickToggleFavorite(event, idx) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  toggleClipProperty('favorite', idx, { invalidateCounts: true, anchorIndex: typeof selectedIndex !== 'undefined' ? selectedIndex : idx });
}

function quickTogglePin(event, idx) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  toggleClipProperty('pin', idx, { anchorIndex: typeof selectedIndex !== 'undefined' ? selectedIndex : idx });
}

function quickDeleteClip(event, idx) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  if (idx < 0 || idx >= clips.length) return;
  const clip = clips[idx];
  if (!clip) return;

  if (typeof currentPreviewClip !== 'undefined' && currentPreviewClip && currentPreviewClip.id === clip.id) {
    if (typeof closePreviewModal === 'function') closePreviewModal();
  }

  // Deep-copy the full UI snapshot before removing it. Undo can therefore
  // restore the backend even if the toast is queued behind other messages.
  const deletedClip = JSON.parse(JSON.stringify(clip));
  const clipId = deletedClip.id;
  const survivingIds = (typeof snapshotSelectedIds === 'function') ? snapshotSelectedIds() : new Set();
  survivingIds.delete(clipId);

  allClips = allClips.filter(c => c.id !== clipId);
  clips.splice(idx, 1);

  if (survivingIds.size > 0 && typeof restoreSelectionByIds === 'function') {
    restoreSelectionByIds(survivingIds, Math.min(idx, Math.max(0, clips.length - 1)));
  } else {
    selectedIndices.clear();
    selectedIndex = Math.min(idx, Math.max(0, clips.length - 1));
    if (clips.length > 0) selectedIndices.add(selectedIndex);
    lastAnchorIndex = selectedIndex >= 0 ? selectedIndex : 0;
  }
  if (expandedIndex === idx) expandedIndex = -1;

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.delete_clip === 'function') {
    window.pywebview.api.delete_clip(clipId).catch(() => {
      // The Undo path below will surface a restore failure if the record was
      // not actually deleted; do not reinsert optimistically here.
    });
  }
  if (typeof invalidateBackendColCounts === 'function') invalidateBackendColCounts();

  if (typeof showToast === 'function') {
    showToast('Clip deleted', {
      actionLabel: 'Undo',
      duration: 4000,
      onAction: async () => {
        const restoreApi = window.pywebview && window.pywebview.api && window.pywebview.api.restore_clip;
        if (typeof restoreApi !== 'function') {
          allClips = [deletedClip, ...allClips.filter(c => c.id !== clipId)];
          if (typeof applyFilters === 'function') applyFilters();
          showToast('Clip restored locally');
          return;
        }

        try {
          const response = await restoreApi(deletedClip);
          if (!response || !response.ok || !response.clip) {
            showToast("Couldn't restore clip");
            return;
          }

          const restored = typeof formatClipForUI === 'function'
            ? formatClipForUI(response.clip)
            : response.clip;
          allClips = [restored, ...allClips.filter(c => c.id !== clipId)];
          if (typeof applyFilters === 'function') applyFilters();
          const restoredIndex = clips.findIndex(c => c.id === clipId);
          if (restoredIndex >= 0) {
            selectedIndex = restoredIndex;
            selectedIndices.clear();
            selectedIndices.add(restoredIndex);
          }
          if (typeof renderVirtualWindow === 'function') renderVirtualWindow();
          showToast('Clip restored');
        } catch (error) {
          showToast("Couldn't restore clip");
        }
      }
    });
  }

  if (typeof applyFilters === 'function') {
    applyFilters();
  } else if (typeof renderList === 'function') {
    renderList();
  }
}

// Interactive window resize handles (8-directional: all edges & corners)
(function initWindowResizeHandles() {
  let lastResizeClick = 0;
  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (document.body && document.body.classList.contains('in-settings')) return;
    const dir = e.currentTarget.getAttribute('data-resize-dir') || 'bottom-right';
    const now2 = Date.now();
    if (now2 - lastResizeClick < 350) {
      lastResizeClick = 0;
      e.preventDefault();
      e.stopPropagation();
      if (typeof resetWindowSizeCurrentMode === 'function') {
        resetWindowSizeCurrentMode();
      } else {
        let resetPreset = 'default';
        let resetLayout = 'standard';
        try {
          const layout = document.documentElement.getAttribute('data-layout-preset') || 'standard';
          if (layout === 'compact') { resetPreset = 'compact'; resetLayout = 'compact'; }
        } catch (_) {}
        if (typeof applyWindowSizePreset === 'function') {
          applyWindowSizePreset(resetPreset);
        } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.reset_window_size === 'function') {
          window.pywebview.api.reset_window_size(resetLayout);
        }
        if (typeof showToast === 'function') {
          showToast('Window size reset to default');
        }
      }
      return;
    }
    lastResizeClick = now2;
    e.preventDefault();
    e.stopPropagation();
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.start_resize === 'function') {
      window.pywebview.api.start_resize(dir);
    }
  }

  function attach() {
    const handles = document.querySelectorAll('.dc-resize-edge, .dc-resize-corner, #resizeHandle');
    handles.forEach(function(handle) {
      if (handle && !handle._resizeBound) {
        handle._resizeBound = true;
        handle.addEventListener('pointerdown', onPointerDown);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();

function executePasteDelete(clip) {
  if (!clip) return;
  const clipId = clip.id;
  if (typeof currentPreviewClip !== 'undefined' && currentPreviewClip && currentPreviewClip.id === clipId) {
    if (typeof closePreviewModal === 'function') closePreviewModal();
  }
  if (typeof showToast === 'function') {
    showToast('Pasting and deleting clip…');
  }
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.paste_delete === 'function') {
    window.pywebview.api.paste_delete(clipId).then(res => {
      if (res && res.ok) {
        const survivingIds = (typeof snapshotSelectedIds === 'function') ? snapshotSelectedIds() : new Set();
        survivingIds.delete(clipId);
        if (Array.isArray(allClips)) {
          allClips = allClips.filter(c => c.id !== clipId);
        }
        clips = clips.filter(c => c.id !== clipId);
        if (survivingIds.size > 0 && typeof restoreSelectionByIds === 'function') {
          restoreSelectionByIds(survivingIds);
        } else {
          selectedIndex = clips.length > 0 ? 0 : -1;
          selectedIndices.clear();
          if (selectedIndex >= 0) selectedIndices.add(0);
          lastAnchorIndex = 0;
        }
        if (typeof applyFilters === 'function') applyFilters();
        else if (typeof renderList === 'function') renderList();
      }
    }).catch(() => {});
  }
}

// Global & Namespace Exposure
window.toggleWindowPin = toggleWindowPin;
window.contextAction = contextAction;
window.contextTransform = contextTransform;
window.moveToCollection = moveToCollection;
window.confirmClearAll = confirmClearAll;
window.showClearModal = showClearModal;
window.closeClearConfirmModal = closeClearConfirmModal;
window.executeClearHistory = executeClearHistory;
window.quickCopyClip = quickCopyClip;
window.quickToggleFavorite = quickToggleFavorite;
window.quickTogglePin = quickTogglePin;
window.quickDeleteClip = quickDeleteClip;
window.executePasteDelete = executePasteDelete;
window.setClipboardTextSafely = setClipboardTextSafely;

window.DC = window.DC || {};
window.DC.actions = {
  toggleWindowPin,
  contextAction,
  contextTransform,
  moveToCollection,
  confirmClearAll,
  showClearModal,
  closeClearConfirmModal,
  executeClearHistory,
  quickCopyClip,
  quickToggleFavorite,
  quickTogglePin,
  quickDeleteClip,
  executePasteDelete,
  setClipboardTextSafely
};


// --- DualClip Context Menus & Submenus ---

function openContextMenu(e, idx) {
  e.preventDefault();
  contextTargetIndex = idx;
  const alreadySelected = selectedIndices.has(idx);
  if (!alreadySelected) {
    selectedIndices.clear();
    selectedIndices.add(idx);
    selectedIndex = idx;
    if (typeof lastAnchorIndex !== 'undefined') {
      lastAnchorIndex = idx;
    }
    const allRows = document.querySelectorAll('.clip-row');
    allRows.forEach(row => {
      const rowIdxAttr = row.getAttribute('data-idx') || row.getAttribute('data-index');
      const rowIdx = parseInt(rowIdxAttr, 10);
      if (rowIdx === idx) {
        row.classList.add('selected');
        row.setAttribute('aria-selected', 'true');
      } else {
        row.classList.remove('selected');
        row.setAttribute('aria-selected', 'false');
      }
    });
    if (typeof syncSelectedIds === 'function') syncSelectedIds();
  } else {
    selectedIndex = idx;
    // Preserve lastAnchorIndex for range selections
  }

  const clip = clips[idx];
  const menu = document.getElementById('contextMenu');
  if (!menu) return;

  menu.style.display = 'block';

  const transMenu = document.getElementById('ctxTransformMenu');
  const copyPlain = document.getElementById('ctxCopyPlain');
  const openUrl = document.getElementById('ctxOpenUrl');
  const favoriteLabel = document.getElementById('ctxFavoriteLabel');
  const pinLabel = document.getElementById('ctxPinLabel');
  const nickLabel = document.getElementById('ctxNicknameLabel');
  const renameLabel = document.getElementById('ctxRenameLabel');

  const isMulti = selectedIndices.size > 1 && selectedIndices.has(contextTargetIndex);
  const setDisabled = (el, disabled) => {
    if (!el) return;
    el.classList.toggle('disabled', disabled);
    el.style.opacity = disabled ? '0.45' : '';
    el.style.pointerEvents = disabled ? 'none' : '';
    el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  };
  if (favoriteLabel) {
    if (isMulti) {
      const favCount = Array.from(selectedIndices).filter(i => clips[i] && clips[i].favorite).length;
      const total = selectedIndices.size;
      if (favCount === total) favoriteLabel.innerText = 'Remove from Favorites';
      else if (favCount === 0) favoriteLabel.innerText = 'Add to Favorites';
      else favoriteLabel.innerText = clip.favorite ? 'Remove from Favorites' : 'Add to Favorites';
    } else {
      favoriteLabel.innerText = clip.favorite ? 'Remove from Favorites' : 'Add to Favorites';
    }
  }

  if (pinLabel) {
    if (isMulti) {
      const pinCount = Array.from(selectedIndices).filter(i => clips[i] && clips[i].pinned).length;
      const total = selectedIndices.size;
      if (pinCount === total) pinLabel.innerText = 'Unpin';
      else if (pinCount === 0) pinLabel.innerText = 'Pin to Top';
      else pinLabel.innerText = clip.pinned ? 'Unpin' : 'Pin to Top';
    } else {
      pinLabel.innerText = clip.pinned ? 'Unpin' : 'Pin to Top';
    }
  }

  if (renameLabel) {
    renameLabel.innerText = (clip.custom_title && clip.custom_title.trim())
      ? 'Rename Clip…'
      : 'Rename…';
  }

  if (nickLabel) {
    if (isMulti) {
      nickLabel.innerText = 'Add Tags…';
    } else {
      nickLabel.innerText = (clip.nickname && clip.nickname.trim())
        ? `Edit Tags…`
        : 'Add Tags…';
    }
  }
  // Bulk semantics: single-only items disabled when multi is active on member
  const previewItem = menu.querySelector(`[onclick="contextAction('preview')"]`);
  const renameItem = document.getElementById('ctxRenameItem') || menu.querySelector(`[onclick="contextAction('rename')"]`);
  const nicknameItem = menu.querySelector(`[onclick="contextAction('nickname')"]`);
  const pasteItem = menu.querySelector(`[onclick="contextAction('paste')"]`);
  const pasteDelItem = document.getElementById('ctxPasteDelete');
  const openUrlItem = document.getElementById('ctxOpenUrl');
  const cleanUrlItem = document.getElementById('ctxCleanUrl');
  const transItem = document.getElementById('ctxTransformMenu');
  setDisabled(previewItem, isMulti);
  setDisabled(renameItem, isMulti);
  setDisabled(nicknameItem, false);
  setDisabled(pasteItem, isMulti);
  setDisabled(pasteDelItem, isMulti);
  setDisabled(openUrlItem, isMulti || (openUrlItem && openUrlItem.style.display === 'none'));
  setDisabled(cleanUrlItem, isMulti || (cleanUrlItem && cleanUrlItem.style.display === 'none'));
  
  // Delete label with count
  const deleteItem = menu.querySelector(`[onclick="contextAction('delete')"]`);
  if (deleteItem) {
    const delLabel = deleteItem.querySelector('span');
    if (delLabel) delLabel.innerText = isMulti ? 'Delete Clips' : 'Delete Clip';
  }

  if (typeof renderContextCollectionMenu === 'function') {
    renderContextCollectionMenu();
  }

  if (clip.is_image) {
    if (transMenu) transMenu.style.display = 'none';
    if (copyPlain) copyPlain.style.display = 'none';
    if (openUrl) openUrl.style.display = 'none';
    if (cleanUrlItem) cleanUrlItem.style.display = 'none';
    const copyLbl = document.getElementById('ctxCopyLabel');
    if (copyLbl) copyLbl.innerText = 'Copy';
    const pasteLbl = document.getElementById('ctxPasteLabel');
    if (pasteLbl) pasteLbl.innerText = 'Paste Image';
    const prevLbl = document.getElementById('ctxPreviewLabel');
    if (prevLbl) prevLbl.innerText = 'Preview Image';
  } else {
    if (transMenu) transMenu.style.display = 'flex';
    if (copyPlain) copyPlain.style.display = 'flex';
    const isUrl = clip.type_name === 'Web Link' || clip.collection === 'web' || /^https?:\/\//i.test((clip.text_content || '').trim());
    if (openUrl) openUrl.style.display = isUrl ? 'flex' : 'none';
    if (cleanUrlItem) cleanUrlItem.style.display = isUrl ? 'flex' : 'none';
    const copyLbl = document.getElementById('ctxCopyLabel');
    if (copyLbl) copyLbl.innerText = 'Copy';
    const pasteLbl = document.getElementById('ctxPasteLabel');
    if (pasteLbl) pasteLbl.innerText = 'Paste';
    const prevLbl = document.getElementById('ctxPreviewLabel');
    if (prevLbl) prevLbl.innerText = 'Preview and Edit…';
  }
  if (isMulti) {
    const copyLblMulti = document.getElementById('ctxCopyLabel');
    if (copyLblMulti) copyLblMulti.innerText = 'Copy Clips';
  }

  const mergeItem = document.getElementById('ctxMergeClips');
  if (mergeItem) {
    const multiCount = selectedIndices && selectedIndices.size ? selectedIndices.size : 0;
    mergeItem.style.display = (multiCount >= 2 && selectedIndices.has(contextTargetIndex)) ? 'flex' : 'none';
    const mergeLbl = mergeItem.querySelector('span');
    if (mergeLbl) mergeLbl.innerText = 'Merge Clips';
  }

  const menuWidth = menu.offsetWidth || 220;
  const menuHeight = menu.offsetHeight || 340;
  const targetX = Math.max(10, Math.min(e.clientX, window.innerWidth - menuWidth - 10));
  const targetY = Math.max(10, Math.min(e.clientY, window.innerHeight - menuHeight - 10));
  menu.style.left = `${targetX}px`;
  menu.style.top = `${targetY}px`;

  initSubmenuListeners();
  menu.querySelectorAll('.has-submenu').forEach(el => positionSubmenu(el));
}

function positionSubmenu(itemEl) {
  if (!itemEl) return;
  const sub = itemEl.querySelector(':scope > .submenu');
  if (!sub) return;

  const isHidden = getComputedStyle(sub).display === 'none';
  if (isHidden) {
    sub.style.display = 'block';
    sub.style.visibility = 'hidden';
  }

  const subW = sub.offsetWidth || 190;
  const subH = sub.offsetHeight || 250;
  const parentRect = itemEl.getBoundingClientRect();
  const margin = 8;

  const spaceRight = window.innerWidth - parentRect.right - margin;
  const spaceLeft = parentRect.left - margin;

  if (spaceRight >= subW) {
    itemEl.classList.remove('open-left');
    sub.style.left = '';
    sub.style.right = '';
  } else if (spaceLeft >= subW) {
    itemEl.classList.add('open-left');
    sub.style.left = '';
    sub.style.right = '';
  } else {
    if (spaceRight >= spaceLeft) {
      itemEl.classList.remove('open-left');
      const overflowX = (parentRect.right + subW) - (window.innerWidth - margin);
      sub.style.left = `calc(100% - ${Math.max(0, overflowX)}px)`;
      sub.style.right = 'auto';
    } else {
      itemEl.classList.add('open-left');
      const overflowX = margin - (parentRect.left - subW);
      sub.style.right = `calc(100% - ${Math.max(0, overflowX)}px)`;
      sub.style.left = 'auto';
    }
  }

  const idealTopInWindow = parentRect.top - 4;
  const bottomInWindow = idealTopInWindow + subH;

  if (bottomInWindow > window.innerHeight - margin) {
    const overflowY = bottomInWindow - (window.innerHeight - margin);
    let newTop = -4 - overflowY;
    if (parentRect.top + newTop < margin) {
      newTop = margin - parentRect.top;
    }
    sub.style.top = `${Math.round(newTop)}px`;
    sub.style.bottom = 'auto';
  } else if (idealTopInWindow < margin) {
    sub.style.top = `${Math.round(margin - parentRect.top)}px`;
    sub.style.bottom = 'auto';
  } else {
    sub.style.top = '';
    sub.style.bottom = '';
  }

  if (isHidden) {
    sub.style.display = '';
    sub.style.visibility = '';
  }
}

function initSubmenuListeners() {
  document.querySelectorAll('.has-submenu').forEach(el => {
    if (el._submenuBound) return;
    el._submenuBound = true;
    el.addEventListener('mouseenter', () => {
      if (el._hideT) { clearTimeout(el._hideT); el._hideT = null; }
      el.classList.add('submenu-open');
      positionSubmenu(el);
    });
    el.addEventListener('mouseleave', () => {
      if (el._hideT) clearTimeout(el._hideT);
      el._hideT = setTimeout(() => el.classList.remove('submenu-open'), 300);
    });
  });
}
document.addEventListener('DOMContentLoaded', initSubmenuListeners);

function closeContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.style.display = 'none';
}

window.openContextMenu = openContextMenu;
window.positionSubmenu = positionSubmenu;
window.initSubmenuListeners = initSubmenuListeners;
window.closeContextMenu = closeContextMenu;

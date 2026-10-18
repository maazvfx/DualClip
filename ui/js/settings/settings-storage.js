// DualClip JS Module: settings-storage.js
// Auto-split from settings.js - complete functions, no mid-function cuts


function loadUsageStats() {
  if (!window.pywebview || !window.pywebview.api || typeof window.pywebview.api.get_usage_stats !== 'function') {
    return;
  }
  window.pywebview.api.get_usage_stats().then(res => {
    if (!res || !res.ok) return;
    renderUsageStatsDashboard(res);
  }).catch(() => {});
}


function renderUsageStatsDashboard(data) {
  if (!data) return;

  // 1. KPI Cards — always render (show 0 instead of dummy when empty)
  {
    const copiedVal = document.getElementById('kpiClipsCopiedVal');
    const copiedSub = document.getElementById('kpiClipsCopiedSub');
    const allCopies = data.allTimeCopies ?? data.totalCopies ?? 0;
    if (copiedVal) copiedVal.textContent = allCopies.toLocaleString();
    if (copiedSub) copiedSub.textContent = 'all-time total';
  }
  {
    const timeVal = document.getElementById('kpiTimeSavedVal');
    const timeSub = document.getElementById('kpiTimeSavedSub');
    const bentoMin = document.getElementById('bentoMinutesTotal');
    const bentoDays = document.getElementById('bentoWorkDaysTotal');
    const mins = typeof data.timeSavedMinutes === 'number' ? data.timeSavedMinutes : 0;
    const totalP = data.totalPastes ?? data.totalReuses ?? Math.round(mins * 18.75) ?? 0;
    if (timeVal) {
      if (mins >= 60) {
        const hrs = (mins / 60).toFixed(1);
        timeVal.innerHTML = `${hrs}<span class="bento-hero-unit">hrs</span>`;
      } else if (mins < 1 && totalP > 0) {
        const secs = Math.round(totalP * 3.2);
        timeVal.innerHTML = `${secs}<span class="bento-hero-unit">secs</span>`;
      } else {
        timeVal.innerHTML = `${Math.round(mins)}<span class="bento-hero-unit">mins</span>`;
      }
    }
    if (timeSub) {
      if (mins > 0) {
        timeSub.innerHTML = `
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--success, #10b981)" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
          <span>~3.2s saved per paste</span>
        `;
      } else {
        timeSub.innerHTML = `
          <span style="color: var(--text-muted);">~3.2s estimated per paste</span>
        `;
      }
    }
    const footerContainer = document.getElementById('bentoHeroFooterContent') || document.getElementById('bentoHeroFooter');
    if (footerContainer) {
      if (totalP > 0) {
        const weeklyP = data.weeklyPastes ?? 0;
        const weekStr = weeklyP > 0 ? `<span><strong style="color: var(--text); font-weight: 600;">${weeklyP.toLocaleString()}</strong> this week</span><span style="color: var(--border);">·</span>` : '';
        footerContainer.innerHTML = `
          <span><strong style="color: var(--text); font-weight: 600;">~3.2s</strong> × ${totalP.toLocaleString()} pastes</span>
          <span style="color: var(--border);">·</span>
          ${weekStr}
          <span><strong style="color: var(--text); font-weight: 600;">4.2x</strong> faster</span>
        `;
      } else {
        footerContainer.innerHTML = `<span>Paste clips from DualClip to start tracking time saved</span>`;
      }
    }
  }
  // History Pastes
  {
    const pastesVal = document.getElementById('kpiPastesVal') || document.getElementById('kpiStreakVal');
    const pastesSub = document.getElementById('kpiPastesSub') || document.getElementById('kpiStreakSub');
    const totalP = data.totalPastes ?? data.totalReuses ?? 0;
    if (pastesVal) {
      pastesVal.textContent = totalP.toLocaleString();
    }
    if (pastesSub) {
      pastesSub.textContent = 'all-time total';
    }
    // Mirror into Storage Glance usage strip
    const glanceCopied = document.getElementById('glanceCopiedVal');
    if (glanceCopied) glanceCopied.textContent = (data.allTimeCopies ?? data.totalCopies ?? 0).toLocaleString();
    const glancePastes = document.getElementById('glancePastesVal');
    if (glancePastes) glancePastes.textContent = totalP.toLocaleString();
    const glanceTime = document.getElementById('glanceTimeSavedVal');
    if (glanceTime) {
      const mins = typeof data.timeSavedMinutes === 'number' ? data.timeSavedMinutes : 0;
      if (mins >= 60) {
        glanceTime.textContent = `${(mins / 60).toFixed(1)} hrs`;
      } else if (mins < 1 && totalP > 0) {
        glanceTime.textContent = `${Math.round(totalP * 3.2)} secs`;
      } else {
        glanceTime.textContent = `${Math.round(mins)} mins`;
      }
    }
  }
  // 2. Top Source Applications (Refined Option B: Single Segmented Meter Bar + App Rows)
  const appsList = document.getElementById('statsTopAppsList');
  if (appsList) {
    if (data.topApps && data.topApps.length > 0) {
      const top3 = data.topApps.slice(0, 3);
      const palette = [
        'var(--accent)',
        'var(--success, #10b981)',
        'var(--amber, #f59e0b)'
      ];
      
      // Calculate top 3 sum to see if an "Others" segment is needed
      const top3Sum = top3.reduce((sum, a) => sum + (a.percent || 0), 0);
      const othersPct = Math.max(0, 100 - top3Sum);

      const segmentsHtml = top3.map((a, i) => {
        const pct = Math.min(100, Math.max(0, a.percent || 0));
        const color = palette[i % palette.length];
        const name = a.name || a.process || 'Unknown';
        return `<div style="width: ${pct}%; background: ${color};" title="${escapeHtml(name)}: ${pct}%"></div>`;
      }).join('') + (othersPct > 0 ? `<div style="width: ${othersPct}%; background: color-mix(in srgb, var(--text-muted) 35%, transparent);" title="Others: ${othersPct}%"></div>` : '');

      const meterBarHtml = `
        <div style="height: 6px; border-radius: 4px; background: color-mix(in srgb, var(--border) 60%, transparent); display: flex; overflow: hidden; margin-bottom: 10px; gap: 2px;">
          ${segmentsHtml}
        </div>
      `;

      const rowsHtml = top3.map((a, i) => {
        const name = a.name || a.process || 'Unknown';
        const safeName = typeof escapeHtml === 'function' ? escapeHtml(name) : name;
        const pct = Math.min(100, Math.max(0, a.percent || 0));
        const count = a.count || a.copies || 0;
        const countStr = count > 0 ? `<span style="color: var(--text-muted); font-size: 10.5px; font-weight: normal; margin-left: 4px;">(${count.toLocaleString()})</span>` : '';
        const color = palette[i % palette.length];
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; padding: 3px 0;">
            <div style="display: flex; align-items: center; gap: 7px;">
              <span style="width: 7px; height: 7px; border-radius: 50%; background: ${color}; display: inline-block; flex-shrink: 0;"></span>
              <span style="color: var(--text); font-weight: 500;">${safeName}</span>
            </div>
            <div style="font-feature-settings: 'tnum'; display: flex; align-items: baseline; gap: 4px;">
              <strong style="color: var(--text); font-weight: 600;">${pct}%</strong>${countStr}
            </div>
          </div>
        `;
      }).join('');

      appsList.innerHTML = meterBarHtml + `<div style="display: flex; flex-direction: column; gap: 6px;">${rowsHtml}</div>`;
    } else {
      appsList.innerHTML = `<div style="font-size:11.5px;color:var(--text-sub);padding:6px 0;">No app data yet.</div>`;
    }
  }

  // 3. Most Reused Clips — Numbered Rank Leaderboard (Strictly Top 3)
  const reusedList = document.getElementById('statsReusedClipsList');
  const reusedData = data.topReused || data.topClips || data.topReusedClips;
  if (reusedList) {
    if (reusedData && reusedData.length > 0) {
      reusedList.innerHTML = reusedData.slice(0, 3).map((c, idx) => {
        const text = c.text || c.content || '';
        const safeText = typeof escapeHtml === 'function' ? escapeHtml(text) : text;
        const count = c.useCount || c.reuseCount || c.count || 0;
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-radius: 8px; background: color-mix(in srgb, var(--card-bg) 50%, var(--border) 50%); border: 1px solid var(--border); transition: all 0.12s ease;">
            <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1; margin-right: 8px;">
              <span style="font-size: 10px; font-weight: 700; color: ${idx === 0 ? 'var(--text)' : 'var(--text-sub)'}; background: var(--tag-bg, #181818); padding: 2px 6px; border-radius: 5px; border: 1px solid var(--border); flex-shrink: 0;">#${idx + 1}</span>
              <span style="font-size: 11px; font-family: var(--font-mono, monospace); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${safeText}">${safeText}</span>
            </div>
            <span style="font-size: 11px; color: var(--text-sub); font-weight: 600; white-space: nowrap; flex-shrink: 0;">${count.toLocaleString()} pastes</span>
          </div>
        `;
      }).join('');
    } else {
      reusedList.innerHTML = `<div style="font-size:11.5px;color:var(--text-sub);padding:6px 0;">No reused clips yet — paste a clip multiple times to see it here.</div>`;
    }
  }
}






function changeMaxClipsSetting(val) {
  try { localStorage.setItem('dualclip_max_clips', val); } catch(e) {}
  const maxClips = val === 'unlimited' ? 0 : parseInt(val, 10);
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_max_clips === 'function') {
    window.pywebview.api.set_max_clips(maxClips);
  }
  notifySettingSaved('row_max_clips');
}

function changeAutoExpireSetting(val) {
  const settingVal = String(val || '0');
  try { localStorage.setItem('dualclip_auto_expire_days', settingVal); } catch(e) {}

  let hours = 0;
  if (settingVal === '1h') hours = 1;
  else if (settingVal === '6h') hours = 6;
  else {
    const days = parseFloat(settingVal) || 0;
    hours = days * 24;
  }

  if (window.pywebview && window.pywebview.api) {
    if (typeof window.pywebview.api.set_auto_expire_hours === 'function') {
      window.pywebview.api.set_auto_expire_hours(hours);
    } else if (typeof window.pywebview.api.set_auto_expire_days === 'function') {
      window.pywebview.api.set_auto_expire_days(settingVal === '1h' || settingVal === '6h' ? settingVal : (hours / 24));
    }
  }
  notifySettingSaved('row_auto_expire');
}
window.changeAutoExpireSetting = changeAutoExpireSetting;


function formatBytes(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}


let _inFlightStorageStatsPromise = null;

async function refreshStorageStats() {
  if (_inFlightStorageStatsPromise) {
    return _inFlightStorageStatsPromise;
  }

  const totalEl = document.getElementById('storageTotalSize');
  const countEl = document.getElementById('storageTotalCount');
  const dbSizeEl = document.getElementById('storageDbSize');
  const textClipsEl = document.getElementById('storageTextClips');
  const protectedEl = document.getElementById('storageProtectedCount');

  _inFlightStorageStatsPromise = (async () => {
    try {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_storage_stats === 'function') {
        const res = await window.pywebview.api.get_storage_stats();
        if (res && res.ok) {
          const cCount = res.totalClips || 0;
          const imgBytes = res.imagesSizeBytes || 0;
          if (totalEl) {
            totalEl.textContent = (cCount === 0 && imgBytes === 0) ? '0 KB' : formatBytes(res.totalSizeBytes);
          }
          if (countEl) {
            countEl.textContent = `${cCount.toLocaleString()} clip${cCount === 1 ? '' : 's'} stored`;
          }
          if (textClipsEl) {
            const tCount = res.textClips || 0;
            const iCount = res.imageClips || 0;
            textClipsEl.textContent = `${tCount.toLocaleString()} text • ${iCount.toLocaleString()} image${iCount === 1 ? '' : 's'}`;
          }
          if (dbSizeEl) {
            const dbFmt = formatBytes(res.dbSizeBytes || 0);
            const imgFmt = formatBytes(res.imagesSizeBytes || 0);
            dbSizeEl.textContent = (cCount === 0 && imgBytes === 0)
              ? 'Database: 0 KB'
              : ((res.imagesSizeBytes && res.imagesSizeBytes > 0)
                  ? `DB: ${dbFmt} • Images: ${imgFmt}`
                  : `Database: ${dbFmt}`);
          }
          if (protectedEl) {
            const protCount = typeof res.protectedClips === 'number'
              ? res.protectedClips
              : ((res.pinnedClips || 0) + (res.favoriteClips || 0));
            protectedEl.textContent = `${protCount.toLocaleString()}`;
          }
          return;
        }
      }
    } catch (err) {
      console.warn('refreshStorageStats failed:', err);
    }

    // Only set zero fallback if UI has never been populated yet
    if (totalEl && (!totalEl.textContent || totalEl.textContent === '—')) totalEl.textContent = '0 KB';
    if (countEl && (!countEl.textContent || countEl.textContent === '—')) countEl.textContent = '0 clips stored';
    if (textClipsEl && (!textClipsEl.textContent || textClipsEl.textContent === '—')) textClipsEl.textContent = '0 text • 0 images';
    if (dbSizeEl && (!dbSizeEl.textContent || dbSizeEl.textContent === '—')) dbSizeEl.textContent = 'Database: 0 KB';
    if (protectedEl && (!protectedEl.textContent || protectedEl.textContent === '—')) protectedEl.textContent = '0';
  })().finally(() => {
    _inFlightStorageStatsPromise = null;
  });

  return _inFlightStorageStatsPromise;
}

window.refreshStorageStats = refreshStorageStats;

window.DC = window.DC || {};
// toggleIgnorePasswordsSetting / toggleCaptureImagesSetting live in settings-rules.js (loads AFTER this file).
// Guard with typeof so parse never throws; rules.js backfills DC.settings on load.
window.DC = window.DC || {};
window.DC.settings = window.DC.settings || {};
Object.assign(window.DC.settings, {
  notifySettingSaved,
  restoreCurrentTabDefaults
});


// Moved from core for balance
function syncTrackStatsToBackend(enabled) {
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_track_stats === 'function') {
    window.pywebview.api.set_track_stats(enabled).catch(() => {});
  }
}



async function openExportClipsModal() {
  const unorganizedBox = document.getElementById('exportScopeUnorganized');
  const imgBox = document.getElementById('exportScopeImages');
  const colsBox = document.getElementById('exportScopeCollections');
  const colsRow = document.getElementById('exportScopeCollectionsRow');
  const pinBox = document.getElementById('exportScopePinned');
  const starBox = document.getElementById('exportScopeStarred');
  const selectAll = document.getElementById('exportSelectAll');

  if (unorganizedBox) unorganizedBox.checked = true;
  if (imgBox) imgBox.checked = true;
  if (colsBox) colsBox.checked = false;
  if (pinBox) pinBox.checked = false;
  if (starBox) starBox.checked = false;
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }

  // Live-fetch definitions and counts to ensure union of all collections (including DB-only / membership-only)
  let liveStats = null;
  let liveTotals = null;
  if (window.pywebview && window.pywebview.api) {
    try {
      const [resDefs, resCounts, resClearStats] = await Promise.allSettled([
        typeof window.pywebview.api.get_collections === 'function' ? window.pywebview.api.get_collections() : Promise.resolve(null),
        typeof window.pywebview.api.get_collection_counts === 'function' ? window.pywebview.api.get_collection_counts() : Promise.resolve(null),
        typeof window.pywebview.api.get_clear_stats === 'function' ? window.pywebview.api.get_clear_stats() : Promise.resolve(null)
      ]);
      if (resClearStats.status === 'fulfilled' && resClearStats.value && resClearStats.value.ok) {
        liveStats = resClearStats.value;
      }
      if (resCounts.status === 'fulfilled' && resCounts.value && resCounts.value.ok && resCounts.value.totals) {
        liveTotals = resCounts.value.totals;
      }
      const known = new Map();
      if (typeof customCollections !== 'undefined' && Array.isArray(customCollections)) {
        customCollections.forEach(c => { if (c && c.id) known.set(c.id, c); });
      }
      if (resDefs.status === 'fulfilled' && resDefs.value && resDefs.value.ok && Array.isArray(resDefs.value.collections)) {
        resDefs.value.collections.forEach(d => {
          if (d && d.id) {
            const prev = known.get(d.id);
            known.set(d.id, { id: d.id, name: d.name || (prev && prev.name) || d.id, pinned: !!d.pinned, parentId: d.parentId || (prev && prev.parentId) || null });
          }
        });
      }
      if (resCounts.status === 'fulfilled' && resCounts.value && resCounts.value.ok && resCounts.value.counts) {
        const reserved = ['all', 'pins', 'most_used', 'favorites', 'all_total', 'all_unorganized'];
        const retired = ['work', 'personal', 'code', 'templates'];
        Object.keys(resCounts.value.counts).forEach(cid => {
          if (!cid) return;
          const low = String(cid).toLowerCase();
          if (reserved.includes(low) || retired.includes(cid)) return;
          if (!known.has(cid)) {
            known.set(cid, { id: cid, name: cid });
          }
        });
      }
      if (typeof customCollections !== 'undefined') {
        customCollections = Array.from(known.values());
        try { localStorage.setItem('dualclip_custom_collections', JSON.stringify(customCollections)); } catch(e){}
        if (typeof renderCollectionPills === 'function') { try { renderCollectionPills(); } catch(e){} }
      }
    } catch(e){}
  }

  // Update scope row badges using live database stats when available, falling back to loaded clips
  const bUnorganized = document.getElementById('exportBadgeUnorganized');
  const bImages = document.getElementById('exportBadgeImages');
  const bPinned = document.getElementById('exportBadgePinned');
  const bStarred = document.getElementById('exportBadgeStarred');
  let countUnorganized = 0, countImages = 0, countPinned = 0, countStarred = 0;

  if (liveStats && typeof liveStats.unpinned === 'number') {
    countImages = Number(liveStats.images) || 0;
    countPinned = Number(liveStats.pinned) || 0;
    countStarred = Number(liveStats.starred) || 0;
    if (liveTotals && typeof liveTotals.all_unorganized === 'number') {
      countUnorganized = Number(liveTotals.all_unorganized) || 0;
    } else {
      countUnorganized = (Number(liveStats.unpinned) || 0) + countImages;
    }
  } else if (Array.isArray(allClips)) {
    countUnorganized = allClips.filter(c => !c.collection || c.collection === 'all').length;
    countImages = allClips.filter(c => (!c.collection || c.collection === 'all') && c.is_image).length;
    countPinned = allClips.filter(c => (!c.collection || c.collection === 'all') && c.pinned).length;
    countStarred = allClips.filter(c => (!c.collection || c.collection === 'all') && c.favorite).length;
  }
  if (bUnorganized) bUnorganized.textContent = `${countUnorganized} ${countUnorganized === 1 ? 'clip' : 'clips'}`;
  if (bImages) bImages.textContent = `${countImages} ${countImages === 1 ? 'clip' : 'clips'}`;
  if (bPinned) bPinned.textContent = `${countPinned} ${countPinned === 1 ? 'clip' : 'clips'}`;
  if (bStarred) bStarred.textContent = `${countStarred} ${countStarred === 1 ? 'clip' : 'clips'}`;

  const listEl = document.getElementById('exportCollectionsList');
  if (listEl) {
    const SYSTEM_RESERVED = new Set(['all', 'pins', 'most_used', 'favorites', 'all_total', 'all_unorganized', 'transcriptions', 'voice']);
    const cols = (typeof customCollections !== 'undefined' && Array.isArray(customCollections))
      ? customCollections.filter(c => c && c.id && !SYSTEM_RESERVED.has(String(c.id).toLowerCase()))
      : [];
    if (cols.length === 0) {
      if (colsRow) colsRow.style.display = 'none';
      if (colsBox) colsBox.checked = false;
      listEl.style.display = 'none';
    } else {
      if (colsRow) colsRow.style.display = 'flex';
      cols.forEach(c => {
        const colWrap = document.createElement('div');
        colWrap.style.display = 'flex';
        colWrap.style.flexDirection = 'column';
        colWrap.style.gap = '2px';

        let count = 0;
        if (liveStats && liveStats.collections && Object.prototype.hasOwnProperty.call(liveStats.collections, c.id)) {
          count = liveStats.collections[c.id] || 0;
        } else if (typeof getCollectionClipCount === 'function') {
          count = getCollectionClipCount(c.id);
        }

        const safeId = typeof escapeHtml === 'function' ? escapeHtml(c.id) : c.id;
        const safeName = typeof escapeHtml === 'function' ? escapeHtml(c.name || c.id) : (c.name || c.id);

        let pinnedInCol = 0, favInCol = 0;
        try {
          const clipsArr = (typeof allClips !== 'undefined' && Array.isArray(allClips)) ? allClips : [];
          pinnedInCol = clipsArr.filter(x => x && x.collection === c.id && x.pinned).length;
          favInCol = clipsArr.filter(x => x && x.collection === c.id && x.favorite).length;
        } catch (_) {}

        let badgeDetails = `${count} ${count === 1 ? 'clip' : 'clips'}`;
        if (pinnedInCol > 0 || favInCol > 0) {
          const extra = [];
          if (pinnedInCol > 0) extra.push(`${pinnedInCol} pinned`);
          if (favInCol > 0) extra.push(`${favInCol} fav`);
          badgeDetails += ` (${extra.join(' · ')})`;
        }

        const item = document.createElement('div');
        item.className = 'clear-pill-row';
        item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; border-radius: 5px; cursor: pointer; user-select: none; font-size: 11.5px;';
        item.innerHTML = `
          <label style="display: inline-flex; align-items: center; gap: 8px; margin: 0; cursor: pointer;">
            <input type="checkbox" class="export-col-cb" data-col="${safeId}" onchange="onExportScopeChanged()" style="accent-color: var(--accent); cursor: pointer; width: 14px; height: 14px;">
            <span>${safeName}</span>
          </label>
          <span class="clear-row-badge" style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${badgeDetails}</span>
        `;

        colWrap.appendChild(item);
        listEl.appendChild(colWrap);
      });
    }
  }
  onExportScopeChanged();
  const modal = document.getElementById('exportClipsModal');
  if (modal) modal.style.display = 'flex';
}
window.openExportClipsModal = openExportClipsModal;

function toggleExportSelectAll(masterCb) {
  const allRows = document.querySelectorAll('.export-sections-box input[type="checkbox"]');
  allRows.forEach(cb => {
    cb.checked = masterCb.checked;
  });
  onExportScopeChanged();
}
window.toggleExportSelectAll = toggleExportSelectAll;

function toggleExportCollectionsExpand(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const arrow = document.getElementById('exportCollectionsMasterArrow');
  const list = document.getElementById('exportCollectionsList');
  if (list && arrow) {
    const isExpanded = list.style.display === 'flex';
    list.style.display = isExpanded ? 'none' : 'flex';
    arrow.classList.toggle('expanded', !isExpanded);
  }
}
window.toggleExportCollectionsExpand = toggleExportCollectionsExpand;

function toggleExportCollectionsCheck(isChecked) {
  const list = document.getElementById('exportCollectionsList');
  if (list) {
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = isChecked;
    });
  }
  onExportScopeChanged();
}
window.toggleExportCollectionsCheck = toggleExportCollectionsCheck;

function toggleExportSingleColExpand(el, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const colId = (typeof el === 'string') ? el : (el && el.getAttribute ? el.getAttribute('data-arrow-export-col') : null);
  if (!colId) return;
  const sub = document.getElementById(`exportColSub_${colId}`);
  const btn = (el && typeof el !== 'string') ? el : (e && e.currentTarget ? e.currentTarget : document.querySelector(`.expand-arrow-btn[data-arrow-export-col="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(colId) : colId}"]`));
  if (sub) {
    const isExpanded = sub.style.display === 'flex';
    sub.style.display = isExpanded ? 'none' : 'flex';
    if (btn) btn.classList.toggle('expanded', !isExpanded);
  }
}
window.toggleExportSingleColExpand = toggleExportSingleColExpand;

function toggleExportSingleColCheck(el, isChecked) {
  const colId = (typeof el === 'string') ? el : (el && el.getAttribute ? el.getAttribute('data-col') : null);
  if (typeof isChecked === 'undefined' && el && typeof el.checked === 'boolean') isChecked = el.checked;
  if (!colId) return;
  const sub = document.getElementById(`exportColSub_${colId}`);
  if (sub) {
    sub.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = isChecked;
    });
  }
  onExportScopeChanged();
}
window.toggleExportSingleColCheck = toggleExportSingleColCheck;

function closeExportClipsModal(event) {
  if (event && event.target && event.target.id !== 'exportClipsModal' && !event.target.classList.contains('close')) return;
  const modal = document.getElementById('exportClipsModal');
  if (modal) modal.style.display = 'none';
}
window.closeExportClipsModal = closeExportClipsModal;

function onExportScopeChanged() {
  const allRows = document.querySelectorAll('.export-sections-box input[type="checkbox"]');
  const checkedRows = document.querySelectorAll('.export-sections-box input[type="checkbox"]:checked');
  const selectAll = document.getElementById('exportSelectAll');
  const summary = document.getElementById('exportSelectionSummary');
  const confirmBtn = document.getElementById('exportClipsConfirmBtn');

  const allColCbs = document.querySelectorAll('.export-col-cb');
  const chosenColCbs = document.querySelectorAll('.export-col-cb:checked');
  const colsBox = document.getElementById('exportScopeCollections');
  if (colsBox && allColCbs.length > 0) {
    colsBox.checked = chosenColCbs.length === allColCbs.length;
    colsBox.indeterminate = chosenColCbs.length > 0 && chosenColCbs.length < allColCbs.length;
  }

  const colBadge = document.getElementById('exportBadgeCollections');
  if (colBadge) {
    colBadge.textContent = `${chosenColCbs.length} selected`;
  }

  if (summary) {
    summary.innerText = `${checkedRows.length} of ${allRows.length} selected`;
  }

  if (selectAll) {
    selectAll.checked = allRows.length > 0 && checkedRows.length === allRows.length;
    selectAll.indeterminate = checkedRows.length > 0 && checkedRows.length < allRows.length;
  }

  const valid = checkedRows.length > 0;
  if (confirmBtn) {
    confirmBtn.disabled = !valid;
    confirmBtn.style.opacity = valid ? '1' : '0.4';
    confirmBtn.style.cursor = valid ? 'pointer' : 'not-allowed';
  }
}
window.onExportScopeChanged = onExportScopeChanged;

async function submitExportClipsModal() {
  const unorganizedBox = document.getElementById('exportScopeUnorganized');
  const imgBox = document.getElementById('exportScopeImages');
  const pinBox = document.getElementById('exportScopePinned');
  const starBox = document.getElementById('exportScopeStarred');
  const selectAll = document.getElementById('exportSelectAll');

  // Prune any selected IDs that were deleted mid-open
  const currentCols = (typeof customCollections !== 'undefined' && Array.isArray(customCollections)) ? customCollections : [];
  const validColIds = new Set(currentCols.map(c => c && c.id).filter(Boolean));
  const chosenCols = [];
  document.querySelectorAll('.export-col-cb:checked').forEach(cb => {
    const colId = cb.getAttribute('data-col');
    if (colId && validColIds.has(colId)) chosenCols.push(colId);
  });
  const chosenSet = new Set(chosenCols);
  // Per-collection sub-scopes: a checked Pinned/Favorites sub-filter exports only
  // that slice of the collection. Fully-checked parents already cover everything,
  // so only subs of unchecked parents are sent as targeted scopes.
  const colPinned = [];
  const colStarred = [];
  document.querySelectorAll('.export-col-sub-cb:checked').forEach(cb => {
    const parent = cb.getAttribute('data-parent');
    if (!parent || !validColIds.has(parent) || chosenSet.has(parent)) return;
    if (cb.getAttribute('data-type') === 'pinned') {
      if (!colPinned.includes(parent)) colPinned.push(parent);
    } else if (cb.getAttribute('data-type') === 'favorites') {
      if (!colStarred.includes(parent)) colStarred.push(parent);
    }
  });

  const isSelectAll = selectAll && selectAll.checked;
  const isUnorganized = !!(unorganizedBox && unorganizedBox.checked);
  const scope = {
    all: isSelectAll,
    unorganized: isSelectAll || isUnorganized,
    collections: chosenCols,
    colPinned: colPinned,
    colStarred: colStarred,
    pinnedOnly: !!(pinBox && pinBox.checked),
    starredOnly: !!(starBox && starBox.checked),
    includeImages: isSelectAll || !!(imgBox && imgBox.checked),
    includeText: true
  };

  const checkedCount = document.querySelectorAll('.export-sections-box input[type="checkbox"]:checked').length;
  if (checkedCount === 0 && !isSelectAll) {
    if (typeof showToast === 'function') showToast('Please select at least one item to export');
    return;
  }

  try {
    let res = null;
    if (window.DC && window.DC.bridge && typeof window.DC.bridge.export_clips === 'function') {
      res = await window.DC.bridge.export_clips(scope);
    } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.export_clips === 'function') {
      res = await window.pywebview.api.export_clips(scope);
    } else if (typeof callHost === 'function') {
      res = await callHost('export_clips', [scope]);
    }
    if (res && res.ok) {
      let msg = `Exported ${res.count} clip${res.count === 1 ? '' : 's'}`;
      if (res.image_count > 0) msg += ` (${res.image_count} image${res.image_count === 1 ? '' : 's'})`;
      if (res.missing_images > 0) msg += ` • ${res.missing_images} missing image${res.missing_images === 1 ? '' : 's'} omitted`;
      if (typeof showToast === 'function') showToast(msg, { duration: 3200 });
      closeExportClipsModal();
    } else if (res && !res.canceled) {
      if (typeof showToast === 'function') showToast(res.error || "Couldn't export clips");
    }
  } catch {
    if (typeof showToast === 'function') showToast("Couldn't export clips");
  }
}
window.submitExportClipsModal = submitExportClipsModal;

async function importClipsFromFile() {
  try {
    let res = null;
    if (window.DC && window.DC.bridge && typeof window.DC.bridge.import_into_collection === 'function') {
      res = await window.DC.bridge.import_into_collection('all');
    } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.import_into_collection === 'function') {
      res = await window.pywebview.api.import_into_collection('all');
    } else if (typeof callHost === 'function') {
      res = await callHost('import_into_collection', ['all']);
    }
    if (res && res.ok) {
      let msg = `Imported ${res.imported} new clip${res.imported === 1 ? '' : 's'}`;
      if (res.deduped > 0) msg += ` (skipped ${res.deduped} already saved)`;
      if (res.skipped_images > 0) msg += ` • ${res.skipped_images} image${res.skipped_images === 1 ? '' : 's'} skipped`;
      if (typeof showToast === 'function') showToast(msg, { duration: 3200 });
      refreshStorageStats();
      if (typeof window.rehydrateCollectionsFromBackend === 'function') {
        try { window.rehydrateCollectionsFromBackend(0, true); } catch(_) {}
      }
      if (typeof window.DC?.state?.loadClipsFromBackend === 'function') {
        window.DC.state.loadClipsFromBackend();
      } else if (typeof window.loadClipsFromBackend === 'function') {
        window.loadClipsFromBackend();
      } else if (typeof window.applyFilters === 'function') {
        window.applyFilters();
      }
      if (typeof renderCollectionPills === 'function') {
        try { renderCollectionPills(); } catch(_) {}
      }
    } else if (res && !res.canceled) {
      const err = res && res.error ? res.error : 'Import failed';
      if (typeof showToast === 'function') showToast(`Import failed: ${err}`);
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast(`Import failed: ${err && err.message ? err.message : err}`);
  }
}
window.importClipsFromFile = importClipsFromFile;

// compact-mode toggle removed Ã¢â‚¬â€ Ultra-Dense (density-dense) now carries the tight layout directly








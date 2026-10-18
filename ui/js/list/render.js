
/**
 * Safe DOM Match Highlighting
 * Replaces dangerous innerHTML regex replacements with a safe text-node builder:
 * 1. Find substring/word match offsets in the raw text.
 * 2. Append preceding text via document.createTextNode(beforeText).
 * 3. Append matching portion via document.createElement('mark') with .textContent.
 * 4. Append remaining text as text nodes.
 */
function createHighlightedFragment(text, query) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  let rawText = String(text);
  if (rawText.length > 1500) {
    rawText = rawText.slice(0, 1500);
  }
  const q = (query || '').trim();
  if (!q) {
    frag.appendChild(document.createTextNode(rawText));
    return frag;
  }

  const words = q.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) {
    frag.appendChild(document.createTextNode(rawText));
    return frag;
  }

  const intervals = [];
  const lowerText = rawText.toLowerCase();
  for (const word of words) {
    const lowerWord = word.toLowerCase();
    let idx = lowerText.indexOf(lowerWord);
    while (idx !== -1) {
      intervals.push([idx, idx + lowerWord.length]);
      idx = lowerText.indexOf(lowerWord, idx + 1);
    }
  }

  if (intervals.length === 0) {
    frag.appendChild(document.createTextNode(rawText));
    return frag;
  }

  intervals.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  let cur = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    const next = intervals[i];
    if (next[0] <= cur[1]) {
      cur[1] = Math.max(cur[1], next[1]);
    } else {
      merged.push(cur);
      cur = next;
    }
  }
  merged.push(cur);

  let lastIdx = 0;
  for (const [start, end] of merged) {
    if (start > lastIdx) {
      frag.appendChild(document.createTextNode(rawText.slice(lastIdx, start)));
    }
    const mark = document.createElement('mark');
    mark.textContent = rawText.slice(start, end);
    frag.appendChild(mark);
    lastIdx = end;
  }
  if (lastIdx < rawText.length) {
    frag.appendChild(document.createTextNode(rawText.slice(lastIdx)));
  }

  return frag;
}

function formatAppDisplayName(processName) {
  if (!processName || processName.toLowerCase() === 'clipboard' || processName.toLowerCase() === 'dualclip') return 'DualClip';
  const p = processName.toLowerCase().replace(/\.exe$/i, '');
  if (p === 'code' || p === 'cursor' || p === 'devenv') return 'VS Code';
  if (p === 'chrome') return 'Chrome';
  if (p === 'msedge' || p === 'edge') return 'Edge';
  if (p === 'brave') return 'Brave';
  if (p === 'firefox') return 'Firefox';
  if (p === 'discord') return 'Discord';
  if (p === 'slack') return 'Slack';
  if (p === 'teams') return 'Teams';
  if (p === 'windowsterminal' || p === 'wt') return 'Terminal';
  if (p === 'powershell' || p === 'pwsh') return 'PowerShell';
  if (p === 'cmd') return 'Command Prompt';
  if (p === 'winword' || p === 'word') return 'Word';
  if (p === 'excel') return 'Excel';
  if (p === 'powerpnt' || p === 'powerpoint') return 'PowerPoint';
  if (p === 'notepad') return 'Notepad';
  if (p === 'explorer') return 'Explorer';
  if (p === 'snippingtool') return 'Snipping Tool';
  if (p === 'spotify') return 'Spotify';
  if (p === 'postman') return 'Postman';
  if (p === 'figma') return 'Figma';
  if (p === 'notion') return 'Notion';
  return processName.replace(/\.exe$/i, '');
}

function getAppIconSvg(processName, appIconDataUrl) {
  const p = (processName || '').toLowerCase().replace(/\.exe$/i, '');
  const isDualClip = p === 'dualclip' || p === 'clipboard' || p === 'manual' || p === 'manual entry' || p === '';

  // If a real extracted application icon data URL is available (or cached for DualClip), render crisp 16px img tag
  const effectiveIconUrl = (appIconDataUrl && typeof appIconDataUrl === 'string' && appIconDataUrl.startsWith('data:image/'))
    ? appIconDataUrl
    : (isDualClip && typeof window !== 'undefined' && window.DUALCLIP_APP_ICON ? window.DUALCLIP_APP_ICON : null);

  if (effectiveIconUrl) {
    const title = formatAppDisplayName(processName || 'DualClip');
    const safeSrc = typeof sanitizeImageSrc === 'function' ? sanitizeImageSrc(effectiveIconUrl) : effectiveIconUrl.replace(/"/g, '&quot;');
    return `<span class="app-icon" title="${escapeHtml(title)}"><img src="${safeSrc}" alt="${escapeHtml(title)}" class="app-icon-img" style="width:16px;height:16px;object-fit:contain;border-radius:3px;display:block;" onerror="this.style.display='none'" /></span>`;
  }
  
  // Google Chrome (Official 4-color circle logo)
  if (p.includes('chrome')) {
    return `<span class="app-icon" title="Google Chrome"><svg viewBox="0 0 48 48"><path fill="#4CAF50" d="M24 4c6.3 0 12 3 15.6 7.7L29.3 29.4c-.9.9-2.1 1.6-3.3 1.9L13.8 11.2C16.6 6.8 20 4 24 4z"/><path fill="#FFC107" d="M43.6 20.3C44 21.5 44.2 22.7 44.2 24c0 10.3-7.8 18.8-17.8 19.9l10.3-17.9c.9-.4 1.7-1 2.4-1.8l4.5-3.9z"/><path fill="#F44336" d="M24 44c-11 0-20-9-20-20 0-4.1 1.2-7.9 3.4-11.1L17.7 30.6c.9 1.4 2.2 2.5 3.7 3.2L24 44z"/><circle cx="24" cy="24" r="9.5" fill="#FFFFFF"/><circle cx="24" cy="24" r="7.5" fill="#1976D2"/></svg></span>`;
  }
  // Microsoft Edge (Official Fluent wave logo)
  if (p.includes('msedge') || p.includes('edge')) {
    return `<span class="app-icon" title="Microsoft Edge"><svg viewBox="0 0 48 48"><path fill="#0C80DF" d="M41.8 33.6C39.4 39.8 33.3 44 26 44 14.9 44 6 35.1 6 24 6 13.9 13.5 5.6 23.3 4.2c-4.4 2.8-7.3 7.8-7.3 13.8 0 8.8 7.2 16 16 16 3.7 0 7.1-1.3 9.8-3.4z"/><path fill="#00A4EF" d="M24 4c11 0 20 9 20 20 0 1.7-.2 3.4-.6 5-2.2-6.5-8.4-11-15.4-11-7.7 0-14 6.3-14 14 0 3.2 1.1 6.1 2.9 8.5C9.7 37.3 4 30.2 4 22 4 12.1 13 4 24 4z"/><path fill="#00C853" d="M38.5 28.5C36.3 22.3 30.4 18 23.5 18 16 18 10 24 10 31.5c0 4.1 1.8 7.8 4.7 10.3C21.3 43.6 30.8 42.5 37 38c2.1-1.5 3.8-3.4 4.8-5.6l-3.3-3.9z"/></svg></span>`;
  }
  // VS Code (Official Blue Ribbon)
  if (p.includes('code') || p.includes('cursor') || p.includes('devenv') || p.includes('studio') || p.includes('rider')) {
    return `<span class="app-icon" title="VS Code"><svg viewBox="0 0 24 24"><path fill="#0066B8" d="M17.5 1.5l-10 9-4-3.5L1 8.5l4.5 3.5L1 15.5l2.5 1.5 4-3.5 10 9 5.5-2.5V4z"/><path fill="#007ACC" d="M17.5 1.5L7.5 10.5l4 3.5 6-5.5z"/><path fill="#1F9CF0" d="M17.5 22.5L7.5 13.5l4-3.5 6 5.5z"/><path fill="#0066B8" d="M17.5 8.5v7l-4-3.5z"/></svg></span>`;
  }
  // Discord (Blurple Clyde)
  if (p.includes('discord')) {
    return `<span class="app-icon" title="Discord"><svg viewBox="0 0 24 24"><path fill="#5865F2" d="M20.3 4.4a19.8 19.8 0 0 0-4.9-1.5l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.7 2.9A19.7 19.7 0 0 0 3.7 4.4C.5 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.2-2a13.1 13.1 0 0 1-1.9-.9l.4-.3a10.2 10.2 0 0 0 .4-.3 13.9 13.9 0 0 0 12 0l.4.3.4.3a12.3 12.3 0 0 1-1.9.9l1.2 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.5-13.7z"/><circle cx="8.5" cy="13" r="1.8" fill="#FFFFFF"/><circle cx="15.5" cy="13" r="1.8" fill="#FFFFFF"/></svg></span>`;
  }
  // Slack (Official 4-color Octothorpe)
  if (p.includes('slack')) {
    return `<span class="app-icon" title="Slack"><svg viewBox="0 0 24 24"><path fill="#E01E5A" d="M5 15a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 0 15a2.5 2.5 0 0 1 2.5-2.5H5V15z"/><path fill="#E01E5A" d="M6.2 15a2.5 2.5 0 0 1 2.5-2.5 2.5 2.5 0 0 1 2.5 2.5v6.2a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 6.2 21.2V15z"/><path fill="#36C5F0" d="M9 5a2.5 2.5 0 0 1-2.5-2.5A2.5 2.5 0 0 1 9 0a2.5 2.5 0 0 1 2.5 2.5V5H9z"/><path fill="#36C5F0" d="M9 6.2a2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 1-2.5 2.5H2.8A2.5 2.5 0 0 1 .3 8.7 2.5 2.5 0 0 1 2.8 6.2H9z"/><path fill="#2EB67D" d="M19 9a2.5 2.5 0 0 1 2.5-2.5A2.5 2.5 0 0 1 24 9a2.5 2.5 0 0 1-2.5 2.5H19V9z"/><path fill="#2EB67D" d="M17.8 9a2.5 2.5 0 0 1-2.5 2.5 2.5 2.5 0 0 1-2.5-2.5V2.8A2.5 2.5 0 0 1 15.3.3 2.5 2.5 0 0 1 17.8 2.8V9z"/><path fill="#ECB22E" d="M15 19a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 15 24a2.5 2.5 0 0 1-2.5-2.5V19H15z"/><path fill="#ECB22E" d="M15 17.8a2.5 2.5 0 0 1-2.5-2.5 2.5 2.5 0 0 1 2.5-2.5h6.2a2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 1-2.5 2.5H15z"/></svg></span>`;
  }
  // Microsoft Word (Official M365 Word)
  if (p.includes('word') || p.includes('winword')) {
    return `<span class="app-icon" title="Microsoft Word"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#185ABD"/><path fill="#fff" opacity="0.95" d="M5.5 6h13a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/><path fill="#185ABD" d="M7 8.5h2.2l1.6 5 1.5-5h1.8l1.5 5 1.6-5H19l-2.4 7h-2.2l-1.5-4.8L11.4 15.5H9.2z"/></svg></span>`;
  }
  // Microsoft Excel (Official M365 Excel)
  if (p.includes('excel')) {
    return `<span class="app-icon" title="Microsoft Excel"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#107C41"/><path fill="#fff" opacity="0.95" d="M5.5 6h13a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/><path fill="#107C41" d="M8.5 8.5h2.5l1.8 3 1.8-3h2.5l-3 4.5 3.2 4.5h-2.5l-2-3.2-2 3.2H8.5l3.2-4.5z"/></svg></span>`;
  }
  // Microsoft PowerPoint (Official M365 PowerPoint)
  if (p.includes('powerpnt') || p.includes('powerpoint')) {
    return `<span class="app-icon" title="Microsoft PowerPoint"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#D83B01"/><path fill="#fff" opacity="0.95" d="M5.5 6h13a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/><path fill="#D83B01" d="M8.5 8.5h4.5a3 3 0 0 1 0 6H11v3H8.5V8.5zm2.5 4.2h1.8a1.2 1.2 0 1 0 0-2.4H11v2.4z"/></svg></span>`;
  }
  // Microsoft Teams
  if (p.includes('teams')) {
    return `<span class="app-icon" title="Microsoft Teams"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#6264A7"/><circle cx="17" cy="8" r="2" fill="#FFFFFF" opacity="0.9"/><path fill="#FFFFFF" opacity="0.9" d="M14.5 12h5a1.5 1.5 0 0 1 1.5 1.5V15h-8v-1.5a1.5 1.5 0 0 1 1.5-1.5z"/><rect x="4" y="6" width="10" height="12" rx="2" fill="#FFFFFF"/><path fill="#6264A7" d="M6.5 8.5h5v2h-1.4v5h-2.2v-5H6.5z"/></svg></span>`;
  }
  // Windows Terminal (Official Chevron)
  if (p.includes('terminal') || p.includes('wt')) {
    return `<span class="app-icon" title="Windows Terminal"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#0C1021"/><path d="M5 8l4.5 4L5 16" stroke="#4CC2FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><line x1="12" y1="16" x2="18" y2="16" stroke="#4CC2FF" stroke-width="2.2" stroke-linecap="round"/></svg></span>`;
  }
  // PowerShell (Official Windows PowerShell)
  if (p.includes('powershell') || p.includes('pwsh')) {
    return `<span class="app-icon" title="PowerShell"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#012456"/><path d="M6 7l5 5-5 5" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><line x1="13" y1="17" x2="18" y2="17" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/></svg></span>`;
  }
  // Notepad
  if (p.includes('notepad')) {
    return `<span class="app-icon" title="Notepad"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#0078D4"/><path fill="#fff" opacity="0.9" d="M6 5h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8 8h8M8 12h8M8 16h5" stroke="#0078D4" stroke-width="1.6" stroke-linecap="round"/></svg></span>`;
  }
  // File Explorer
  if (p.includes('explorer')) {
    return `<span class="app-icon" title="File Explorer"><svg viewBox="0 0 24 24"><path fill="#FFA000" d="M2 5a2 2 0 0 1 2-2h4.6a1 1 0 0 1 .7.3L11.4 5H20a2 2 0 0 1 2 2v2H2V5z"/><path fill="#FFCA28" d="M2 9h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9z"/><rect x="6" y="11" width="12" height="6" rx="1" fill="#00838F" opacity="0.4"/></svg></span>`;
  }
  // Snipping Tool / Screenshot
  if (p.includes('snip') || p.includes('screen') || p.includes('capture') || p.includes('sharex') || p.includes('greenshot')) {
    return `<span class="app-icon" title="Snipping Tool"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#D83B01"/><circle cx="8" cy="8" r="2.5" fill="none" stroke="#FFFFFF" stroke-width="1.6"/><circle cx="8" cy="16" r="2.5" fill="none" stroke="#FFFFFF" stroke-width="1.6"/><line x1="10" y1="9.5" x2="17" y2="16.5" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round"/><line x1="10" y1="14.5" x2="17" y2="7.5" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round"/></svg></span>`;
  }
  // Spotify
  if (p.includes('spotify')) {
    return `<span class="app-icon" title="Spotify"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#1DB954"/><path d="M6.5 9.5c3.5-1 7.5-1 11 1M7 12.8c3-.8 6.5-.8 9.5 1M7.8 16c2.4-.6 5.2-.6 7.4.5" stroke="#000000" stroke-width="2" stroke-linecap="round" fill="none"/></svg></span>`;
  }
  // Postman
  if (p.includes('postman')) {
    return `<span class="app-icon" title="Postman"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FF6C37"/><circle cx="12" cy="10" r="3.5" fill="#FFFFFF"/><path fill="#FFFFFF" d="M6.5 18c0-2.5 2.5-4 5.5-4s5.5 1.5 5.5 4z"/></svg></span>`;
  }
  // Figma
  if (p.includes('figma')) {
    return `<span class="app-icon" title="Figma"><svg viewBox="0 0 24 24"><path fill="#F24E1E" d="M8 2h4v5H8a2.5 2.5 0 0 1 0-5z"/><path fill="#FF7262" d="M12 2h4a2.5 2.5 0 0 1 0 5h-4V2z"/><path fill="#A259FF" d="M8 7h4v5H8a2.5 2.5 0 0 1 0-5z"/><path fill="#1ABCFE" d="M12 7h4a2.5 2.5 0 0 1 0 5h-4V7z"/><path fill="#0ACF83" d="M8 12h4v2.5a2.5 2.5 0 0 1-5 0V12h1z"/></svg></span>`;
  }
  // Notion
  if (p.includes('notion')) {
    return `<span class="app-icon" title="Notion"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#000000"/><path fill="#FFFFFF" d="M6 6.5h3.5l5.5 7.5V6.5h3v11h-3.5L9 10v7.5H6z"/></svg></span>`;
  }
  // Brave Browser
  if (p.includes('brave')) {
    return `<span class="app-icon" title="Brave"><svg viewBox="0 0 24 24"><path fill="#FB542B" d="M12 2l7 3v7c0 5.5-3.5 8.5-7 10-3.5-1.5-7-4.5-7-10V5l7-3z"/><path fill="#FFFFFF" d="M12 6l3.5 3-1 4.5h-5l-1-4.5L12 6z"/></svg></span>`;
  }
  // Firefox Browser
  if (p.includes('firefox')) {
    return `<span class="app-icon" title="Firefox"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#FF7139"/><circle cx="12" cy="12" r="7" fill="#802082"/><path fill="#FF9400" d="M12 2C6.5 2 2 6.5 2 12c0 2.5 1 4.8 2.6 6.5C5.8 14 8.5 11 12 11c2.8 0 5 1.8 5 4.5 0 2-1.2 3.8-3 4.3 4.2-.8 7.5-4.4 7.5-8.8 0-4.9-3.6-9-8.5-9z"/></svg></span>`;
  }
  // Default / DualClip Brand Logo (Indigo Gradient with Dual-Clip Symbol)
  return `<span class="app-icon" title="DualClip"><svg viewBox="0 0 24 24"><defs><linearGradient id="dcLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#6366F1"/><stop offset="100%" stop-color="#4F46E5"/></linearGradient></defs><rect width="24" height="24" rx="4.5" fill="url(#dcLogoGrad)"/><path fill="#FFFFFF" opacity="0.95" d="M7 6h6a2 2 0 0 1 2 2v1.5H8.5A1.5 1.5 0 0 0 7 11v4H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1zm3 4h7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zm1.5 2.5v3h4v-3h-4z"/></svg></span>`;
}
if (typeof window !== 'undefined') {
  window.createHighlightedFragment = createHighlightedFragment;
}

// --- DualClip Virtual List Rendering & Selection ---

var lastKnownClientHeight = 0;
var _hasValidHeightCache = false;
function getEffectiveClientHeight(container) {
  if (!container) return _hasValidHeightCache ? lastKnownClientHeight : 0;
  const h = container.clientHeight;
  if (h && h > 0) { lastKnownClientHeight = h; _hasValidHeightCache = true; return h; }
  try {
    const rectH = container.getBoundingClientRect().height;
    if (rectH && rectH > 10) { lastKnownClientHeight = Math.round(rectH); _hasValidHeightCache = true; return lastKnownClientHeight; }
  } catch(e) {}
  return _hasValidHeightCache ? lastKnownClientHeight : 0;
}
window.invalidateCachedHeight = function() {
  lastKnownClientHeight = 0;
  _hasValidHeightCache = false;};

const ROW_HEIGHT_NORMAL = 65;
const ROW_HEIGHT_HEADER = 32;
const ROW_HEIGHT_HEADER_COMPACT = 24;

function getHeaderHeight() {
  const b = document.body;
  const isCompact = (document.documentElement.getAttribute('data-layout-preset') === 'compact') ||
                    (b && b.classList.contains('density-dense'));
  return isCompact ? ROW_HEIGHT_HEADER_COMPACT : ROW_HEIGHT_HEADER;
}
// Auto-adaptive bucketed heights — recalibrated from the measured WebView2 render
// (layout_debug.log): with clip details visible the real border-box heights are
// 1 line: 65px, 2 lines: 86px, 3 lines: 106px. The old 84/100 guesses were short by
// 2px and 4-6px, which made the correction pass shift every row below on each summon.
const ROW_HEIGHT_AUTO_1 = 65;
const ROW_HEIGHT_AUTO_2 = 86;
const ROW_HEIGHT_AUTO_3 = 106;

// Compact / Hidden-Details row heights — recalibrated from layout_debug.log.
// Final resting heights (the value the row settles at after the correction pass):
// 1 line: 32px, 2 lines: 50px, 3 lines: 70px.
const ROW_HEIGHT_HIDDEN_NORMAL = 32;
const ROW_HEIGHT_HIDDEN_AUTO_1 = 32;
const ROW_HEIGHT_HIDDEN_AUTO_2 = 50;
const ROW_HEIGHT_HIDDEN_AUTO_3 = 70;

// Cards density gap — matches density-preview.html (margin 6px 0 collapsed = 6px
// visible gap between cards). The virtualizer positions rows from fixed buckets,
// so CSS margins alone never separate rows; the gap must live in the math.
const ROW_GAP_CARDS = 6;
function cardsRowGap() {
  try {
    const b = document.body;
    if (b && (b.classList.contains('density-cards') || b.classList.contains('density-cards_subtle') || b.classList.contains('density-cards_framed'))) return ROW_GAP_CARDS;
  } catch {}
  return 0;
}
let lastVirtualTotalH = -1;
// Measured row heights are keyed by clip AND by the layout inputs that decide the height
// (preview size, layout, lines, zoom, details, density). Image rows are not a single
// constant — a wider thumbnail squeezes the text and changes how the row wraps — so each
// combination has to keep its own numbers. Keying this way means switching the preview size
// reuses what was already measured for that size instead of wiping everything and falling
// back to a guess, which is what produced the visible jump on every change.
const _measuredClipHeights = new Map();
let _heightSig = '';

function refreshHeightSignature() {
  const frame = document.getElementById('appFrame');
  const density = document.body.classList.contains('density-dense') ? 'dense'
    : (document.body.classList.contains('density-compact') ? 'compact' : 'default');
  _heightSig = (frame ? frame.getAttribute('data-thumb-size') : 'sm') + '|' +
    (document.documentElement.getAttribute('data-layout-preset') || 'standard') + '|' +
    (document.documentElement.getAttribute('data-line-display') || 'auto') + '|' +
    (document.documentElement.getAttribute('data-zoom') || '100') + '|' +
    (isClipDetailsHidden() ? 'hidden' : 'shown') + '|' + density;
  return _heightSig;
}

function measuredHeightKey(clipId) {
  if (!_heightSig) refreshHeightSignature();
  return clipId + '|' + _heightSig;
}

// Keeps memory bounded without ever dropping the current combination's entries.
function pruneMeasuredHeights() {
  if (_measuredClipHeights.size <= 3000) return;
  const suffix = '|' + _heightSig;
  const keep = [];
  _measuredClipHeights.forEach((value, key) => {
    if (key.endsWith(suffix)) keep.push([key, value]);
  });
  _measuredClipHeights.clear();
  keep.forEach(([key, value]) => _measuredClipHeights.set(key, value));
}

function invalidateMeasuredHeights() {
  _measuredClipHeights.clear();
}
window.invalidateMeasuredHeights = invalidateMeasuredHeights;

let _cachedUseCountBadgePref = false;
let _cachedLabelStylePref = 'pill';
let _cachedQuickNumberPastePref = false;
let _cachedIsActivelySearching = false;

function refreshCachedPreferences() {
  try {
    _cachedUseCountBadgePref = localStorage.getItem('dualclip_show_use_count_badge') === 'true';
    _cachedLabelStylePref = localStorage.getItem('dualclip_label_style') || 'pill';
    _cachedQuickNumberPastePref = (typeof getQuickNumberPasteSetting === 'function')
      ? getQuickNumberPasteSetting()
      : (localStorage.getItem('dualclip_quick_number_paste') === '1');
  } catch (_) {}
}

refreshCachedPreferences();
try {
  window.addEventListener('storage', (e) => {
    if (e.key === 'dualclip_show_use_count_badge') {
      _cachedUseCountBadgePref = e.newValue === 'true';
    } else if (e.key === 'dualclip_label_style') {
      _cachedLabelStylePref = e.newValue || 'pill';
    } else if (e.key === 'dualclip_quick_number_paste') {
      _cachedQuickNumberPastePref = e.newValue === '1';
    }
  });
} catch (_) {}

function isClipDetailsHidden() {
  const details = document.documentElement.getAttribute('data-clip-details') || 'hidden';
  if (details === 'auto') {
    return isCompactLayoutActive();
  }
  return details === 'hidden' || details === 'none';
}

function isCompactLayoutActive() {
  return (document.documentElement.getAttribute('data-layout-preset') === 'compact') ||
         (document.body && document.body.classList.contains('density-compact')) ||
         (document.getElementById('mainView')?.classList.contains('layout-compact'));
}

function getThumbRowHeight() {
  const isHidden = isClipDetailsHidden();
  const mode = (typeof window.imageDisplayMode !== 'undefined' && window.imageDisplayMode === 'with_info') ? 'with_info' : 'thumbnail_only';
  const size = (typeof window.currentThumbSize !== 'undefined' && window.currentThumbSize) ? window.currentThumbSize
    : (document.getElementById('appFrame')?.getAttribute('data-thumb-size') || 'sm');
  // Image rows are NOT a single constant: the thumbnail keeps its aspect ratio, so a wider
  // picture squeezes the text column and changes how the row wraps. Small (48/70) was verified
  // exact; Large is calibrated to the measured resting height, and the per-clip measured-height
  // cache absorbs the variation between individual images from there.
  if (mode === 'with_info') return isHidden ? 48 : 70;
  if (size === 'md') return isHidden ? 70 : 101;
  return isHidden ? 48 : 77;
}

let _cachedUsableWidth = 0;
let _cachedUsableWidthZoom = 0;
let _cachedAvgCharWidth = 0;
function getZoomScale() {
  try {
    if (typeof currentZoomLevel === 'number' && currentZoomLevel > 0) return currentZoomLevel;
    const zoomHostEl = document.getElementById('mainView') || document.body;
    if (zoomHostEl.classList.contains('zoomed-125')) return 1.25;
    if (zoomHostEl.classList.contains('zoomed-110')) return 1.1;
    if (zoomHostEl.classList.contains('zoomed-90')) return 0.9;
  } catch {}
  return 1;
}
function getAverageCharWidth() {
  if (_cachedAvgCharWidth && _cachedUsableWidthZoom === getZoomScale()) return _cachedAvgCharWidth;
  // Average proportional width at 1x ~7.6px (measured for UI font at 13px). Scale with zoom.
  const scale = getZoomScale();
  _cachedAvgCharWidth = 7.6 * scale;
  _cachedUsableWidthZoom = scale;
  return _cachedAvgCharWidth;
}
function getCachedUsableWidth() {
  const scale = getZoomScale();
  if (_cachedUsableWidth > 0 && _cachedUsableWidthZoom === scale) return _cachedUsableWidth;
  let w = 0;
  try {
    const container = document.getElementById('listContainer');
    if (container && container.clientWidth > 0) {
      // Row reserves: actions ~48px + horizontal padding 24px + gap 12px (index removed)
      w = container.clientWidth - 62;
    } else if (_cachedUsableWidth > 0) {
      w = _cachedUsableWidth;
    } else {
      // Fallback for hidden state: estimate from window/appFrame
      const appFrame = document.getElementById('appFrame');
      const base = (appFrame && appFrame.clientWidth) || window.innerWidth || 680;
      w = Math.max(200, base - 120);
    }
    // Clamp to sane range and cache
    w = Math.max(180, Math.min(900, w));
    _cachedUsableWidth = Math.round(w);
    _cachedUsableWidthZoom = scale;
    // keep avg char width in sync
    _cachedAvgCharWidth = 7.6 * scale;
  } catch { w = _cachedUsableWidth || 520; }
  return w;
}
function invalidateUsableWidthCache() {
  _cachedUsableWidth = 0;
  _cachedAvgCharWidth = 0;
}
function getAdaptiveTier(clip) {
  if (!clip || clip.is_image) return 1;
  if (isCompactLayoutActive()) return 1;
  const text = (clip.text_content || clip.preview || '').trim();
  if (!text) return 1;
  const newlineCount = (text.match(/\n/g) || []).length;
  // Preserve explicit newlines: 2+ newlines naturally take 3 lines
  if (newlineCount >= 2) return 3;
  // Very short text remains 1 line
  if (text.length < 20) return 1;
  // Width-aware estimation (no DOM per-item measurement)
  const usable = getCachedUsableWidth();
  const avg = getAverageCharWidth();
  const charsPerLine = Math.max(14, Math.floor(usable / avg));
  // Split by explicit newlines and count wrapped lines per segment
  const segments = text.split('\n');
  let totalLines = 0;
  for (let seg of segments) {
    seg = seg.trim();
    if (seg.length === 0) { totalLines += 1; continue; }
    totalLines += Math.max(1, Math.ceil(seg.length / charsPerLine));
    if (totalLines >= 3) break;
  }
  if (totalLines <= 1) return 1;
  if (totalLines === 2) return 2;
  return 3;
}
function getAdaptiveHeight(clip) {
  if (clip && clip.is_image) return getThumbRowHeight();
  const t = getAdaptiveTier(clip);
  const isHidden = isClipDetailsHidden();
  if (isHidden) {
    return t === 1 ? ROW_HEIGHT_HIDDEN_AUTO_1 : t === 3 ? ROW_HEIGHT_HIDDEN_AUTO_3 : ROW_HEIGHT_HIDDEN_AUTO_2;
  }
  return t === 1 ? ROW_HEIGHT_AUTO_1 : t === 3 ? ROW_HEIGHT_AUTO_3 : ROW_HEIGHT_AUTO_2;
}
function getRowHeight(clip) {
  if (clip && clip.id != null && _measuredClipHeights.has(measuredHeightKey(clip.id))) {
    return _measuredClipHeights.get(measuredHeightKey(clip.id));
  }
  const isHidden = isClipDetailsHidden();

  // DENSE HEIGHT CONTRACT: JS bucket == CSS border-box height for every (details × lines) combo
  // lines=1: hidden=31, visible=47  (measured; the old 24/30 estimates were 7/17 short and
  //             were silently corrected on every Compact paint)
  // lines=2: hidden=38, visible=44
  // lines=3: hidden=56, visible=58
  // images (8px pad): sm=40, md=64, with_info=50
  // Compact always uses the Small image geometry. The Compact preset applies this dense
  // class, so the preview-size lookup below is guarded to Standard only — otherwise
  // changing the preview size in Settings silently resized Compact rows too.
  if (document.body.classList.contains('density-dense')) {
    const scale = getZoomScale();
    if (clip && clip.is_image) {
      const imgMode = (typeof window.imageDisplayMode !== 'undefined' && window.imageDisplayMode) ? window.imageDisplayMode : 'thumbnail_only';
      if (imgMode === 'with_info') return Math.round(50 * scale);
      if (isCompactLayoutActive()) return Math.round(47 * scale);
      const size = (typeof window.currentThumbSize !== 'undefined' && window.currentThumbSize) ? window.currentThumbSize
        : (document.getElementById('appFrame')?.getAttribute('data-thumb-size') || 'sm');
      if (size === 'md') return Math.round(64 * scale);
      return Math.round(40 * scale);
    }
    if (isCompactLayoutActive()) {
      return Math.round(31 * scale);
    }
    const mode = document.documentElement.getAttribute('data-line-display') || '1';
    let baseH = 31;
    if (mode === '1') baseH = isHidden ? 31 : 47;
    else if (mode === '2') baseH = isHidden ? 38 : 44;
    else if (mode === '3') baseH = isHidden ? 56 : 58;
    else {
      const t = getAdaptiveTier(clip);
      baseH = isHidden ? (t === 1 ? 31 : t === 3 ? 56 : 38) : (t === 1 ? 47 : t === 3 ? 58 : 44);
    }
    return Math.round(baseH * scale);
  }

  if (document.body.classList.contains('density-compact')) {
    if (clip && clip.is_image) return Math.round(47 * getZoomScale());
    const mode = document.documentElement.getAttribute('data-line-display') || '1';
    if (mode === '1') return isHidden ? 38 : 46;
    if (mode === '2') return isHidden ? 40 : 61;
    if (mode === '3') return isHidden ? 55 : 76;
    const t = getAdaptiveTier(clip);
    if (isHidden) return t === 1 ? 38 : t === 3 ? 55 : 40;
    return t === 1 ? 46 : t === 3 ? 76 : 61;
  }
  const mode = document.documentElement.getAttribute('data-line-display') || '1';
  if (mode === 'auto') return getAdaptiveHeight(clip);
  if (clip && clip.is_image) return getThumbRowHeight();
  if (mode === '2') return isHidden ? ROW_HEIGHT_HIDDEN_AUTO_2 : ROW_HEIGHT_AUTO_2;
  if (mode === '3') return isHidden ? ROW_HEIGHT_HIDDEN_AUTO_3 : ROW_HEIGHT_AUTO_3;
  return isHidden ? ROW_HEIGHT_HIDDEN_NORMAL : ROW_HEIGHT_NORMAL;
}

window.cycleSelection = function(dir) {
  if (!clips || clips.length === 0) return;
  if (selectedIndex < 0) selectedIndex = 0;
  if (dir > 0) {
    selectedIndex = (selectedIndex + 1) % clips.length;
  } else {
    selectedIndex = (selectedIndex - 1 + clips.length) % clips.length;
  }
  selectedIndices.clear();
  selectedIndices.add(selectedIndex);
  lastAnchorIndex = selectedIndex;
  renderList();
  scrollIndexIntoView(selectedIndex);
  if (typeof syncLivePreview === 'function') syncLivePreview();
};

function bumpClipToTop(clipOrId, fallbackIdx) {
  if (!clipOrId) return null;
  const clipId = (typeof clipOrId === 'object' && clipOrId !== null) ? clipOrId.id : clipOrId;
  const nowIso = new Date().toISOString();
  let foundClip = (typeof clipOrId === 'object' && clipOrId !== null) ? clipOrId : null;

  try { window._lastOptimisticPasteId = clipId; window._lastOptimisticPasteAt = Date.now(); } catch(e) {}

  const listCont = document.getElementById('listContainer');
  if (listCont) listCont.scrollTop = 0;

  const maxRank = (Array.isArray(allClips) && allClips.length > 0)
    ? allClips.reduce((max, c) => Math.max(max, (c && typeof c.sort_rank === 'number') ? c.sort_rank : 0), 0)
    : 0;
  const newSortRank = maxRank + 1;

  [allClips, clips].forEach(arr => {
    if (!Array.isArray(arr)) return;
    const i = arr.findIndex(c => c && c.id === clipId);
    if (i > -1) {
      const [t] = arr.splice(i, 1);
      const newUseCount = (t.use_count || 0) + 1;
      t.last_used_at = nowIso;
      t.time_group = 'today';
      t.use_count = newUseCount;
      t.sort_rank = newSortRank;
      t.manually_used = true;
      foundClip = t;
      const p = arr.findIndex(c => !c.pinned);
      if (t.pinned || p === -1) arr.unshift(t);
      else arr.splice(p, 0, t);
    }
  });

  if (foundClip) {
    foundClip.last_used_at = nowIso;
    foundClip.time_group = 'today';
    foundClip.use_count = (foundClip.use_count || 0) + 1;
    foundClip.sort_rank = newSortRank;
    foundClip.manually_used = true;
  }

  if (typeof sortAllClips === 'function') sortAllClips();
  const newIdx = clips.findIndex(c => c && c.id === clipId);
  selectedIndex = newIdx >= 0 ? newIdx : (typeof fallbackIdx === 'number' ? fallbackIdx : 0);
  selectedIndices.clear();
  selectedIndices.add(selectedIndex);
  lastAnchorIndex = selectedIndex;
  if (typeof applyFilters === 'function') applyFilters();
  else if (typeof renderList === 'function') renderList();

  return foundClip;
}
window.bumpClipToTop = bumpClipToTop;

function executePasteClip(clip, fallbackIdx, stayOpen = true) {
  if (!clip) return;
  bumpClipToTop(clip, fallbackIdx);

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.paste_clip === 'function') {
    if (stayOpen) {
      window.pywebview.api.paste_clip(clip.id);
    } else {
      window.pywebview.api.paste_clip(clip.id, false);
    }
  }
}
window.executePasteClip = executePasteClip;

window.pasteCurrentSelection = function() {
  if (typeof livePreviewEditMode !== 'undefined' && livePreviewEditMode) {
    const textEl = document.getElementById('livePreviewTextContent');
    const liveText = textEl ? (textEl.textContent || textEl.innerText || '') : '';
    if (liveText) {
      if (typeof setClipboardTextSafely === 'function') {
        try { setClipboardTextSafely(liveText); } catch(e) {}
      }
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.paste_text === 'function') {
        window.pywebview.api.paste_text(liveText);
      }
      return;
    }
  }

  if (selectedIndex >= 0 && selectedIndex < clips.length) {
    const clip = clips[selectedIndex];
    executePasteClip(clip, selectedIndex, true);
  }
};

function toggleGroupCollapse(grpKey) {
  collapsedGroups[grpKey] = !collapsedGroups[grpKey];
  try {
    if (typeof globalSectionCollapse !== 'undefined' && globalSectionCollapse) {
      localStorage.setItem('dualclip_collapsed_groups', JSON.stringify(collapsedGroups));
    } else {
      const colId = (typeof getActiveCollectionId === 'function') ? getActiveCollectionId() : ((typeof currentCollection !== 'undefined' && currentCollection) ? currentCollection : 'all');
      if (typeof collapsedGroupsByCollection === 'undefined') collapsedGroupsByCollection = {};
      if (!collapsedGroupsByCollection[colId]) collapsedGroupsByCollection[colId] = {};
      collapsedGroupsByCollection[colId][grpKey] = collapsedGroups[grpKey];
      localStorage.setItem('dualclip_collapsed_groups_by_collection', JSON.stringify(collapsedGroupsByCollection));
    }
  } catch(e) {}
  // Keep the toggled header anchored in the viewport so collapse/expand never jumps the list
  const container = document.getElementById('listContainer');
  let prevTop = null, prevScroll = 0;
  try {
    prevScroll = container ? container.scrollTop : 0;
    const key = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(grpKey) : grpKey;
    const btn = container ? container.querySelector('.group-chevron-btn[data-grpkey="' + key + '"]') : null;
    const headerEl = btn && btn.closest ? btn.closest('.group-header') : null;
    prevTop = headerEl ? headerEl.getBoundingClientRect().top : null;
  } catch(e) { prevTop = null; }
  renderList();
  try {
    if (container && prevTop !== null) {
      const key = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(grpKey) : grpKey;
      const btn2 = container.querySelector('.group-chevron-btn[data-grpkey="' + key + '"]');
      const headerEl2 = btn2 && btn2.closest ? btn2.closest('.group-header') : null;
      if (headerEl2) {
        const delta = headerEl2.getBoundingClientRect().top - prevTop;
        if (delta !== 0) {
          container.scrollTop = Math.max(0, prevScroll + delta);
          if (typeof renderVirtualWindow === 'function') { try { renderVirtualWindow(); } catch(e) {} }
        }
      }
    }
  } catch(e) {}
}

function createHeaderElement(item) {
  const isCollapsed = !!collapsedGroups[item.grpKey];
  const header = document.createElement('div');
  header.className = 'group-header' + (isCollapsed ? ' collapsed' : '') + (sectionClickMode === 'full_row' ? ' clickable-row' : '');
  
  if (sectionClickMode === 'full_row') {
    header.onclick = (e) => {
      // If clicking directly on chevron button, handled by its listener
      if (e.target && e.target.closest('.group-chevron-btn')) return;
      toggleGroupCollapse(item.grpKey);
    };
  }

  // Allow clicking/dragging the group header to move the window
  header.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return; // Left click only
    if (e.target && e.target.closest('.group-chevron-btn')) return; // Ignore clicks on chevron collapse button
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.start_drag === 'function') {
      window.pywebview.api.start_drag();
    } else if (typeof callHost === 'function') {
      callHost('start_drag', []);
    }
  });

  // Truncated group: show "N+" and explain why, so a page-capped number is never
  // read as an exact total.
  const countLabel = item.countOverflow ? (item.count + '+') : String(item.count);
  const countTitle = item.countOverflow
    ? (item.count + ' loaded — more may exist; scroll to load the rest')
    : '';

  header.innerHTML = `
    <div class="group-header-left">
      <button class="group-chevron-btn" title="${isCollapsed ? 'Expand section' : 'Collapse section'}" data-grpkey="${escapeHtml(item.grpKey)}">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      <span class="group-title-text">${escapeHtml(item.title.toUpperCase())}</span>
    </div>
    <span class="group-count" title="${countTitle}">${countLabel}</span>
  `;
  const chevBtn = header.querySelector('.group-chevron-btn');
  if (chevBtn) chevBtn.addEventListener('click', (ev) => { ev.stopPropagation(); const k = ev.currentTarget.getAttribute('data-grpkey') || item.grpKey; toggleGroupCollapse(k); });
  return header;
}



function getEmptyStateHtml(isSearching) {
  const searchInput = document.getElementById('searchInput');
  const query = searchInput ? searchInput.value.trim() : '';

  if (isSearching || query) {
    // 1-click escape hatch: zero hits inside a collection offer a scoped widen.
    // Scope stays strict until the user explicitly clicks (scoping rule 3).
    let scopeBtn = '';
    try {
      if (typeof currentCollection !== 'undefined' && currentCollection && currentCollection !== 'all') {
        let scopeName = currentCollection;
        if (currentCollection === 'pins') scopeName = 'Favorites';
        else if (currentCollection === 'most_used') scopeName = 'Most Used';
        else if (Array.isArray(customCollections)) {
          const found = customCollections.find(c => c && c.id === currentCollection);
          if (found && found.name) scopeName = found.name;
        }
        scopeBtn = `<div class="empty-state-desc">No matches in &quot;${escapeHtml(scopeName)}&quot;.</div>
          <button type="button" class="btn-sm st-btn-secondary" style="margin-top:10px;" onclick="searchEverywhereFromEmpty()">Search in All Clips</button>`;
      }
    } catch (e) {}
    return `<div class="empty-state">
      <div class="empty-state-icon-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          <line x1="8" y1="11" x2="14" y2="11" stroke-dasharray="2 2"></line>
        </svg>
      </div>
      <div class="empty-state-title">No matches found</div>
      <div class="empty-state-desc">Try another keyword or reset active filters.</div>
      ${scopeBtn}
    </div>`;
  }

  if (currentCollection && currentCollection !== 'all') {
    let colName = currentCollection;
    if (currentCollection === 'pins') {
      colName = 'Favorites';
    } else if (Array.isArray(customCollections)) {
      const found = customCollections.find(c => c.id === currentCollection);
      if (found && found.name) colName = found.name;
    }
    return `<div class="empty-state">
      <div class="empty-state-icon-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>
      <div class="empty-state-title">No clips in "${escapeHtml(colName)}" yet</div>
      <div class="empty-state-desc">${currentCollection === 'pins' ? 'Pin or favorite clips (Ctrl + B or right-click) to keep them here.' : 'Right-click any clip to move it here, or set an Auto-Route rule in Settings.'}</div>
    </div>`;
  }

  return `<div class="empty-state">
    <div class="empty-state-icon-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
        <line x1="9" y1="11" x2="15" y2="11"></line>
        <line x1="9" y1="15" x2="13" y2="15"></line>
      </svg>
    </div>
    <div class="empty-state-title">Clipboard is empty</div>
    <div class="empty-state-desc">Copy anything with Ctrl+C to get started.</div>
  </div>`;
}



function renderList(opts) {
  if (opts && opts.forceFull) {
    try { if (typeof invalidateCachedHeight === 'function') invalidateCachedHeight(); } catch {}
    try { lastVirtualTotalH = -1; } catch {}
    try { _hasValidHeightCache = false; } catch {}
  }
  const container = document.getElementById('listContainer');
  if (!container) return;
  // The clip list is display:none while the Settings view is open, so its clientHeight
  // measures 0. Laying out against a zero-height box produced a wrong total height and a
  // visible snap on the way back to History. Defer instead: closeSettingsView renders once
  // the list is visible and has real dimensions again.
  try {
    if (document.body.classList.contains('in-settings') || container.clientHeight === 0) {
      return;
    }
  } catch (e) {}
  // Recomputed every pass: any input that changes row height (preview size, lines, zoom,
  // layout, details) changes the key, so each combination keeps its own measured heights.
  try { refreshCachedPreferences(); refreshHeightSignature(); pruneMeasuredHeights(); } catch (e) {}
  if (typeof __dcMark === 'function') { try { __dcMark('renderList.start'); } catch (e) {} }
  // Ensure permanent virtual spacer/pool and empty overlay exist (never destroy spacer)
  let vSpacer = document.getElementById('virtualSpacer');
  let vPool = document.getElementById('virtualPool');
  let emptyOverlay = document.getElementById('emptyStateOverlay');
  if (!vSpacer || !vPool) {
    container.innerHTML = '';
    vSpacer = document.createElement('div');
    vSpacer.id = 'virtualSpacer';
    vSpacer.style.width = '1px';
    vSpacer.style.position = 'relative';
    vSpacer.style.pointerEvents = 'none';
    vSpacer.style.opacity = '0';
    vSpacer.style.margin = '0';
    vSpacer.style.padding = '0';
    vPool = document.createElement('div');
    vPool.id = 'virtualPool';
    vPool.style.position = 'absolute';
    vPool.style.top = '0';
    vPool.style.left = '0';
    vPool.style.right = '0';
    vPool.style.width = '100%';
    vPool.style.pointerEvents = 'auto';
    vPool.style.willChange = 'transform';
    // Siblings inside #listContainer — spacer solely defines scrollHeight, pool is visually shifted via transform
    container.appendChild(vSpacer);
    container.appendChild(vPool);
    if (!emptyOverlay) {
      emptyOverlay = document.createElement('div');
      emptyOverlay.id = 'emptyStateOverlay';
      emptyOverlay.style.position = 'absolute';
      emptyOverlay.style.top = '0';
      emptyOverlay.style.left = '0';
      emptyOverlay.style.right = '0';
      emptyOverlay.style.bottom = '0';
      emptyOverlay.style.display = 'none';
      emptyOverlay.style.zIndex = '1';
      emptyOverlay.style.overflow = 'hidden';
      emptyOverlay.style.alignItems = 'center';
      emptyOverlay.style.justifyContent = 'center';
      container.appendChild(emptyOverlay);
    }
  } else {
    emptyOverlay = document.getElementById('emptyStateOverlay');
    if (!emptyOverlay) {
      emptyOverlay = document.createElement('div');
      emptyOverlay.id = 'emptyStateOverlay';
      emptyOverlay.style.position = 'absolute';
      emptyOverlay.style.top = '0';
      emptyOverlay.style.left = '0';
      emptyOverlay.style.right = '0';
      emptyOverlay.style.bottom = '0';
      emptyOverlay.style.display = 'none';
      emptyOverlay.style.zIndex = '1';
      emptyOverlay.style.overflow = 'hidden';
      emptyOverlay.style.alignItems = 'center';
      emptyOverlay.style.justifyContent = 'center';
      container.appendChild(emptyOverlay);
    }
    // Ensure sibling layout (migrate old nested pool inside spacer)
    if (vPool && vPool.parentElement === vSpacer) {
      container.appendChild(vPool);
    }
  }
  // Enforce dedicated spacer/pool sibling styles (upfront height + absolute pool)
  if (vSpacer) { vSpacer.style.width = '1px'; vSpacer.style.position = 'relative'; vSpacer.style.pointerEvents = 'none'; vSpacer.style.opacity = '0'; vSpacer.style.margin = '0'; vSpacer.style.padding = '0'; }
  if (vPool) { vPool.style.position = 'absolute'; vPool.style.top = '0'; vPool.style.left = '0'; vPool.style.right = '0'; vPool.style.width = '100%'; vPool.style.pointerEvents = 'auto'; vPool.style.willChange = 'transform'; }

  if (clips.length === 0) {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput ? searchInput.value.trim() : '';
    const isSearching = Boolean(query);
    const oldTotalForEmpty = lastVirtualTotalH;
    if (oldTotalForEmpty > 0) {
      container.scrollTop = 0;
    }
    vSpacer.style.height = '0px';
    lastVirtualTotalH = 0;
    vPool.innerHTML = '';
    if (emptyOverlay) {
      emptyOverlay.innerHTML = getEmptyStateHtml(isSearching);
      emptyOverlay.style.display = 'flex';
    }
    currentFlatItems = [];
    expandedIndex = -1;
    selectedIndex = -1;
    selectedIndices.clear();
    lastAnchorIndex = 0;
    if (typeof syncSelectedIds === 'function') syncSelectedIds();
    return;
  }
  container.style.overflow = '';
  container.style.paddingBottom = '';

  currentFlatItems = [];
  if (typeof syncActiveCollapsedGroups === 'function') syncActiveCollapsedGroups();

  if (groupingMode !== 'none' && currentCollection !== 'most_used') {
    const groups = {};

    if (groupingMode === 'date' || groupingMode === 'time') {
      groups['pinned'] = { title: 'Pinned', items: [] };
      groups['today'] = { title: 'Today', items: [] };
      groups['yesterday'] = { title: 'Yesterday', items: [] };
      groups['older'] = { title: 'Older', items: [] };
      clips.forEach((clip, idx) => {
        if (clip.pinned) {
          groups['pinned'].items.push({ clip, originalIdx: idx });
        } else {
          const grp = clip.time_group || 'older';
          if (!groups[grp]) groups[grp] = { title: grp.charAt(0).toUpperCase() + grp.slice(1), items: [] };
          groups[grp].items.push({ clip, originalIdx: idx });
        }
      });
    } else if (groupingMode === 'app') {
      clips.forEach((clip, idx) => {
        let app = clip.src_process;
        if (!app) {
          try {
            const meta = typeof clip.meta_json === 'string' ? JSON.parse(clip.meta_json) : clip.meta_json;
            if (meta && meta.src_process) app = meta.src_process;
          } catch(e) {}
        }
        if (!app) app = clip.is_image ? 'Image' : 'DualClip';
        const displayTitle = typeof formatAppDisplayName === 'function' ? formatAppDisplayName(app) : app;
        const key = app.toLowerCase().replace(/\s+/g, '_');
        if (!groups[key]) groups[key] = { title: displayTitle, items: [] };
        groups[key].items.push({ clip, originalIdx: idx });
      });
    } else if (groupingMode === 'format') {
      clips.forEach((clip, idx) => {
        const tag = clip.is_image ? 'IMAGE' : (typeof getFormatTag === 'function' ? getFormatTag(clip.text_content || clip.preview || '') : 'TEXT');
        const titles = { IMAGE: 'Images & Screenshots', URL: 'Web Links', CODE: 'Code & Scripts', JSON: 'JSON & Data', MD: 'Markdown Notes', TEXT: 'Plain Text', FILE: 'Files & Folders' };
        const key = tag.toLowerCase();
        if (!groups[key]) groups[key] = { title: titles[tag] || tag, items: [] };
        groups[key].items.push({ clip, originalIdx: idx });
      });
    } else if (groupingMode === 'priority') {
      groups['pinned'] = { title: '📌 Pinned to Top', items: [] };
      groups['favorite'] = { title: '⭐ Favorites', items: [] };
      groups['recent'] = { title: 'Recent Clipboard History', items: [] };
      clips.forEach((clip, idx) => {
        if (clip.pinned) {
          groups['pinned'].items.push({ clip, originalIdx: idx });
        } else if (clip.favorite) {
          groups['favorite'].items.push({ clip, originalIdx: idx });
        } else {
          groups['recent'].items.push({ clip, originalIdx: idx });
        }
      });
    }

    // Group counts are derived from the clips loaded so far (capped by clipPageSize),
    // not from a server-side total. While more pages remain, the group whose run
    // reaches the final loaded clip is provably truncated. Flag it so the header can
    // render "N+" instead of presenting a page-capped number as the true count.
    // Resolved via originalIdx so it holds for every grouping mode without
    // duplicating each mode's key derivation.
    let openGrpKey = null;
    if (typeof hasMoreClips !== 'undefined' && hasMoreClips && Array.isArray(clips) && clips.length > 0) {
      const lastIdx = clips.length - 1;
      for (const k of Object.keys(groups)) {
        const gi = groups[k].items;
        for (let i = 0; i < gi.length; i++) {
          if (gi[i].originalIdx === lastIdx) { openGrpKey = k; break; }
        }
        if (openGrpKey) break;
      }
    }

    Object.keys(groups).forEach(grpKey => {
      const grp = groups[grpKey];
      if (grp.items.length > 0) {
        const isCollapsed = !!collapsedGroups[grpKey];
        currentFlatItems.push({
          type: 'header',
          grpKey: grpKey,
          title: grp.title,
          count: grp.items.length,
          countOverflow: grpKey === openGrpKey,
          height: getHeaderHeight()
        });

        if (!isCollapsed) {
          grp.items.forEach(({ clip, originalIdx }) => {
            const h = getRowHeight(clip);
            currentFlatItems.push({
              type: 'clip',
              clip: clip,
              originalIdx: originalIdx,
              height: h
            });
          });
        }
      }
    });
  } else {
    clips.forEach((clip, idx) => {
      const h = getRowHeight(clip);
      currentFlatItems.push({
        type: 'clip',
        clip: clip,
        originalIdx: idx,
        height: h
      });
    });
  }

  // COLLAPSED PINNED SELECTION CONTRACT:
  // If the currently selected items are hidden inside a collapsed group,
  // retain visible selected items or automatically advance selectedIndex to the first visible clip item.
  const visibleClipItems = currentFlatItems.filter(it => it.type === 'clip');
  if (visibleClipItems.length === 0) {
    // Every group collapsed: nothing is reachable by keyboard or paste-by-number,
    // so leaving selectedIndex pointing into a hidden row would act on an invisible clip.
    if (selectedIndex !== -1 || selectedIndices.size > 0) {
      selectedIndex = -1;
      selectedIndices.clear();
      // 0, not -1: shift-arrow ranges compute Math.min(lastAnchorIndex, selectedIndex),
      // and a -1 anchor would seed the range with an out-of-bounds index.
      lastAnchorIndex = 0;
      if (typeof syncSelectedIds === 'function') syncSelectedIds();
    }
  } else {
    const visibleOriginalIndices = new Set(visibleClipItems.map(it => it.originalIdx));
    const survivingIndices = Array.from(selectedIndices).filter(idx => visibleOriginalIndices.has(idx));
    if (survivingIndices.length > 0) {
      selectedIndices.clear();
      survivingIndices.forEach(idx => selectedIndices.add(idx));
      if (!visibleOriginalIndices.has(selectedIndex)) {
        selectedIndex = survivingIndices[0];
        lastAnchorIndex = selectedIndex;
      }
    } else {
      const firstVisible = visibleClipItems[0].originalIdx;
      selectedIndex = firstVisible;
      selectedIndices.clear();
      selectedIndices.add(selectedIndex);
      lastAnchorIndex = selectedIndex;
    }
    if (typeof syncSelectedIds === 'function') syncSelectedIds();
  }

  const oldTotal = lastVirtualTotalH;
  let runningTop = 0;
  let visualRowCounter = 0;
  const rowGap = cardsRowGap();
  for (let i = 0; i < currentFlatItems.length; i++) {
    const item = currentFlatItems[i];
    const h = item.type === 'header' ? getHeaderHeight() : getRowHeight(item.clip);
    item.top = runningTop;
    item.height = h + (item.type === 'clip' ? rowGap : 0);
    if (item.type === 'clip') {
      item.visualRowIdx = visualRowCounter++;
    }
    runningTop += item.height;
  }
  const bottomPad = 12;
  const maxScroll = Math.max(0, runningTop + bottomPad - (container ? container.clientHeight : 0));
  if (container && container.scrollTop > maxScroll) {
    container.scrollTop = maxScroll;
  }
  vSpacer.style.height = `${runningTop + bottomPad}px`;
  lastVirtualTotalH = runningTop + bottomPad;

  if (typeof __dcMark === 'function') { try { __dcMark('renderList.laidout'); } catch (e) {} }
  renderVirtualWindow();
}

function invalidateHeights() {
  // Intentionally does NOT clear the measured-height cache. The cache is keyed by the
  // inputs that decide a row's height, so this pass simply re-lays out with the key for the
  // current combination. Clearing here is what made every preview-size change fall back to
  // the estimates and visibly jump.
  if (!currentFlatItems || currentFlatItems.length === 0) {
    renderList();
    return;
  }
  const container = document.getElementById('listContainer');
  let runningTop = 0;
  const rowGap = cardsRowGap();
  for (let i = 0; i < currentFlatItems.length; i++) {
    const item = currentFlatItems[i];
    const h = item.type === 'header' ? getHeaderHeight() : getRowHeight(item.clip);
    item.top = runningTop;
    item.height = h + (item.type === 'clip' ? rowGap : 0);
    runningTop += item.height;
  }
  const bottomPad2 = 12;
  if (container) {
    const maxScroll2 = Math.max(0, runningTop + bottomPad2 - container.clientHeight);
    if (container.scrollTop > maxScroll2) {
      container.scrollTop = maxScroll2;
    }
  }
  const sp = document.getElementById('virtualSpacer');
  if (sp) sp.style.height = `${runningTop + bottomPad2}px`;
  lastVirtualTotalH = runningTop + bottomPad2;
  renderVirtualWindow();
}

function renderVirtualWindow() {
  const container = document.getElementById('listContainer');
  if (!container) return;
  if (typeof __dcMark === 'function') { try { __dcMark('renderVirtualWindow.start'); } catch (e) {} }
  if (currentFlatItems.length === 0) {
    let __vSpacerEmpty = document.getElementById('virtualSpacer');
    let __vPoolEmpty = document.getElementById('virtualPool');
    let __emptyOv = document.getElementById('emptyStateOverlay');
    if (__vSpacerEmpty) __vSpacerEmpty.style.height = '0px';
    lastVirtualTotalH = 0;
    if (__vPoolEmpty) __vPoolEmpty.innerHTML = '';
    const searchInput = document.getElementById('searchInput');
    const query = searchInput ? searchInput.value.trim() : '';
    if (__emptyOv) {
      __emptyOv.innerHTML = getEmptyStateHtml(Boolean(query));
      __emptyOv.style.display = 'flex';
    } else {
      // fallback: ensure overlay exists (renderList should have created it)
      const __ov = document.createElement('div');
      __ov.id = 'emptyStateOverlay';
      __ov.style.position = 'absolute';
      __ov.style.top = '0';
      __ov.style.left = '0';
      __ov.style.right = '0';
      __ov.style.bottom = '0';
      __ov.style.display = 'flex';
      __ov.style.zIndex = '1';
      __ov.innerHTML = getEmptyStateHtml(Boolean(query));
      container.appendChild(__ov);
    }
    return;
  }

  const scrollTop = container.scrollTop;
  const clientHeight = getEffectiveClientHeight(container);
  const overscan = 4;

  // Binary search on precomputed cumulative offsets (O(log N)) — no height re-estimation here
  function lowerBound(target) {
    let lo = 0, hi = currentFlatItems.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (currentFlatItems[mid].top < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  let startIdx = lowerBound(scrollTop);
  // include partially visible previous item
  if (startIdx > 0 && currentFlatItems[startIdx - 1].top + currentFlatItems[startIdx - 1].height > scrollTop) {
    startIdx--;
  }
  startIdx = Math.max(0, startIdx - overscan);
  let endIdx = lowerBound(scrollTop + clientHeight + 1);
  endIdx = Math.min(currentFlatItems.length, endIdx + overscan);

  const offsetY = startIdx < currentFlatItems.length ? currentFlatItems[startIdx].top : 0;

  let vSpacer = document.getElementById('virtualSpacer');
  let vPool = document.getElementById('virtualPool');
  if (!vSpacer || !vPool) {
    const __existingOverlay = document.getElementById('emptyStateOverlay');
    // do not destroy overlay — rebuild spacer/pool via DOM, preserving overlay
    vSpacer = document.createElement('div');
    vSpacer.id = 'virtualSpacer';
    vSpacer.style.width = '1px';
    vSpacer.style.position = 'relative';
    vSpacer.style.pointerEvents = 'none';
    vSpacer.style.opacity = '0';
    vSpacer.style.margin = '0';
    vSpacer.style.padding = '0';
    vPool = document.createElement('div');
    vPool.id = 'virtualPool';
    vPool.style.position = 'absolute';
    vPool.style.top = '0';
    vPool.style.left = '0';
    vPool.style.right = '0';
    vPool.style.width = '100%';
    vPool.style.pointerEvents = 'auto';
    vPool.style.willChange = 'transform';
    // Siblings — spacer solely defines scrollHeight, pool is visually shifted via transform
    // clear only pool-related content, keep overlay if present
    const __ov = __existingOverlay;
    container.innerHTML = '';
    container.appendChild(vSpacer);
    container.appendChild(vPool);
    if (__ov) container.appendChild(__ov);
    else {
      const __newOv = document.createElement('div');
      __newOv.id = 'emptyStateOverlay';
      __newOv.style.position = 'absolute';
      __newOv.style.top = '0';
      __newOv.style.left = '0';
      __newOv.style.right = '0';
      __newOv.style.bottom = '0';
      __newOv.style.display = 'none';
      __newOv.style.zIndex = '1';
      container.appendChild(__newOv);
    }
    vSpacer = document.getElementById('virtualSpacer');
    vPool = document.getElementById('virtualPool');
    if (lastVirtualTotalH >= 0) vSpacer.style.height = `${lastVirtualTotalH}px`;
  }
  // hide empty overlay when we have items
  const __ovHide = document.getElementById('emptyStateOverlay');
  if (__ovHide) __ovHide.style.display = 'none';
  // vSpacer.style.height is NEVER mutated here — immutable during scroll
  vPool.style.transform = `translateY(${offsetY}px)`;
  vPool.innerHTML = '';

  const searchInputEl = document.getElementById('searchInput');
  _cachedIsActivelySearching = Boolean(searchInputEl && searchInputEl.value.trim().length > 0);

  for (let i = startIdx; i < endIdx; i++) {
    const it = currentFlatItems[i];
    if (it.type === 'header') {
      vPool.appendChild(createHeaderElement(it));
    } else {
      vPool.appendChild(createRowElement(it.clip, it.originalIdx, it.height, it.visualRowIdx));
    }
  }

  // Height self-correction: the inline lock above keeps scroll math stable, but zoom levels,
  // badges, thumbnails, or font scaling can make natural content taller or shorter than the
  // estimate — taller used to chop the bottom metadata footer, shorter left an empty gap.
  // Fit only mismatched rows to their measured height and shift following offsets + spacer.
  try {
    const poolKids = vPool.children;
    const rowGap = cardsRowGap();
    let shift = 0;
    let refitCount = 0;
    let minModifiedIdx = currentFlatItems.length;
    // Phase 1: Read natural heights without mutating styles (prevents layout thrashing)
    const mismatches = [];
    for (let k = 0; k < poolKids.length; k++) {
      const el = poolKids[k];
      const flatIdx = startIdx + k;
      const it = currentFlatItems[flatIdx];
      if (!el || !it || it.type !== 'clip') continue;
      const natural = el.scrollHeight;
      if (!natural || natural <= 0) continue;
      // it.height includes the cards gap; scrollHeight excludes margins, so compare gap-aware
      const naturalBucket = natural + rowGap;
      let fitted = it.height;
      if (naturalBucket > it.height + 1) fitted = Math.ceil(naturalBucket);
      else if (naturalBucket < it.height - 1) fitted = Math.max(1 + rowGap, Math.floor(naturalBucket));
      if (fitted !== it.height) {
        mismatches.push({ el, it, flatIdx, fitted, delta: fitted - it.height, natural });
      }
    }

    // Phase 2: Batch write all fitted heights and update caches
    if (mismatches.length > 0) {
      for (let m = 0; m < mismatches.length; m++) {
        const { el, it, flatIdx, fitted, delta, natural } = mismatches[m];
        try {
          if (typeof logLayoutDebug === 'function') {
            logLayoutDebug(`[HEIGHT MISMATCH] thumb=${document.getElementById('appFrame')?.getAttribute('data-thumb-size') || 'unset'} layout=${document.documentElement.getAttribute('data-layout-preset') || 'unset'} dense=${document.body.classList.contains('density-dense')} details=${document.documentElement.getAttribute('data-clip-details') || 'unset'} isImage=${!!(it.clip && it.clip.is_image)} id=${it.clip?.id} natural=${natural} current=${it.height} -> fitted=${fitted} delta=${delta}`);
          }
        } catch (e) {}
        el.style.height = (fitted - rowGap) + 'px';
        it.height = fitted;
        if (it.clip && it.clip.id != null) {
          _measuredClipHeights.set(measuredHeightKey(it.clip.id), fitted - (it.type === 'clip' ? rowGap : 0));
        }
        shift += delta;
        refitCount++;
        if (flatIdx < minModifiedIdx) minModifiedIdx = flatIdx;
      }
    }

    if (shift !== 0 && minModifiedIdx < currentFlatItems.length) {
      try {
        if (typeof logLayoutDebug === 'function') {
          logLayoutDebug(`[LAYOUT SHIFT] thumb=${document.getElementById('appFrame')?.getAttribute('data-thumb-size') || 'unset'} layout=${document.documentElement.getAttribute('data-layout-preset') || 'unset'} total=${shift}px rowsRefitted=${refitCount} from flatIdx=${minModifiedIdx}`);
        }
      } catch (e) {}
      let runningTop = currentFlatItems[minModifiedIdx].top;
      for (let j = minModifiedIdx; j < currentFlatItems.length; j++) {
        currentFlatItems[j].top = runningTop;
        runningTop += currentFlatItems[j].height;
      }
      lastVirtualTotalH = runningTop + 4;
      if (vSpacer) vSpacer.style.height = `${lastVirtualTotalH}px`;
    }
  } catch (e) {}

  // Infinite scroll: within 15 items of the loaded end, fetch the next page.
  // Guarded inside loadNextClipPage (isLoadingMoreClips/hasMoreClips/sequence),
  // so rapid scroll renders can never fire duplicate fetches.
  try {
    if (typeof loadNextClipPage === 'function'
        && typeof hasMoreClips !== 'undefined' && hasMoreClips
        && typeof isLoadingMoreClips !== 'undefined' && !isLoadingMoreClips
        && currentFlatItems.length > 0
        && endIdx >= currentFlatItems.length - 15) {
      loadNextClipPage();
    }
  } catch (e) {}
}

function clearAllDraggingState() {
  try {
    document.querySelectorAll('.clip-row.dragging').forEach(r => r.classList.remove('dragging'));
    document.querySelectorAll('.col-pill.drop-target-hover').forEach(p => p.classList.remove('drop-target-hover'));
    document.querySelectorAll('.sidebar-nav-item.sidebar-drag-over').forEach(s => s.classList.remove('sidebar-drag-over'));
  } catch {}
  if (!window._isNativeDragActive) {
    window._draggedClipIds = null;
  }
}
window.clearAllDraggingState = clearAllDraggingState;

try {
  window.addEventListener('blur', () => { clearAllDraggingState(); });
  window.addEventListener('pointerenter', (e) => { if (e.buttons === 0) clearAllDraggingState(); });
  window.addEventListener('pointermove', (e) => {
    if (e.buttons === 0 && document.querySelector('.clip-row.dragging')) {
      clearAllDraggingState();
    }
  });
} catch (_) {}

function findNearestPill(x, y, maxDistance = 32) {
  const pills = document.querySelectorAll('.col-pill:not(.add-btn)');
  let bestPill = null;
  let bestDist = Infinity;
  for (const p of pills) {
    const r = p.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return p; // Direct hit
    }
    const cx = Math.max(r.left, Math.min(x, r.right));
    const cy = Math.max(r.top, Math.min(y, r.bottom));
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < bestDist && dist <= maxDistance) {
      bestDist = dist;
      bestPill = p;
    }
  }
  return bestPill;
}

function createRowElement(clip, idx, forcedHeight, visualRowIdx) {
  const row = document.createElement('div');
  const isVoice = (clip.track === 'voice') || String(clip.src_process || '').toLowerCase().includes('wispr');
  const isUsed = Boolean(clip.manually_used || (clip.use_count && clip.use_count > 0));
  const isSel = selectedIndices.has(idx);
  const isExp = false;
  const isPinned = !!clip.pinned;
  const isFavorite = !!clip.favorite;
  const parityIdx = typeof visualRowIdx === 'number' ? visualRowIdx : idx;
  const zebraClass = (parityIdx % 2 === 0) ? ' zebra-even' : ' zebra-odd';
  row.className = 'clip-row' + zebraClass + (isUsed ? ' used' : '') + (isSel ? ' selected' : '') + (isExp ? ' expanded' : '') + (isPinned ? ' is-pinned' : '') + (isFavorite ? ' is-favorite' : '');
  row.setAttribute('data-idx', String(idx));
  row.setAttribute('tabindex', '-1');
  row.setAttribute('draggable', 'false');
  row.style.webkitUserDrag = 'none';
  row.style.userSelect = 'none';
  // Prevent dual drag system conflict: use pointerdown + 5px threshold → native DoDragDrop, never HTML5 dragstart
  (function bindNativeDrag(rowEl, clipRef, idxRef){
    let dragState = { active:false, startX:0, startY:0, hasFired:false, pointerId:null, dragIds:null };
    rowEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // Pill moves and external file-drag are independent: track the gesture if either is on
      if (!isFeatureEnabled('dragOut') && !isFeatureEnabled('collectionDragDrop')) return;
      // Hit-test: if pointer down on interactive button, let click proceed, don't start drag
      if (e.target.closest('button, .btn-action, .btn-favorite, .btn-pin, .row-actions, input, a, .row-action-btn, .favorite-btn, .pin-btn')) return;
      // Prevent drag-induced text selection (no blue highlight)
      try { e.preventDefault(); } catch {}
      try { if (window.getSelection) window.getSelection().removeAllRanges(); } catch {}
      // Only primary button, track start
      dragState.startX = e.clientX;
      dragState.startY = e.clientY;
      dragState.hasFired = false;
      dragState.pointerId = e.pointerId;
      // Compute batch ids upfront (for both internal pill and external file)
      let dragIds = [clipRef.id];
      if (selectedIndices && selectedIndices.size > 1 && selectedIndices.has(idxRef)) {
        dragIds = Array.from(selectedIndices).sort((a,b)=>a-b).map(i=>clips[i]).filter(c=>c&&c.id!=null).map(c=>c.id);
        if (dragIds.length===0) dragIds=[clipRef.id];
      }
      dragState.dragIds = dragIds;
      window._draggedClipIds = dragIds;
      window._internalDropOccurred = false;
      try { rowEl.setPointerCapture(e.pointerId); } catch {}

      const onMove = (ev) => {
        const dx = ev.clientX - dragState.startX;
        const dy = ev.clientY - dragState.startY;
        if (!dragState.active && Math.hypot(dx, dy) >= 5) {
          dragState.active = true;
          try { if (window.getSelection) window.getSelection().removeAllRanges(); } catch {}
          rowEl.classList.add('dragging');
          if (dragIds.length > 1) {
            try { document.querySelectorAll('.clip-row.selected').forEach(r => r.classList.add('dragging')); } catch {}
          }
        }
        if (!dragState.active) return;

        // Check live hover over collection bar pills with generous proximity or sidebar nav items
        let nearestPill = findNearestPill(ev.clientX, ev.clientY, 28);
        let targetSidebarItem = null;
        if (!nearestPill) {
          const elUnder = document.elementFromPoint(ev.clientX, ev.clientY);
          if (elUnder) {
            const hitPill = elUnder.closest('.col-pill:not(.add-btn)');
            if (hitPill) nearestPill = hitPill;
            else {
              const hitSidebar = elUnder.closest('.sidebar-nav-item[data-col-id]');
              if (hitSidebar) targetSidebarItem = hitSidebar;
            }
          }
        }
        document.querySelectorAll('.col-pill.drop-target-hover').forEach(p => {
          if (p !== nearestPill) p.classList.remove('drop-target-hover');
        });
        document.querySelectorAll('.sidebar-nav-item.sidebar-drag-over').forEach(s => {
          if (s !== targetSidebarItem) s.classList.remove('sidebar-drag-over');
        });
        if (nearestPill) {
          nearestPill.classList.add('drop-target-hover');
        }
        if (targetSidebarItem) {
          targetSidebarItem.classList.add('sidebar-drag-over');
        }

        // Only launch native file drag if pointer is clearly exiting the window boundaries and NOT targeting a collection pill or sidebar item
        const isExitingWindow = ev.clientX <= 2 || ev.clientX >= (window.innerWidth - 2) || ev.clientY <= 2 || ev.clientY >= (window.innerHeight - 2);

        if (isExitingWindow && !nearestPill && !targetSidebarItem && !dragState.hasFired && isFeatureEnabled('dragOut')) {
          dragState.hasFired = true;
          window._isNativeDragActive = true;
          clearAllDraggingState();
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          try { rowEl.releasePointerCapture(e.pointerId); } catch {}
          rowEl._suppressClickUntil = Date.now() + 500;

          // Optimistically bump dragged clip(s) to the top of the list
          if (Array.isArray(dragIds) && dragIds.length > 0) {
            for (let i = dragIds.length - 1; i >= 0; i--) {
              bumpClipToTop(dragIds[i]);
            }
          } else if (clipRef && clipRef.id != null) {
            bumpClipToTop(clipRef.id);
          }

          if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.start_file_drag === 'function') {
            const payload = dragIds.length > 1 ? dragIds : dragIds[0];
            try {
              const dragOutMode = localStorage.getItem('dualclip_drag_out_mode') || 'file';
              window.pywebview.api.start_file_drag(payload, dragOutMode).then(() => {
                window._isNativeDragActive = false;
                window._draggedClipIds = null;
                clearAllDraggingState();
                dragState.active = false;
                dragState.hasFired = false;
              }).catch(() => {
                window._isNativeDragActive = false;
                window._draggedClipIds = null;
                clearAllDraggingState();
                dragState.active = false;
                dragState.hasFired = false;
              });
            } catch {
              window._isNativeDragActive = false;
              window._draggedClipIds = null;
              clearAllDraggingState();
              dragState.active = false;
              dragState.hasFired = false;
            }
          }
        }
      };
      const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try { rowEl.releasePointerCapture(e.pointerId); } catch {}
        document.querySelectorAll('.col-pill.drop-target-hover').forEach(p => p.classList.remove('drop-target-hover'));
        document.querySelectorAll('.sidebar-nav-item.sidebar-drag-over').forEach(s => s.classList.remove('sidebar-drag-over'));

        if (!dragState.active && !dragState.hasFired) {
          dragState.active = false;
          dragState.hasFired = false;
          return;
        }

        const wasActiveDrag = dragState.active;
        if (wasActiveDrag) {
          rowEl._suppressClickUntil = Date.now() + 350;
        }

        // Drop detection: check nearest pill within forgiving distance or via direct elementFromPoint (including sidebar nav)
        try {
          let pill = findNearestPill(ev.clientX, ev.clientY, 32);
          let targetColId = null;
          let targetColName = null;
          if (!pill) {
            const elUnder = document.elementFromPoint(ev.clientX, ev.clientY);
            if (elUnder) {
              const hitPill = elUnder.closest('.col-pill:not(.add-btn)');
              if (hitPill) pill = hitPill;
              else {
                const hitSidebar = elUnder.closest('.sidebar-nav-item[data-col-id]');
                if (hitSidebar) {
                  targetColId = hitSidebar.getAttribute('data-col-id');
                }
              }
            }
          }
          if (pill && !pill.classList.contains('add-btn')) {
            targetColId = pill.id ? pill.id.replace('pill_', '') : pill.getAttribute('data-col-id') || pill.getAttribute('data-collection');
          }
          if (targetColId && typeof handleCollectionPillDrop === 'function') {
            targetColName = targetColId;
            try {
              if (targetColId === 'all') targetColName = 'All Clips';
              else if (targetColId === 'pins') targetColName = 'Favorites';
              else if (targetColId === 'most_used') targetColName = 'Most Used';
              else if (Array.isArray(customCollections)) {
                const t = customCollections.find(c => c && c.id === targetColId);
                if (t && t.name) targetColName = t.name;
              }
            } catch {}
            const movedIds = Array.isArray(dragState.dragIds) ? [...dragState.dragIds] : [dragState.dragIds];
            const fakeEvent = {
              dataTransfer: {
                getData: (type) => {
                  if (type === 'application/x-dualclip-ids') return JSON.stringify(dragState.dragIds);
                  if (type === 'application/x-dualclip-clip-id' || type === 'application/x-dualclip-id') return String(dragState.dragIds[0]);
                  return '';
                }
              },
              preventDefault: () => {},
              stopPropagation: () => {}
            };
            handleCollectionPillDrop(targetColId, targetColName, fakeEvent, movedIds);
            window._internalDropOccurred = true;
            // Global click suppression: the drop re-renders rows, so a per-element
            // flag would die with the old row before the click dispatches
              // Retain selection of moved items in their new list positions
              if (movedIds.length > 0 && Array.isArray(clips) && selectedIndices) {
                setTimeout(() => {
                  const newIndices = new Set();
                  let firstNewIdx = -1;
                  movedIds.forEach(mId => {
                    const foundIdx = clips.findIndex(c => c && c.id === mId);
                    if (foundIdx !== -1) {
                      newIndices.add(foundIdx);
                      if (firstNewIdx === -1) firstNewIdx = foundIdx;
                    }
                  });
                  if (newIndices.size > 0) {
                    selectedIndices.clear();
                    newIndices.forEach(i => selectedIndices.add(i));
                    if (firstNewIdx !== -1) {
                      selectedIndex = firstNewIdx;
                      lastAnchorIndex = firstNewIdx;
                    }
                    renderVirtualWindow();
                  }
                }, 50);
              }
            }
          } catch {}

        window.removeEventListener('dualclip:window-hide', onHideCleanup);
        setTimeout(() => {
          rowEl.classList.remove('dragging');
          try { document.querySelectorAll('.clip-row.dragging').forEach(r => r.classList.remove('dragging')); } catch {}
          try { document.querySelectorAll('.col-pill.drop-target-hover').forEach(p => p.classList.remove('drop-target-hover')); } catch {}
          if (!window._internalDropOccurred) window._draggedClipIds = null;
          dragState.active = false;
          dragState.hasFired = false;
        }, 150);
      };
      // Guard window hide mid-gesture
      const onHideCleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('dualclip:window-hide', onHideCleanup);
        rowEl.classList.remove('dragging');
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, {once:true});
      window.addEventListener('pointercancel', onUp, {once:true});
      window.addEventListener('dualclip:window-hide', onHideCleanup, {once:true});
    });
    // Prevent context menu from interfering with drag
    rowEl.addEventListener('contextmenu', (e)=>{ if(dragState.hasFired) e.preventDefault(); });
  })(row, clip, idx);

  // Pre-warm temp file on hover for Anti-Gravity/Chromium fast-drop race (debounced & bounded)
  let _prewarmTimer = null;
  row.addEventListener('mouseenter', () => {
    if (!isFeatureEnabled('dragOut')) return;
    if (!window._dualclipTempCache) window._dualclipTempCache = new Map();
    if (!window._dualclipTempInFlight) window._dualclipTempInFlight = new Set();
    if (window._dualclipTempCache.has(clip.id) || window._dualclipTempInFlight.has(clip.id)) return;

    _prewarmTimer = setTimeout(() => {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_clip_temp_file === 'function') {
        try {
          window._dualclipTempInFlight.add(clip.id);
          const p = window.pywebview.api.get_clip_temp_file(clip.id);
          if (p && typeof p.then === 'function') {
            p.then(res => {
              window._dualclipTempInFlight.delete(clip.id);
              if (res && res.ok && res.path) {
                if (window._dualclipTempCache.size >= 50) {
                  const firstKey = window._dualclipTempCache.keys().next().value;
                  window._dualclipTempCache.delete(firstKey);
                }
                const u = `file:///${res.path.replace(/\\/g, '/')}`;
                window._dualclipTempCache.set(clip.id, u);
              }
            }).catch(() => { window._dualclipTempInFlight.delete(clip.id); });
          }
        } catch { window._dualclipTempInFlight.delete(clip.id); }
      }
    }, 150);
  });
  row.addEventListener('mouseleave', () => {
    if (_prewarmTimer) { clearTimeout(_prewarmTimer); _prewarmTimer = null; }
  });

  // Multi-Select & Single-Select Click Handler
  row.onclick = (e) => {
    try { if (window._pillDropSuppressUntil && Date.now() < window._pillDropSuppressUntil) return; } catch {}
    if (row._suppressClickUntil && Date.now() < row._suppressClickUntil) {
      delete row._suppressClickUntil;
      return;
    }
    if (e.target.closest('button') || e.target.closest('.group-chevron-btn')) return;

    // Alt + Click: Open full preview modal
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      selectedIndex = idx;
      selectedIndices.clear();
      selectedIndices.add(idx);
      lastAnchorIndex = idx;
      renderVirtualWindow();
      if (typeof openFullPreviewModal === 'function') {
        openFullPreviewModal(clip);
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      // Ctrl + Click: Toggle item in/out of selection set
      if (selectedIndices.has(idx)) {
        selectedIndices.delete(idx);
        if (selectedIndex === idx) {
          selectedIndex = selectedIndices.size > 0 ? Array.from(selectedIndices)[selectedIndices.size - 1] : -1;
        }
      } else {
        selectedIndices.add(idx);
        selectedIndex = idx;
      }
      lastAnchorIndex = selectedIndex >= 0 ? selectedIndex : 0;
    } else if (e.shiftKey) {
      // Shift + Click: Select range (clamped to list boundaries)
      const safeAnchor = Math.max(0, Math.min(lastAnchorIndex, clips.length - 1));
      const safeIdx = Math.max(0, Math.min(idx, clips.length - 1));
      const start = Math.min(safeAnchor, safeIdx);
      const end = Math.max(safeAnchor, safeIdx);
      selectedIndices.clear();
      for (let i = start; i <= end; i++) {
        if (i < clips.length) selectedIndices.add(i);
      }
      selectedIndex = safeIdx;
      lastAnchorIndex = safeAnchor;
    } else {
      // Normal Single Click
      selectedIndices.clear();
      selectedIndices.add(idx);
      selectedIndex = idx;
      lastAnchorIndex = idx;
    }

    if (typeof syncSelectedIds === 'function') syncSelectedIds();

    // Mouse-selected a clip: leave search box or buttons so Space triggers QuickLook, not typing or button clicks
    try {
      const ae = document.activeElement;
      if (ae && ae !== document.body) ae.blur();
    } catch {}

    renderVirtualWindow();
    if (typeof syncLivePreview === 'function') syncLivePreview();
  };

  // Double Click Handler: paste the clip and close the window.
  row.ondblclick = (e) => {
    e.stopPropagation();
    if (e.target.closest('button')) return;
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (_) {}
    executePasteClip(clip, idx, false);
  };

  row.oncontextmenu = (e) => {
    if (typeof openContextMenu === 'function') openContextMenu(e, idx);
  };

  const tag = clip.is_image ? 'IMAGE' : (typeof getFormatTag === 'function' ? getFormatTag(clip.text_content || clip.preview || '') : 'TEXT');
  const isMono = tag === 'CODE' || tag === 'JSON' || tag === 'MD';

  let lineMode = document.documentElement.getAttribute('data-line-display') || '1';
  let customTitle = (clip.custom_title && clip.custom_title.trim()) ? clip.custom_title.trim() : '';
  let rawText = customTitle || clip.text_content || clip.preview || clip.title || '';
  if (rawText.length > 1500) {
    rawText = rawText.slice(0, 1500);
  }
  
  let isCompactLayout = isCompactLayoutActive();

  let textDisplay = rawText;
  if (lineMode === '1' || (lineMode === 'auto' && isCompactLayout)) {
    textDisplay = rawText.replace(/\s+/g, ' ').trim();
  } else if (lineMode === '2' || lineMode === '3' || lineMode === 'auto') {
    textDisplay = rawText.replace(/\n\s*\n/g, '\n').trim();
  }

  // Auto-adaptive tier — strict height lock to prevent scrollHeight drift (rubber scrollbar fix)
  let autoTier = null;
  let autoClamp = null;
  try {
    if (lineMode === 'auto' && !clip.is_image && typeof getAdaptiveTier === 'function') {
      autoTier = getAdaptiveTier(clip);
      autoClamp = autoTier;
    }
    if (typeof getRowHeight === 'function') {
      const reservedH = (typeof forcedHeight === 'number' && forcedHeight > 0) ? forcedHeight : getRowHeight(clip);
      row.style.height = reservedH + 'px';
    }
  } catch (e) {
    try { row.style.height = '48px'; } catch {}
  }

  const labelStyle = _cachedLabelStylePref || 'pill';
  const badgeClass = labelStyle === 'plain' ? 'style-plain' : (labelStyle === 'pill' ? 'style-blue' : 'style-gray');

  // Tag badges render from the clip's real tag assignments (`tags`), falling
  // back to the nickname label only for clips that have no assigned tags yet.
  // Chips emit `tag:<name>`, which the search layer resolves against the tag
  // tables, so the badge text must be a real tag name to round-trip correctly.
  let nickBadge = '';
  {
    const assignedTags = Array.isArray(clip.tags)
      ? clip.tags.map(t => String(t == null ? '' : t).trim()).filter(Boolean)
      : [];
    const rawTags = assignedTags.length > 0
      ? assignedTags
      : (clip.nickname && clip.nickname.trim()
          ? clip.nickname.split(/[,，]/).map(t => t.trim()).filter(Boolean)
          : []);
    if (rawTags.length > 0) {
      const MAX_VISIBLE_TAGS = 2;
      const visibleTags = rawTags.slice(0, MAX_VISIBLE_TAGS);
      const overflowTags = rawTags.slice(MAX_VISIBLE_TAGS);

      const visibleHtml = visibleTags.map(tag => 
        `<span class="clip-nickname-badge ${badgeClass}" data-tag="${escapeHtml(tag)}" onclick="handleTagBadgeClick(event, this.dataset.tag)" title="Tag: ${escapeHtml(tag)}">${escapeHtml(tag)}</span>`
      ).join('');

      let overflowHtml = '';
      if (overflowTags.length > 0) {
        const overflowListStr = escapeHtml(overflowTags.join(', '));
        const overflowJson = escapeHtml(JSON.stringify(overflowTags));
        overflowHtml = `<span class="clip-nickname-overflow-badge ${badgeClass}" data-overflow-tags="${overflowJson}" onclick="handleTagOverflowClick(event)" title="${overflowTags.length} more tags: ${overflowListStr}">+${overflowTags.length}</span>`;
      }

      nickBadge = visibleHtml + overflowHtml;
    }
  }

  let topBodyHtml = '';
  // imageDisplayMode/currentThumbSize are declared in settings.js (loaded after render.js); use window guard to avoid TDZ ReferenceError
  const safeImageMode = (typeof window.imageDisplayMode !== 'undefined' && window.imageDisplayMode) ? window.imageDisplayMode : 'thumbnail_only';
  if (clip.is_image) {
    const rawThumb = clip.thumbnail_data || '';
    const thumbSrc = typeof sanitizeImageSrc === 'function' ? sanitizeImageSrc(rawThumb) : rawThumb;
    if (safeImageMode === 'thumbnail_only') {
      topBodyHtml = thumbSrc ? `
        <img class="direct-thumbnail" src="${thumbSrc}" alt="screenshot" loading="lazy" onerror="this.style.display='none'">
      ` : `
        <div class="direct-thumbnail-placeholder" aria-label="image unavailable">🖼️</div>
      `;
    } else {
      topBodyHtml = thumbSrc ? `
        <img class="direct-thumbnail" src="${thumbSrc}" alt="screenshot" loading="lazy" style="height: 28px;">
        <div class="row-text mono">${escapeHtml(clip.img_dims || '1920 × 1080')} • ${escapeHtml(clip.img_size || 'PNG')}</div>
      ` : `
        <div class="direct-thumbnail-placeholder" aria-label="image unavailable">🖼️</div>
        <div class="row-text mono">${escapeHtml(clip.img_dims || '1920 × 1080')} • ${escapeHtml(clip.img_size || 'PNG')}</div>
      `;
    }
  } else {
    if (lineMode === 'auto' && autoClamp) {
      topBodyHtml = `<div class="row-text ${isMono ? 'mono' : ''} auto-tier-${autoClamp}" dir="auto" style="-webkit-line-clamp:${autoClamp};line-clamp:${autoClamp}"></div>`;
    } else {
      topBodyHtml = `<div class="row-text ${isMono ? 'mono' : ''}" dir="auto"></div>`;
    }
  }

  const starSvg = isFavorite
    ? `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
    : `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

  const pinSvg = isPinned
    ? `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22" stroke-width="2"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>`
    : `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>`;

  const showCountBadge = _cachedUseCountBadgePref;
  const countBadgeHtml = (showCountBadge && !isVoice && clip.use_count && clip.use_count > 1) 
    ? `<span class="row-use-badge" title="Pasted ${clip.use_count} times">×${clip.use_count}</span>` 
    : '';
  const isActivelySearching = _cachedIsActivelySearching;
  const shouldShowBadge = (clip.collection && clip.collection !== 'all' && clip.collection !== 'favorites' && clip.collection !== 'pins') && (isActivelySearching || groupingMode === 'app');
  let collectionBadgeHtml = '';
  if (shouldShowBadge) {
    const badgeColName = (typeof resolveCollectionDisplayName === 'function') ? resolveCollectionDisplayName(clip.collection) : clip.collection;
    collectionBadgeHtml = `<span class="row-collection-badge" title="Collection: ${escapeHtml(badgeColName)}" style="background: var(--tag-bg); border: 1px solid var(--tag-border); color: var(--tag-text); font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 10px; margin-right: 6px;">${escapeHtml(badgeColName)}</span>`;
  }

  const rawApp = clip.src_process || (clip.is_image ? 'Image' : 'DualClip');
  const sourceApp = escapeHtml(formatAppDisplayName(rawApp));
  const appIconHtml = typeof getAppIconSvg === 'function' ? getAppIconSvg(rawApp, clip.app_icon) : '';
  const formatShortAge = (val) => String(val || 'Now').replace(/^Just\s+/i, '').replace(/\s+ago$/i, '');
  const ageTime = escapeHtml(formatShortAge(clip.age_label));

  // 2-line structure: Headline (Content + Star/Pin) and Footer Line (App • Time • Label)
  const badgePos = (typeof visualRowIdx === 'number' ? visualRowIdx : idx) + 1;
  const quickPasteOn = _cachedQuickNumberPastePref;
  const numBadgeHtml = (quickPasteOn && badgePos >= 1 && badgePos <= 9)
    ? `<span class="row-num-badge" aria-hidden="true">${badgePos}</span>`
    : '';
  row.innerHTML = `
    ${numBadgeHtml}
    <div class="row-inner">
      <div class="row-headline">
        ${topBodyHtml}
        <div class="actions-right actions-group" onclick="event.stopPropagation()">
          ${collectionBadgeHtml}
          ${countBadgeHtml}
          <button class="row-action-btn btn-star favorite-btn ${isFavorite ? 'active favorite' : ''}" title="${isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}" onclick="quickToggleFavorite(event, ${idx})">${starSvg}</button>
          <button class="row-action-btn btn-pin pin-btn ${isPinned ? 'active pinned' : ''}" title="${isPinned ? 'Unpin from Top' : 'Pin to Top'}" onclick="quickTogglePin(event, ${idx})">${pinSvg}</button>
        </div>
        <span class="compact-time" title="${ageTime}">${ageTime}</span>
      </div>
      <div class="row-footer-line" dir="ltr">
        <div class="meta-left">
          <span class="meta-app">${appIconHtml}<span class="meta-app-name">${sourceApp}</span></span>
          <span class="meta-sep">&bull;</span>
          <span class="meta-time">${ageTime}</span>
          ${nickBadge ? `<span class="meta-sep">&bull;</span>${nickBadge}` : ''}
        </div>
      </div>
    </div>
  `;
  if (!clip.is_image) {
    const rowTextEl = row.querySelector('.row-text');
    if (rowTextEl) {
      const q = (searchInputEl ? searchInputEl.value : '') || (typeof currentSearchQuery !== 'undefined' ? currentSearchQuery : '');
      rowTextEl.appendChild(createHighlightedFragment(textDisplay, q));
    }
  }
  return row;
}

function scrollIndexIntoView(targetIdx) {
  if (typeof syncLivePreview === 'function') syncLivePreview();

  const container = document.getElementById('listContainer');
  if (!container || !currentFlatItems || currentFlatItems.length === 0) return;

  const target = currentFlatItems.find(it => it.type === 'clip' && it.originalIdx === targetIdx);
  if (!target) return;

  const targetTop = typeof target.top === 'number' ? target.top : 0;
  const targetH = typeof target.height === 'number' ? target.height : ROW_HEIGHT_NORMAL;
  const scrollTop = container.scrollTop;
  let clientHeight = getEffectiveClientHeight(container);
  if (!clientHeight || clientHeight <= 0) {
    clientHeight = container.clientHeight || (container.getBoundingClientRect ? Math.round(container.getBoundingClientRect().height) : 0) || 0;
  }
  if (clientHeight <= 0) return;

  const pad = 6;
  let newScrollTop = scrollTop;
  if (targetTop < scrollTop + pad) {
    newScrollTop = Math.max(0, targetTop - pad);
  } else if (targetTop + targetH > scrollTop + clientHeight - pad) {
    newScrollTop = targetTop + targetH - clientHeight + pad;
  }

  if (Math.abs(newScrollTop - scrollTop) > 1) {
    container.scrollTop = newScrollTop;
  }
  renderVirtualWindow();
}

const listScrollContainer = document.getElementById('listContainer');
if (listScrollContainer) {
  // Release fix: blank space inside the window must NEVER close/hide the app.
  // Swallow background clicks at the boundary so they cannot bubble to any
  // window-hide path. Only outside-window clicks (native mouse hook), Esc, or
  // the Close button may hide. Menu dismissal is owned by keyboard.js pointerdown.
  function isInsideBackgroundTarget(t) {
    if (!t) return false;
    try {
      if (t === listScrollContainer) return true;
      if (t.id === 'listVirtualSpacer' || t.id === 'virtualSpacer' || t.id === 'emptyStateOverlay') return true;
      if (t.classList && t.classList.contains('empty-state')) return true;
      if (t.closest && t.closest('#emptyStateOverlay')) return true;
    } catch {}
    return false;
  }
  // NOTE: do NOT stopPropagation on pointerdown here — keyboard.js document
  // pointerdown must still see inside clicks to dismiss open menus/dropdowns only.
  // Pressing on a clip row always drops input focus (capture phase: runs before
  // row click/drag handlers and survives their early returns), so Space = QuickLook after mouse-select
  listScrollContainer.addEventListener('pointerdown', (e) => {
    try {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT') && e.target && e.target.closest && e.target.closest('.clip-row')) {
        ae.blur();
      }
    } catch {}
  }, true);
  // No inside click may ever hide the window — including the "Clipboard is
  // empty" middle-center background. Swallow only, never call hideWindow here.
  listScrollContainer.addEventListener('click', (e) => {
    try {
      if (isInsideBackgroundTarget(e.target)) e.stopPropagation();
    } catch {}
  });
  let _scrollRafId = null;
  listScrollContainer.addEventListener('scroll', () => {
    if (_scrollRafId !== null) return;
    _scrollRafId = requestAnimationFrame(() => {
      _scrollRafId = null;
      renderVirtualWindow();
    });
  }, { passive: true });
  // Track real visible height so hidden renders use last known instead of 500 fallback
  try {
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(entries => {
        for (const e of entries) {
          const h = Math.round(e.contentRect.height);
          if (h > 100) { lastKnownClientHeight = h; _hasValidHeightCache = true; }
          const w = Math.round(e.contentRect.width);
          if (w > 100 && Math.abs(w - _cachedUsableWidth - 88) > 8) invalidateUsableWidthCache();
        }
      });
      ro.observe(listScrollContainer);
      // Seed initial height when visible
      requestAnimationFrame(() => {
        const h = listScrollContainer.clientHeight;
        if (h > 100) { lastKnownClientHeight = h; _hasValidHeightCache = true; }
      });
    }
  } catch(e) {}
  let _resizeDebounceTimer = null;
  let _resizeRafPending = false;
  window.addEventListener('resize', function() {
    invalidateUsableWidthCache();
    // During mode-switch animation, do not thrash DOM on every 15ms morph tick.
    // A single clean redraw will fire when the morph settles.
    if (window._isModeMorphing) return;
    if (_resizeRafPending) return;
    _resizeRafPending = true;
    requestAnimationFrame(function() {
      _resizeRafPending = false;
      try { if (typeof renderVirtualWindow === 'function') renderVirtualWindow(); } catch (e) {}
    });
  });
  try {
    const _obsTarget = document.documentElement;
    const _obs = new MutationObserver(function(mutations) {
      let needs = false;
      for (const m of mutations) {
        if (m.type === 'attributes' && (m.attributeName === 'data-line-display' || m.attributeName === 'data-thumb-size' || m.attributeName === 'data-zoom')) needs = true;
        if (m.type === 'attributes' && (m.target === document.body || (m.target && m.target.id === 'mainView')) && m.attributeName === 'class' && /zoomed-/.test(m.target.className)) needs = true;
      }
      if (needs) {
        clearTimeout(_resizeDebounceTimer);
        invalidateUsableWidthCache();
        // Measured heights are NOT discarded: they are keyed by preview size / lines / zoom /
        // layout, so a change here simply selects a different set instead of emptying the
        // cache and dropping every row back to its estimate.
        _resizeDebounceTimer = setTimeout(function(){ if (!window._isModeMorphing) invalidateHeights(); }, 80);
      }
    });
    _obs.observe(_obsTarget, { attributes: true, attributeFilter: ['data-line-display','data-thumb-size','data-zoom'] });
    _obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const _mv = document.getElementById('mainView');
    if (_mv) _obs.observe(_mv, { attributes: true, attributeFilter: ['class'] });
    // also watch appFrame for thumb size
    const _af = document.getElementById('appFrame');
    if (_af) _obs.observe(_af, { attributes: true, attributeFilter: ['data-thumb-size'] });
  } catch(e2) {}
}

// --- Live Preview Panel Handlers ---
let isLivePreviewEnabled = localStorage.getItem('dualclip_live_preview_enabled') === '1';

function toggleLivePreview(forceState) {
  if (typeof forceState === 'boolean') {
    isLivePreviewEnabled = forceState;
  } else {
    isLivePreviewEnabled = !isLivePreviewEnabled;
  }
  try {
    localStorage.setItem('dualclip_live_preview_enabled', isLivePreviewEnabled ? '1' : '0');
  } catch(e) {}

  const panel = document.getElementById('livePreviewPanel');
  const topBtn = document.getElementById('btnLivePreviewTop');
  const resizer = document.getElementById('livePreviewResizer');
  const toggleBtn = document.getElementById('stLivePreviewToggle');

  if (panel) {
    if (isLivePreviewEnabled) {
      panel.style.display = 'flex';
      panel.classList.remove('collapsed');
    } else {
      panel.classList.add('collapsed');
      panel.style.display = 'none';
    }
  }

  if (resizer) {
    resizer.style.display = isLivePreviewEnabled ? 'block' : 'none';
  }

  if (topBtn) {
    topBtn.classList.toggle('active', isLivePreviewEnabled);
  }

  if (toggleBtn) {
    toggleBtn.classList.toggle('on', isLivePreviewEnabled);
  }

  if (isLivePreviewEnabled && typeof syncLivePreview === 'function') {
    syncLivePreview();
  }
}

// Renders clips[selectedIndex] into the panel synchronously; call after any selection change
let livePreviewEditMode = false;
let livePreviewEditOriginal = '';
let livePreviewEditClipId = null;
function toggleLivePreviewEdit() {
  if (livePreviewEditMode) { saveLivePreviewEdit(); return; }
  let clip = (typeof selectedIndex !== 'undefined' && selectedIndex >= 0 && typeof clips !== 'undefined' && clips[selectedIndex]) ? clips[selectedIndex] : null;
  if (!clip && livePreviewEditClipId != null) {
    const pool = (typeof clips !== 'undefined' && Array.isArray(clips)) ? clips : [];
    const allPool = (typeof allClips !== 'undefined' && Array.isArray(allClips)) ? allClips : [];
    clip = pool.find(c => c && c.id === livePreviewEditClipId) || allPool.find(c => c && c.id === livePreviewEditClipId) || null;
  }
  if (!clip || clip.is_image) {
    if (typeof showToast === 'function') showToast(clip && clip.is_image ? 'Images cannot be edited here' : 'No clip selected');
    return;
  }
  const textEl = document.getElementById('livePreviewTextContent');
  if (!textEl) {
    if (typeof openEditClipModal === 'function') openEditClipModal(clip);
    return;
  }
  livePreviewEditMode = true;
  livePreviewEditClipId = clip.id;
  livePreviewEditOriginal = clip.text_content || clip.preview || '';
  textEl.contentEditable = 'true';
  textEl.focus();
  try { const range = document.createRange(); range.selectNodeContents(textEl); range.collapse(false); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); } catch {}
  textEl.style.outline = '1px solid var(--accent)';
  textEl.style.background = 'var(--card-bg)';
  const editBtn = document.getElementById('btnLivePreviewEdit'); if (editBtn) editBtn.style.display = 'none';
  const saveBtn = document.getElementById('btnLivePreviewSave'); if (saveBtn) saveBtn.style.display = 'inline-flex';
  const cancelBtn = document.getElementById('btnLivePreviewCancel'); if (cancelBtn) cancelBtn.style.display = 'inline-flex';
}
function cancelLivePreviewEdit() {
  if (!livePreviewEditMode) return;
  const textEl = document.getElementById('livePreviewTextContent');
  if (textEl) { textEl.textContent = livePreviewEditOriginal; textEl.contentEditable = 'false'; textEl.style.outline = ''; textEl.style.background = ''; }
  livePreviewEditMode = false;
  livePreviewEditClipId = null;
  const editBtn = document.getElementById('btnLivePreviewEdit'); if (editBtn) editBtn.style.display = 'inline-flex';
  const saveBtn = document.getElementById('btnLivePreviewSave'); if (saveBtn) saveBtn.style.display = 'none';
  const cancelBtn = document.getElementById('btnLivePreviewCancel'); if (cancelBtn) cancelBtn.style.display = 'none';
}
function saveLivePreviewEdit() {
  if (!livePreviewEditMode) return;
  const textEl = document.getElementById('livePreviewTextContent');
  if (!textEl) return;
  const newText = textEl.textContent || '';
  if (newText === livePreviewEditOriginal) { cancelLivePreviewEdit(); return; }
  if (!livePreviewEditClipId) { cancelLivePreviewEdit(); return; }
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.update_clip === 'function') {
    window.pywebview.api.update_clip(livePreviewEditClipId, newText).then(res => {
      if (res && res.ok) {
        const idx = clips.findIndex(c => c.id === livePreviewEditClipId);
        if (idx >= 0) { clips[idx].text_content = newText; clips[idx].preview = typeof safeSlice === 'function' ? safeSlice(newText, 200) : newText.slice(0, 200); }
        const aIdx = allClips.findIndex(c => c.id === livePreviewEditClipId);
        if (aIdx >= 0) { allClips[aIdx].text_content = newText; allClips[aIdx].preview = typeof safeSlice === 'function' ? safeSlice(newText, 200) : newText.slice(0, 200); }
        if (typeof showToast === 'function') showToast('Clip updated');
        if (typeof renderList === 'function') renderList();
        textEl.contentEditable = 'false'; textEl.style.outline = ''; textEl.style.background = '';
        livePreviewEditMode = false; livePreviewEditClipId = null;
        const editBtn2 = document.getElementById('btnLivePreviewEdit'); if (editBtn2) editBtn2.style.display = 'inline-flex';
        const saveBtn2 = document.getElementById('btnLivePreviewSave'); if (saveBtn2) saveBtn2.style.display = 'none';
        const cancelBtn2 = document.getElementById('btnLivePreviewCancel'); if (cancelBtn2) cancelBtn2.style.display = 'none';
        if (typeof syncLivePreview === 'function') syncLivePreview();
      } else {
        if (typeof showToast === 'function') showToast(res && res.error ? res.error : 'Failed to update');
      }
    }).catch(() => { if (typeof showToast === 'function') showToast('Failed to update'); });
  } else {
    const idx = clips.findIndex(c => c.id === livePreviewEditClipId);
    if (idx >= 0) clips[idx].text_content = newText;
    cancelLivePreviewEdit();
    if (typeof renderList === 'function') renderList();
  }
}
window.toggleLivePreviewEdit = toggleLivePreviewEdit;
window.saveLivePreviewEdit = saveLivePreviewEdit;
window.cancelLivePreviewEdit = cancelLivePreviewEdit;
function syncLivePreview() {
  if (livePreviewEditMode) return;
  if (!isLivePreviewEnabled) return;
  const panel = document.getElementById('livePreviewPanel');
  if (!panel || panel.style.display === 'none') return;

  const clip = (selectedIndex >= 0 && selectedIndex < clips.length) ? clips[selectedIndex] : null;

  const badge = document.getElementById('livePreviewTypeBadge');
  const appLabel = document.getElementById('livePreviewAppLabel');
  const textContent = document.getElementById('livePreviewTextContent');
  const imageContent = document.getElementById('livePreviewImageContent');
  const stats = document.getElementById('livePreviewStats');
  const previewBody = document.getElementById('livePreviewBody');

  if (!clip) {
    if (badge) badge.textContent = '';
    if (appLabel) appLabel.textContent = 'No clip selected';
    if (imageContent) imageContent.style.display = 'none';
    if (textContent) { textContent.style.display = 'block'; textContent.textContent = 'No clip selected'; }
    if (previewBody) previewBody.classList.remove('has-image');
    if (stats) stats.textContent = '';
    return;
  }

  if (badge) badge.textContent = clip.is_image ? 'IMAGE'
    : ((typeof getFormatTag === 'function' ? getFormatTag(clip.text_content || clip.preview || '') : '') || 'TEXT').toUpperCase();

  let srcApp = '';
  try {
    const meta = typeof clip.meta_json === 'string' ? JSON.parse(clip.meta_json) : (clip.meta_json || {});
    srcApp = meta && meta.src_process ? meta.src_process : '';
  } catch (e) {}
  if (srcApp && srcApp.toLowerCase().endsWith('.exe')) srcApp = srcApp.slice(0, -4);
  if (clip.is_image) {
    if (appLabel) appLabel.textContent = customTitle ? (customTitle + ' • ' + (srcApp || 'Image')) : (srcApp || 'Image');
  } else {
    if (appLabel) appLabel.textContent = customTitle ? (customTitle + ' • ' + (srcApp || 'DualClip')) : (srcApp || clip.title || 'DualClip');
  }

  if (clip.is_image) {
    if (textContent) textContent.style.display = 'none';
    if (imageContent) {
      imageContent.style.display = 'block';
      const imgSrc = (clip.image_data && !clip.image_data.startsWith('file:///')) ? clip.image_data : (clip.thumbnail_data || '');
      imageContent.src = imgSrc;
      imageContent.onerror = () => {
        if (clip.thumbnail_data && imageContent.src !== clip.thumbnail_data) {
          imageContent.src = clip.thumbnail_data;
        }
      };
    }
    if (stats) stats.textContent = clip.img_dims || 'Image';
    if (previewBody) previewBody.classList.add('has-image');
  } else {
    if (imageContent) imageContent.style.display = 'none';
    if (previewBody) previewBody.classList.remove('has-image');
    const rawText = clip.text_content || clip.preview || '';
    const chars = rawText.length;
    let displayText = rawText;
    if (chars > 50000) {
      displayText = (typeof safeSlice === 'function' ? safeSlice(rawText, 50000) : rawText.slice(0, 50000)) + `\n\n[Preview truncated for large clip — ${chars.toLocaleString()} chars total]`;
    }
    if (textContent) {
      textContent.style.display = 'block';
      textContent.setAttribute('dir', 'auto');
      textContent.textContent = displayText;
    }
    if (stats) {
      const lines = rawText.split(/\r\n|\r|\n/).length;
      stats.textContent = `${chars.toLocaleString()} chars · ${lines.toLocaleString()} lines${chars > 50000 ? ' (truncated)' : ''}`;
    }
  }
}


(function initLivePreviewResizer() {
  const resizer = document.getElementById('livePreviewResizer');
  const panel = document.getElementById('livePreviewPanel');
  if (!panel) return;

  function applyPreviewWidth(w) {
    w = Math.max(180, Math.min(460, Math.round(w)));
    panel.style.width = w + 'px';
    panel.style.flex = '0 0 ' + w + 'px';
    if (resizer) resizer.style.right = w + 'px';
  }

  try {
    const savedW = parseInt(localStorage.getItem('dualclip_preview_width') || '0', 10);
    if (!isNaN(savedW) && savedW >= 200 && savedW <= 460) applyPreviewWidth(savedW);
  } catch (e) {}

  if (resizer) resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('preview-resizing');
    const onMove = (ev) => {
      const container = document.getElementById('listViewContainer');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      applyPreviewWidth(rect.right - ev.clientX);
    };
    const onUp = () => {
      document.body.classList.remove('preview-resizing');
      try { localStorage.setItem('dualclip_preview_width', parseInt(panel.style.width, 10)); } catch (err) {}
      if (typeof renderVirtualWindow === 'function') renderVirtualWindow();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
  if (resizer) resizer.addEventListener('dblclick', (e) => {
    e.preventDefault();
    applyPreviewWidth(260);
    try { localStorage.removeItem('dualclip_preview_width'); } catch (err) {}
  });
})();

function getEffectiveViewMode() {
  let preset = 'standard';
  try {
    preset = localStorage.getItem('dualclip_layout_preset') || 'standard';
  } catch (e) {}
  if (preset === 'compact') return 'compact';
  return 'standard';
}

const VIEW_MODE_SVG_OUTWARD = '<polyline points="15 3 21 3 21 9"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><polyline points="9 21 3 21 3 15"></polyline><line x1="10" y1="14" x2="3" y2="21"></line>';
const VIEW_MODE_SVG_INWARD = '<polyline points="4 14 10 14 10 20"></polyline><line x1="10" y1="14" x2="3" y2="21"></line><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line>';

function updateViewModeButton(mode) {
  const m = mode || getEffectiveViewMode();
  const btn = document.getElementById('btnViewModeToggle');
  const btnSearch = document.getElementById('btnViewModeToggleSearch');
  const icon = document.getElementById('viewModeIcon');
  const iconSearch = document.getElementById('viewModeIconSearch');

  if (btn) btn.classList.remove('active');
  if (btnSearch) btnSearch.classList.remove('active');

  let tipText = '';
  let svgContent = '';
  if (m === 'standard') {
    // In standard mode, show inward arrows indicating contracting into compact mode
    svgContent = VIEW_MODE_SVG_INWARD;
    tipText = 'View: Standard (Click for Compact)';
    if (btn) btn.setAttribute('aria-label', 'Standard view, click for compact');
    if (btnSearch) btnSearch.setAttribute('aria-label', 'Standard view, click for compact');
  } else {
    // In compact mode, show outward arrows indicating expanding back to standard mode
    svgContent = VIEW_MODE_SVG_OUTWARD;
    tipText = 'View: Compact (Click for Standard)';
    if (btn) btn.setAttribute('aria-label', 'Compact view, click for standard');
    if (btnSearch) btnSearch.setAttribute('aria-label', 'Compact view, click for standard');
  }

  if (icon) icon.innerHTML = svgContent;
  if (iconSearch) iconSearch.innerHTML = svgContent;

  if (btn) {
    btn.setAttribute('data-tooltip', tipText);
    btn.removeAttribute('title');
  }
  if (btnSearch) {
    btnSearch.setAttribute('data-tooltip', tipText);
    btnSearch.removeAttribute('title');
  }

  [icon, iconSearch].forEach((ic) => {
    if (ic) {
      ic.classList.remove('icon-mode-transition');
      void ic.offsetWidth;
      ic.classList.add('icon-mode-transition');
    }
  });
}

function applyViewMode(mode) {
  const animate = localStorage.getItem('dualclip_animate_mode_switch') !== '0';
  if (mode === 'compact') {
    if (typeof changeQuickViewLayoutPreset === 'function') {
      changeQuickViewLayoutPreset('compact', false, animate);
    }
    // Auto-close left sidebar view in compact mode (window is only 360px wide)
    if (typeof getSidebarLayoutSetting === 'function' && getSidebarLayoutSetting() === 'sidebar') {
      if (typeof applySidebarLayout === 'function') {
        applySidebarLayout('standard');
      }
    }
    toggleLivePreview(false);
  } else {
    if (typeof changeQuickViewLayoutPreset === 'function') {
      changeQuickViewLayoutPreset('standard', false, animate);
    }
    toggleLivePreview(false);
  }
  updateViewModeButton(mode);
  // NOTE (TASK-002): the C# view-mode mirror RPC was deleted.
  // Persistence authority is localStorage 'dualclip_layout_preset' only.
}

function cycleViewMode() {
  const current = getEffectiveViewMode();
  const next = current === 'compact' ? 'standard' : 'compact';
  applyViewMode(next);
}

window.cycleViewMode = cycleViewMode;
window.applyViewMode = applyViewMode;
window.getEffectiveViewMode = getEffectiveViewMode;
window.updateViewModeButton = updateViewModeButton;

toggleLivePreview(isLivePreviewEnabled);

// --- Tag Badges & Overflow Popover Handlers ---
function closeTagOverflowPopover() {
  const existing = document.querySelector('.tag-overflow-popover');
  if (existing) existing.remove();
  document.removeEventListener('click', closeTagOverflowPopoverOnOutsideClick);
  document.removeEventListener('keydown', closeTagOverflowPopoverOnKeydown);
}

function closeTagOverflowPopoverOnOutsideClick(e) {
  if (!e.target.closest('.tag-overflow-popover') && !e.target.closest('.clip-nickname-overflow-badge')) {
    closeTagOverflowPopover();
  }
}

function closeTagOverflowPopoverOnKeydown(e) {
  if (e.key === 'Escape') {
    closeTagOverflowPopover();
  }
}

function handleTagBadgeClick(e, tag) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!tag) return;
  filterByTag(tag);
}

function filterByTag(tag) {
  if (!tag) return;
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    const rawVal = searchInput.value || '';
    const formattedTag = tag.includes(' ') ? `"${tag}"` : tag;
    const tagToken = `tag:${formattedTag}`;
    let newVal = '';
    if (/tag:(?:"[^"]*"|\S+)/i.test(rawVal)) {
      newVal = rawVal.replace(/tag:(?:"[^"]*"|\S+)/i, tagToken).trim();
    } else {
      newVal = rawVal ? `${rawVal.trim()} ${tagToken}` : tagToken;
    }
    searchInput.value = newVal;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.focus();
  }
}

function handleTagOverflowClick(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const badge = e.currentTarget;
  if (!badge) return;

  const rawJson = badge.getAttribute('data-overflow-tags');
  let tags = [];
  try {
    tags = JSON.parse(rawJson || '[]');
  } catch (err) {
    tags = [];
  }
  if (!Array.isArray(tags) || tags.length === 0) return;

  const existing = document.querySelector('.tag-overflow-popover');
  if (existing) {
    const wasSame = existing.__triggerBadge === badge;
    existing.remove();
    if (wasSame) return;
  }

  const popover = document.createElement('div');
  popover.className = 'tag-overflow-popover';
  popover.__triggerBadge = badge;

  tags.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'popover-tag-chip';
    chip.textContent = t;
    chip.title = `Filter by tag: ${t}`;
    chip.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      filterByTag(t);
      closeTagOverflowPopover();
    };
    popover.appendChild(chip);
  });

  document.body.appendChild(popover);

  const rect = badge.getBoundingClientRect();
  const popoverW = Math.max(120, popover.offsetWidth || 160);
  const popoverH = Math.min(180, popover.offsetHeight || 100);
  const left = Math.max(8, Math.min(window.innerWidth - popoverW - 12, rect.left));
  popover.style.left = `${left}px`;

  if (rect.bottom + popoverH + 10 > window.innerHeight && rect.top > popoverH + 10) {
    popover.style.top = `${Math.max(8, rect.top - popoverH - 4)}px`;
  } else {
    popover.style.top = `${Math.min(window.innerHeight - popoverH - 8, rect.bottom + 4)}px`;
  }

  setTimeout(() => {
    document.addEventListener('click', closeTagOverflowPopoverOnOutsideClick);
    document.addEventListener('keydown', closeTagOverflowPopoverOnKeydown);
  }, 10);
}

// Global & Namespace Exposure
window.toggleGroupCollapse = toggleGroupCollapse;
window.createHeaderElement = createHeaderElement;
window.renderList = renderList;
window.renderVirtualWindow = renderVirtualWindow;
window.createRowElement = createRowElement;
window.scrollIndexIntoView = scrollIndexIntoView;
window.toggleLivePreview = toggleLivePreview;
window.syncLivePreview = syncLivePreview;
window.invalidateHeights = invalidateHeights;
window.handleTagBadgeClick = handleTagBadgeClick;
window.handleTagOverflowClick = handleTagOverflowClick;
window.closeTagOverflowPopover = closeTagOverflowPopover;
window.filterByTag = filterByTag;

window.DC = window.DC || {};
window.DC.render = {
  renderList,
  renderVirtualWindow,
  createRowElement,
  createHeaderElement,
  scrollIndexIntoView,
  cycleSelection: window.cycleSelection,
  pasteCurrentSelection: window.pasteCurrentSelection,
  executePasteClip,
  bumpClipToTop,
  toggleGroupCollapse,
  toggleLivePreview,
  syncLivePreview,
  invalidateHeights,
  handleTagBadgeClick,
  handleTagOverflowClick,
  closeTagOverflowPopover,
  filterByTag
};


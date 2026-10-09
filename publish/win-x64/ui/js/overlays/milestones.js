// --- DualClip Milestone Celebration, Supporter Verification & Confetti Engine ---

const MILESTONE_DEFINITIONS = [
  { id: 'pastes_100', metric: 'pastes', threshold: 100, text: 'You have pasted more than 100 clips with DualClip! Love the app? Consider leaving a tip.' },
  { id: 'time_30m', metric: 'timeSavedMinutes', threshold: 30, text: 'You have saved more than 30 minutes of typing with DualClip! Love the app? Consider leaving a tip.' },
  { id: 'pastes_1000', metric: 'pastes', threshold: 1000, text: 'You have pasted more than 1,000 clips with DualClip! Love the app? Consider leaving a tip.' },
  { id: 'time_150m', metric: 'timeSavedMinutes', threshold: 150, text: 'You have saved more than 2.5 hours with DualClip! Love the app? Consider leaving a tip.' },
  { id: 'pastes_5000', metric: 'pastes', threshold: 5000, text: 'You have pasted more than 5,000 clips with DualClip! Love the app? Consider leaving a tip.' },
  { id: 'time_600m', metric: 'timeSavedMinutes', threshold: 600, text: 'You have saved more than 10 hours with DualClip! Love the app? Consider leaving a tip.' }
];

let activeMilestoneId = null;

function getSeenMilestones() {
  try {
    const raw = localStorage.getItem('dualclip_seen_milestones');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function isUserSupporter() {
  try {
    return localStorage.getItem('dualclip_is_supporter') === '1' || localStorage.getItem('dualclip_is_supporter') === 'true';
  } catch (e) {
    return false;
  }
}

function syncSupporterBadge() {
  const badge = document.getElementById('supporterBadge');
  if (badge) {
    badge.style.display = isUserSupporter() ? 'inline-flex' : 'none';
  }
}

async function initSupporterState() {
  try {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_supporter_status === 'function') {
      const res = await window.pywebview.api.get_supporter_status();
      if (res && res.ok && res.is_supporter) {
        localStorage.setItem('dualclip_is_supporter', '1');
      } else if (res && res.ok && !res.is_supporter) {
        // MA-009: DB wins over localStorage for hydration. No write-back:
        // re-asserting supporter=true here raced the legitimate settings
        // write path and could flip a real supporter's status off.
        localStorage.removeItem('dualclip_is_supporter');
      }
    }
  } catch (e) {}
  syncSupporterBadge();
}

async function checkAndTriggerMilestones() {
  // If user has supported, permanently suppress milestone banners
  if (isUserSupporter()) {
    const banner = document.getElementById('milestoneBanner');
    if (banner) banner.style.display = 'none';
    return;
  }

  // 7-day cooldown between any two milestone banners
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  try {
    const lastTs = parseInt(localStorage.getItem('dualclip_last_milestone_ts') || '0', 10);
    if (lastTs > 0 && (Date.now() - lastTs) < SEVEN_DAYS_MS) {
      return;
    }
  } catch (e) {}

  const seen = getSeenMilestones();

  // Retrieve usage stats from backend bridge
  try {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_usage_stats === 'function') {
      const res = await window.pywebview.api.get_usage_stats();
      if (res && res.ok) {
        evaluateMilestoneThresholds(res.totalPastes || 0, res.timeSavedMinutes || 0, seen);
      }
    }
  } catch (e) {}
}

function evaluateMilestoneThresholds(totalPastes, timeSavedMinutes, seenList) {
  for (const m of MILESTONE_DEFINITIONS) {
    if (seenList.includes(m.id)) continue;

    let qualified = false;
    if (m.metric === 'pastes' && totalPastes >= m.threshold) {
      qualified = true;
    } else if (m.metric === 'timeSavedMinutes' && timeSavedMinutes >= m.threshold) {
      qualified = true;
    }

    if (qualified) {
      showMilestoneBanner(m);
      break;
    }
  }
}

function showMilestoneBanner(milestone) {
  if (!milestone) return;
  activeMilestoneId = milestone.id;
  // MA-008: cooldown timestamp is written on dismiss only, so a crash/kill
  // between show and dismiss does not consume the 7-day cooldown window.
  const banner = document.getElementById('milestoneBanner');
  const textEl = document.getElementById('milestoneBannerText');
  if (banner && textEl) {
    textEl.textContent = milestone.text;
    banner.style.display = 'flex';
  }
}

function dismissMilestoneBanner() {
  if (activeMilestoneId) {
    const seen = getSeenMilestones();
    if (!seen.includes(activeMilestoneId)) {
      seen.push(activeMilestoneId);
      try { localStorage.setItem('dualclip_seen_milestones', JSON.stringify(seen)); } catch (e) {}
    }
    try { localStorage.setItem('dualclip_last_milestone_ts', String(Date.now())); } catch (e) {}
  }
  const banner = document.getElementById('milestoneBanner');
  if (banner) banner.style.display = 'none';
  activeMilestoneId = null;
}

function teleportToTipSection() {
  dismissMilestoneBanner();
  if (typeof openSettingsView === 'function') {
    openSettingsView();
  }
  if (typeof switchSettingsTab === 'function') {
    switchSettingsTab('behavior');
  }
  setTimeout(() => {
    const section = document.getElementById('aboutDualClipSection');
    if (section && typeof section.scrollIntoView === 'function') {
      section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const tipBtn = document.getElementById('btnLeaveTip');
    if (tipBtn) {
      tipBtn.classList.remove('btn-tip-pulse');
      // Trigger reflow to restart CSS animation reliably
      void tipBtn.offsetWidth;
      tipBtn.classList.add('btn-tip-pulse');
      setTimeout(() => tipBtn.classList.remove('btn-tip-pulse'), 4500);
    }
  }, 100);
}

// --- Supporter Confirmation Modal & Honor System ---

function checkPendingSupporterPrompt() {
  try {
    const val = localStorage.getItem('dualclip_pending_tip_check');
    if (val) {
      localStorage.removeItem('dualclip_pending_tip_check');
      const ts = parseInt(val, 10);
      const THIRTY_MINS_MS = 30 * 60 * 1000;
      if (val === '1' || (ts > 0 && (Date.now() - ts) < THIRTY_MINS_MS)) {
        openSupporterModal();
      }
    }
  } catch (e) {}
}

function openSupporterModal() {
  const modal = document.getElementById('supporterPromptModal');
  if (modal) modal.style.display = 'flex';
}

function closeSupporterModal() {
  const modal = document.getElementById('supporterPromptModal');
  if (modal) modal.style.display = 'none';
}

function confirmSupporterStatus(isSupported) {
  closeSupporterModal();
  if (isSupported) {
    try {
      localStorage.setItem('dualclip_is_supporter', '1');
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_supporter_status === 'function') {
        window.pywebview.api.set_supporter_status(true);
      }
    } catch (e) {}
    syncSupporterBadge();
    dismissMilestoneBanner();
    launchCelebrationConfetti();
    if (typeof showToast === 'function') {
      showToast('Thank you for being a proud supporter! 💖', { duration: 5500 });
    }
  }
}

// --- Golden Stars & Shimmer Celebration Engine ---

function launchCelebrationConfetti() {
  let canvas = document.getElementById('confettiCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'confettiCanvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '999999';
    document.body.appendChild(canvas);
  }

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  function drawStar(c, cx, cy, spikes, outerRadius, innerRadius, color) {
    let rot = (Math.PI / 2) * 3;
    let x = cx;
    let y = cy;
    let step = Math.PI / spikes;
    c.beginPath();
    c.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerRadius;
      y = cy + Math.sin(rot) * outerRadius;
      c.lineTo(x, y);
      rot += step;
      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      c.lineTo(x, y);
      rot += step;
    }
    c.lineTo(cx, cy - outerRadius);
    c.closePath();
    c.fillStyle = color;
    c.fill();
  }

  const goldColors = ['#fde047', '#facc15', '#eab308', '#ffffff', '#fbbf24'];
  const cx = width / 2;
  const cy = height * 0.45;
  const particles = [];
  const particleCount = 45;

  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 9 + 3;
    particles.push({
      shape: Math.random() > 0.4 ? 'star' : 'circle',
      size: Math.random() * 6 + 4,
      w: Math.random() * 5 + 3,
      h: Math.random() * 5 + 3,
      x: cx + (Math.random() - 0.5) * 60,
      y: cy + (Math.random() - 0.5) * 40,
      color: goldColors[Math.floor(Math.random() * goldColors.length)],
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      gravity: 0.18,
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 8,
      opacity: 1,
      fadeRate: 0.012
    });
  }

  const startTime = Date.now();
  const DURATION_MS = 2200;

  function renderFrame() {
    const elapsed = Date.now() - startTime;
    if (elapsed > DURATION_MS) {
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      return;
    }

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.98;
      p.rotation += p.rotSpeed;
      if (elapsed > DURATION_MS * 0.6) {
        p.opacity = Math.max(0, p.opacity - p.fadeRate);
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.opacity);

      if (p.shape === 'star') {
        drawStar(ctx, 0, 0, 4, p.size, p.size / 2, p.color);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.restore();
    }

    requestAnimationFrame(renderFrame);
  }

  requestAnimationFrame(renderFrame);
}

// --- Dev Testing & Simulation Helpers ---

function devSimulateMilestone(milestoneId) {
  const m = MILESTONE_DEFINITIONS.find(item => item.id === milestoneId) || MILESTONE_DEFINITIONS[0];
  showMilestoneBanner(m);
  if (typeof showToast === 'function') {
    showToast('Simulating: ' + m.id);
  }
}

function devTriggerConfetti() {
  launchCelebrationConfetti();
  if (typeof showToast === 'function') {
    showToast('Confetti triggered 🎉');
  }
}

function devTestSupporterPrompt() {
  openSupporterModal();
}

function devResetMilestoneState() {
  try {
    localStorage.removeItem('dualclip_seen_milestones');
    localStorage.removeItem('dualclip_last_milestone_ts');
    localStorage.removeItem('dualclip_is_supporter');
    localStorage.removeItem('dualclip_pending_tip_check');
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_supporter_status === 'function') {
      window.pywebview.api.set_supporter_status(false);
    }
  } catch (e) {}
  syncSupporterBadge();
  const banner = document.getElementById('milestoneBanner');
  if (banner) banner.style.display = 'none';
  if (typeof showToast === 'function') {
    showToast('Milestone & supporter state reset');
  }
}

// Auto-check milestones & sync supporter status on document load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      initSupporterState();
      checkAndTriggerMilestones();
    }, 300);
  });
} else {
  setTimeout(() => {
    initSupporterState();
    checkAndTriggerMilestones();
  }, 300);
}

window.addEventListener('pywebviewready', () => {
  initSupporterState();
});

// Expose globals for UI buttons and event listeners
window.checkAndTriggerMilestones = checkAndTriggerMilestones;
window.dismissMilestoneBanner = dismissMilestoneBanner;
window.teleportToTipSection = teleportToTipSection;
window.checkPendingSupporterPrompt = checkPendingSupporterPrompt;
window.openSupporterModal = openSupporterModal;
window.closeSupporterModal = closeSupporterModal;
window.confirmSupporterStatus = confirmSupporterStatus;
window.launchCelebrationConfetti = launchCelebrationConfetti;
window.syncSupporterBadge = syncSupporterBadge;
window.initSupporterState = initSupporterState;
// MA-013: dev simulation functions must never be reachable in production
// builds (devResetMilestoneState flips real supporter state via RPC).
if (window.location && window.location.protocol === 'devtools:') {
  window.devSimulateMilestone = devSimulateMilestone;
  window.devTriggerConfetti = devTriggerConfetti;
  window.devTestSupporterPrompt = devTestSupporterPrompt;
  window.devResetMilestoneState = devResetMilestoneState;
}

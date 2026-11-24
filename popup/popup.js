/**
 * PrivacyShield — popup/popup.js
 * COMPLETE VERSION with cookie blocking toggle
 */

const KEYS = {
  BEHAVIOR:  'privacyshield_behavior',
  BLOCKED:   'privacyshield_blocked',
  ANALYTICS: 'privacyshield_analytics',
  SETTINGS:  'privacyshield_settings',
  MODEL:     'privacyshield_model'
};

const CAT_COLORS = {
  Fashion:     '#ff6b9d',
  Electronics: '#6c63ff',
  Sports:      '#00e5a0',
  Food:        '#ffb547',
  Travel:      '#00c9ff',
  Tech:        '#a78bfa',
  Beauty:      '#ff9ff3',
  Books:       '#feca57',
  Home:        '#48dbfb',
  Automotive:  '#ff6348',
  Entertainment: '#f368e0',
  Finance:     '#00d2d3'
};

let currentSite = '';
let isPaused = false;

// ── INIT ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  getCurrentSite();
  loadAndRenderAll();
  attachAllListeners();
});

// ── ATTACH ALL LISTENERS ──────────────────────────
function attachAllListeners() {
  // Main ON/OFF toggle
  document.getElementById('mainToggle').addEventListener('change', function () {
    isPaused = !this.checked;
    saveSettings({ paused: isPaused });
    document.getElementById('toggleLabel').textContent = isPaused ? 'OFF' : 'ON';
    document.getElementById('pausedBanner').classList.toggle('show', isPaused);
    showToast(isPaused ? '⏸️ Tracking paused' : '▶️ Tracking resumed');
  });

  // Cookie blocking toggle
  const cookieToggle = document.getElementById('cookieToggle');
  if (cookieToggle) {
    cookieToggle.addEventListener('change', function () {
      saveSettings({ cookieBlocking: this.checked });
      showToast(this.checked ? '🍪 Cookie blocking ON' : '🍪 Cookie blocking OFF');
    });
  }

  // Delete preference
  document.getElementById('btnDelete').addEventListener('click', toggleDeleteWrap);
  document.getElementById('btnConfirmDelete').addEventListener('click', confirmDelete);
  document.getElementById('btnCancelDelete').addEventListener('click', toggleDeleteWrap);

  // Reset all
  document.getElementById('btnReset').addEventListener('click', showResetModal);
  document.getElementById('btnConfirmReset').addEventListener('click', confirmReset);
  document.getElementById('btnCancelReset').addEventListener('click', hideResetModal);

  // Other buttons
  document.getElementById('btnPause').addEventListener('click', togglePause);
  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnDashboard').addEventListener('click', openDashboard);
  document.getElementById('btnSettings').addEventListener('click', openSettings);
}

// ── GET CURRENT TAB ───────────────────────────────
function getCurrentSite() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        try {
          currentSite = new URL(tabs[0].url).hostname.replace('www.', '');
        } catch (e) {
          currentSite = 'Unknown Site';
        }
        document.getElementById('siteName').textContent = currentSite;
        loadSiteSpecificData();
      }
    });
  } catch (e) {
    document.getElementById('siteName').textContent = 'Unknown';
  }
}

// ── LOAD AND RENDER ALL ───────────────────────────
function loadAndRenderAll() {
  renderPreferences();
  renderQuickStats();
}

// ── SITE SPECIFIC DATA ────────────────────────────
function loadSiteSpecificData() {
  chrome.storage.local.get(KEYS.BLOCKED, (result) => {
    const blocked = result[KEYS.BLOCKED] || { attempts: [] };
    const siteBlockedCount = blocked.attempts.filter(a => a.site === currentSite).length;
    const sitePrivacyScore = Math.max(10, 100 - (siteBlockedCount * 5));

    document.getElementById('siteBlocked').textContent = siteBlockedCount;
    document.getElementById('scoreNum').textContent = sitePrivacyScore;

    const fill = document.getElementById('scoreFill');
    if (fill) {
      const circumference = 157;
      const offset = circumference - (circumference * sitePrivacyScore / 100);
      let color = sitePrivacyScore >= 70 ? '#00e5a0'
                : sitePrivacyScore >= 40 ? '#ffb547'
                : '#ff5c7c';
      fill.style.stroke = color;
      fill.style.strokeDashoffset = offset;
    }

    const statusMap = [
      [70, '✅ Privacy Friendly'],
      [40, '⚠️ Some Tracking Detected'],
      [0,  '🚨 High Tracking Activity']
    ];
    const status = statusMap.find(([min]) => sitePrivacyScore >= min);
    document.getElementById('siteStatus').textContent = status ? status[1] : '🚨 High Risk';
  });
}

// ── RENDER PREFERENCES ────────────────────────────
function renderPreferences() {
  chrome.storage.local.get([KEYS.BEHAVIOR, KEYS.MODEL], (result) => {
    const behavior = result[KEYS.BEHAVIOR] || {};
    const model    = result[KEYS.MODEL]    || {};

    const newUserMsg    = document.getElementById('newUserMsg');
    const prefBars      = document.getElementById('prefBars');
    const confidenceTag = document.getElementById('confidenceTag');

    // Count total real clicks from tracker
    const categoryCount = Object.keys(behavior.categories || {}).length;
    const totalClicks   = Object.values(behavior.categories || {})
                            .reduce((sum, c) => sum + (c.clicks || 0), 0);
    const totalInteractions = model.totalInteractions || totalClicks;

    // Show new user message if not enough data
    if (totalInteractions < 3 && categoryCount < 2) {
      if (newUserMsg) newUserMsg.style.display = 'block';
      if (prefBars)   prefBars.innerHTML = '<p style="color:#aaa;font-size:12px;text-align:center;padding:10px">Browse some websites first!<br>Click on products to build your profile.</p>';
      if (confidenceTag) confidenceTag.textContent = '• Learning...';
      return;
    }

    if (newUserMsg) newUserMsg.style.display = 'none';

    // Build scores — use model if ready, else calculate from raw behavior
    let scores = {};
    if (model.scores && Object.keys(model.scores).length > 0) {
      scores = model.scores;
    } else {
      const cats  = behavior.categories || {};
      const total = Object.values(cats).reduce((s, c) => s + (c.clicks || 0), 0) || 1;
      Object.entries(cats).forEach(([cat, data]) => {
        scores[cat] = {
          percentage: Math.round((data.clicks / total) * 100) || 1
        };
      });
    }

    if (confidenceTag) {
      confidenceTag.textContent = totalInteractions >= 10
        ? '• High Confidence'
        : '• Learning';
    }

    const sorted = Object.entries(scores)
      .sort((a, b) => (b[1].percentage || 0) - (a[1].percentage || 0))
      .slice(0, 6);

    if (prefBars) {
      prefBars.innerHTML = sorted.map(([cat, data]) => {
        const pct   = data.percentage || 0;
        const color = CAT_COLORS[cat] || '#6c63ff';
        return `
          <div class="pref-row">
            <div class="pref-cat">${cat}</div>
            <div class="pref-bar-bg">
              <div class="pref-bar-fill" data-pct="${pct}"
                style="width:0%;background:linear-gradient(90deg,${color}99,${color})">
              </div>
            </div>
            <div class="pref-pct">${pct}%</div>
          </div>`;
      }).join('');
    }

    // Populate delete dropdown
    const sel = document.getElementById('deleteSelect');
    if (sel) {
      sel.innerHTML = '<option value="">— Select category —</option>';
      sorted.forEach(([cat]) => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        sel.appendChild(opt);
      });
    }

    // Animate bars after render
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('.pref-bar-fill').forEach(bar => {
          bar.style.width = bar.dataset.pct + '%';
        });
      }, 80);
    });
  });
}

// ── QUICK STATS ───────────────────────────────────
function renderQuickStats() {
  const today = new Date().toISOString().split('T')[0];

  chrome.storage.local.get([KEYS.BLOCKED, KEYS.ANALYTICS, KEYS.BEHAVIOR], (result) => {
    const blocked   = result[KEYS.BLOCKED]   || { attempts: [] };
    const analytics = result[KEYS.ANALYTICS] || {};
    const behavior  = result[KEYS.BEHAVIOR]  || { sites: {} };

    // Blocked today
    const blockedToday = blocked.attempts.filter(a =>
      a.timestamp && a.timestamp.startsWith(today)
    ).length;

    // Sites visited — count from behavior if analytics not ready
    let sitesCount = 0;
    if (analytics.dailyStats && analytics.dailyStats[today]) {
      sitesCount = analytics.dailyStats[today].sitesVisited || 0;
    } else {
      sitesCount = Object.keys(behavior.sites || {}).length;
    }

    // Overall privacy score
    let overallScore = '--';
    if (analytics.overallPrivacyScore !== undefined) {
      overallScore = analytics.overallPrivacyScore;
    } else if (blocked.attempts.length > 0) {
      // Calculate basic score if analytics not ready
      overallScore = Math.max(30, 100 - blocked.attempts.length * 3);
    }

    document.getElementById('statBlocked').textContent = blockedToday;
    document.getElementById('statSites').textContent   = sitesCount;
    document.getElementById('statPrivacy').textContent =
      overallScore !== '--' ? overallScore + '/100' : '--';
  });
}

// ── LOAD SETTINGS ─────────────────────────────────
function loadSettings() {
  chrome.storage.local.get(KEYS.SETTINGS, (result) => {
    const settings = result[KEYS.SETTINGS] || {};
    isPaused = settings.paused || false;

    const mainToggle = document.getElementById('mainToggle');
    const toggleLabel = document.getElementById('toggleLabel');
    const pausedBanner = document.getElementById('pausedBanner');
    const cookieToggle = document.getElementById('cookieToggle');

    if (mainToggle)   mainToggle.checked = !isPaused;
    if (toggleLabel)  toggleLabel.textContent = isPaused ? 'OFF' : 'ON';
    if (pausedBanner) pausedBanner.classList.toggle('show', isPaused);

    // Cookie blocking — default ON
    if (cookieToggle) {
      cookieToggle.checked = settings.cookieBlocking !== false;
    }
  });
}

// ── SAVE SETTINGS ─────────────────────────────────
function saveSettings(settings) {
  chrome.storage.local.get(KEYS.SETTINGS, (result) => {
    const existing = result[KEYS.SETTINGS] || {};
    chrome.storage.local.set({ [KEYS.SETTINGS]: { ...existing, ...settings } });
  });
}

// ── TOGGLE PAUSE ──────────────────────────────────
function togglePause() {
  isPaused = !isPaused;
  saveSettings({ paused: isPaused });

  const mainToggle  = document.getElementById('mainToggle');
  const toggleLabel = document.getElementById('toggleLabel');
  const btnPause    = document.getElementById('btnPause');
  const pausedBanner = document.getElementById('pausedBanner');

  if (mainToggle)   mainToggle.checked = !isPaused;
  if (toggleLabel)  toggleLabel.textContent = isPaused ? 'OFF' : 'ON';
  if (btnPause)     btnPause.textContent = isPaused ? '▶️ Resume' : '⏸️ Pause';
  if (pausedBanner) pausedBanner.classList.toggle('show', isPaused);

  // Tell content.js to stop/start tracking
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'PRIVACYSHIELD_TOGGLE',
        paused: isPaused
      }).catch(() => {}); // ignore if content script not ready
    }
  });

  showToast(isPaused ? '⏸️ Tracking paused' : '▶️ Tracking resumed');
}

// ── DELETE ONE PREFERENCE ─────────────────────────
function toggleDeleteWrap() {
  const wrap = document.getElementById('deleteWrap');
  if (wrap) wrap.classList.toggle('show');
}

function confirmDelete() {
  const sel = document.getElementById('deleteSelect');
  const category = sel ? sel.value : '';
  if (!category) {
    showToast('Please select a category', true);
    return;
  }

  // Delete from behavior
  chrome.storage.local.get(KEYS.BEHAVIOR, (result) => {
    const data = result[KEYS.BEHAVIOR] || { categories: {} };
    if (data.categories && data.categories[category]) {
      delete data.categories[category];
      chrome.storage.local.set({ [KEYS.BEHAVIOR]: data });
    }
  });

  // Delete from model scores
  chrome.storage.local.get(KEYS.MODEL, (result) => {
    const model = result[KEYS.MODEL] || { scores: {} };
    if (model.scores && model.scores[category]) {
      delete model.scores[category];
      chrome.storage.local.set({ [KEYS.MODEL]: model });
    }
  });

  toggleDeleteWrap();
  setTimeout(() => loadAndRenderAll(), 300);
  showToast('🗑️ ' + category + ' preference deleted');
}

// ── RESET ALL ─────────────────────────────────────
function showResetModal() {
  const modal = document.getElementById('resetModal');
  if (modal) modal.classList.add('show');
}

function hideResetModal() {
  const modal = document.getElementById('resetModal');
  if (modal) modal.classList.remove('show');
}

function confirmReset() {
  chrome.storage.local.remove(Object.values(KEYS), () => {
    hideResetModal();
    loadAndRenderAll();
    showToast('✅ All preferences reset');

    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'PRIVACYSHIELD_RESET'
        }).catch(() => {});
      }
    });
  });
}

// ── EXPORT DATA ───────────────────────────────────
function exportData() {
  chrome.storage.local.get(null, (allData) => {
    const exportObj = {
      _exportedAt : new Date().toISOString(),
      _version    : '1.0'
    };
    Object.keys(allData).forEach(key => {
      if (key.startsWith('privacyshield_')) exportObj[key] = allData[key];
    });

    const blob = new Blob(
      [JSON.stringify(exportObj, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = 'privacyshield-data-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('📤 Data exported successfully');
  });
}

// ── OPEN DASHBOARD ────────────────────────────────
function openDashboard() {
  const url = chrome.runtime.getURL('dashboard/dashboard.html');
  chrome.tabs.create({ url });
}

function openSettings() {
  showToast('⚙️ Settings coming soon');
}

// ── TOAST ─────────────────────────────────────────
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className   = 'toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  });
}
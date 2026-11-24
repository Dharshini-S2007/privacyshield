/**
 * PrivacyShield — dashboard/dashboard.js
 * Reads real data from privacyshield_behavior.sites
 * Time is stored in milliseconds — converted correctly to minutes
 */

const KEYS = {
  BEHAVIOR:  'privacyshield_behavior',
  BLOCKED:   'privacyshield_blocked',
  ANALYTICS: 'privacyshield_analytics',
  SETTINGS:  'privacyshield_settings',
  MODEL:     'privacyshield_model'
};

const CAT_COLORS = [
  '#6c63ff','#00e5a0','#ff6b9d','#ffb547',
  '#00c9ff','#a78bfa','#ff9ff3','#feca57',
  '#48dbfb','#ff6348'
];

let currentPeriod = 'today';
let siteData      = [];
let sortConfig    = { key: 'time', dir: 'desc' };

// tracker.js stores timeSpent in milliseconds — convert to readable string
function msToDisplay(ms) {
  const minutes = Math.floor((ms || 0) / 60000);
  if (minutes >= 60) {
    return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
  }
  return minutes + 'm';
}

// ── INIT ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  attachAllListeners();
  syncThenLoad();
  setInterval(syncThenLoad, 15000);
});

// ── SYNC localStorage → chrome.storage.local ─────
function syncThenLoad() {
  const toSync = {};
  let found = false;
  Object.values(KEYS).forEach(key => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) { toSync[key] = JSON.parse(raw); found = true; }
    } catch (e) {}
  });
  if (found) {
    chrome.storage.local.set(toSync, () => loadAllData());
  } else {
    loadAllData();
  }
}

// ── LOAD ALL DATA ─────────────────────────────────
function loadAllData() {
  chrome.storage.local.get(
    [KEYS.BEHAVIOR, KEYS.BLOCKED, KEYS.ANALYTICS, KEYS.MODEL],
    (result) => {
      const behavior  = result[KEYS.BEHAVIOR]  || {};
      const blocked   = result[KEYS.BLOCKED]   || { attempts: [] };
      const analytics = result[KEYS.ANALYTICS] || {};
      const model     = result[KEYS.MODEL]     || {};
      const realSites = behavior.sites || {};

      const hasData =
        Object.keys(realSites).length > 0 ||
        (blocked.attempts && blocked.attempts.length > 0) ||
        (behavior.categories && Object.keys(behavior.categories).length > 0);

      if (!hasData) { showEmptyState(); return; }

      renderHeroScore(blocked, analytics);
      renderSummaryStats(behavior, blocked);
      renderSiteTable(behavior, blocked);
      renderDonutChart(model, behavior);
      renderBlockingList(blocked);
    }
  );
}

// ── EMPTY STATE ───────────────────────────────────
function showEmptyState() {
  document.getElementById('heroScoreNum').textContent  = '--';
  document.getElementById('scoreTitle').textContent    = 'No data yet';
  document.getElementById('scoreDesc').innerHTML       = 'Browse some websites and PrivacyShield<br>will start tracking automatically.';
  document.getElementById('statTotalBlocked').textContent = '0';
  document.getElementById('statSitesVisited').textContent = '0';
  document.getElementById('statTimeOnline').textContent   = '0m';
  document.getElementById('siteTableBody').innerHTML = `
    <tr><td colspan="5" style="text-align:center;color:#55557a;padding:30px;">
      Visit some websites — data will appear here automatically.
    </td></tr>`;
}

// ── HERO SCORE ────────────────────────────────────
function renderHeroScore(blocked, analytics) {
  const totalBlocked = blocked.attempts ? blocked.attempts.length : 0;
  let score;
  if (analytics.overallPrivacyScore !== undefined) {
    score = analytics.overallPrivacyScore;
  } else {
    score = totalBlocked > 0 ? Math.min(98, 60 + Math.floor(totalBlocked * 1.5)) : 85;
  }

  document.getElementById('heroScoreNum').textContent = score;

  const fill = document.getElementById('heroScoreFill');
  const offset = 264 - (264 * score / 100);
  let color, title, desc;
  if (score >= 75) {
    color = '#00e5a0'; title = '🟢 Excellent Privacy';
    desc  = 'Your browsing is well protected.<br>PrivacyShield is doing great!';
  } else if (score >= 50) {
    color = '#ffb547'; title = '🟡 Moderate Privacy';
    desc  = 'Some tracking detected.<br>PrivacyShield is blocking it.';
  } else {
    color = '#ff5c7c'; title = '🔴 High Tracking Detected';
    desc  = 'Sites are aggressively tracking you.<br>PrivacyShield is working hard.';
  }
  fill.style.stroke = color;
  requestAnimationFrame(() => { setTimeout(() => { fill.style.strokeDashoffset = offset; }, 100); });
  document.getElementById('scoreTitle').textContent = title;
  document.getElementById('scoreDesc').innerHTML    = desc;
}

// ── SUMMARY STATS ─────────────────────────────────
function renderSummaryStats(behavior, blocked) {
  const today = new Date().toISOString().split('T')[0];
  const sites = behavior.sites || {};

  // Blocked count
  let blockedCount = 0;
  if (blocked.attempts) {
    blockedCount = currentPeriod === 'today'
      ? blocked.attempts.filter(a => a.timestamp && a.timestamp.startsWith(today)).length
      : blocked.attempts.length;
  }

  // Sites visited + time — read directly from behavior.sites
  let sitesVisited = 0;
  let totalTimeMs  = 0;
  Object.entries(sites).forEach(([, data]) => {
    const lastVisit = data.lastVisit || '';
    if (currentPeriod === 'today' && !lastVisit.startsWith(today)) return;
    sitesVisited++;
    totalTimeMs += (data.timeSpent || 0);
  });

  document.getElementById('statTotalBlocked').textContent = blockedCount;
  document.getElementById('statSitesVisited').textContent = sitesVisited;
  document.getElementById('statTimeOnline').textContent   = msToDisplay(totalTimeMs);
}

// ── SITE TABLE ────────────────────────────────────
function renderSiteTable(behavior, blocked) {
  siteData = [];
  const sites = behavior.sites || {};

  Object.entries(sites).forEach(([site, data]) => {
    const siteBlocked = blocked.attempts
      ? blocked.attempts.filter(a => a.site === site).length
      : 0;
    siteData.push({
      site,
      timeMs:  data.timeSpent || 0,
      visits:  data.visits    || 0,
      score:   Math.max(10, 100 - siteBlocked * 5),
      blocked: siteBlocked
    });
  });

  if (siteData.length === 0) {
    document.getElementById('siteTableBody').innerHTML = `
      <tr><td colspan="5" style="text-align:center;color:#55557a;padding:30px;">
        No sites recorded yet.
      </td></tr>`;
    return;
  }
  renderTableRows();
}

function renderTableRows() {
  const sorted = [...siteData].sort((a, b) => {
    const dir = sortConfig.dir === 'asc' ? 1 : -1;
    const ak  = sortConfig.key === 'time' ? a.timeMs : a[sortConfig.key];
    const bk  = sortConfig.key === 'time' ? b.timeMs : b[sortConfig.key];
    if (typeof ak === 'string') return dir * ak.localeCompare(bk);
    return dir * (ak - bk);
  });

  const tbody = document.getElementById('siteTableBody');
  tbody.innerHTML = sorted.map(row => {
    const scoreClass = row.score >= 70 ? 'pill-green' : row.score >= 40 ? 'pill-yellow' : 'pill-red';
    const favicon    = `https://www.google.com/s2/favicons?domain=${row.site}&sz=32`;
    return `
      <tr>
        <td>
          <div class="site-name-cell">
            <img class="site-favicon" src="${favicon}" onerror="this.style.display='none'" alt="">
            ${row.site}
          </div>
        </td>
        <td>${msToDisplay(row.timeMs)}</td>
        <td>${row.visits}</td>
        <td><span class="privacy-pill ${scoreClass}">${row.score}/100</span></td>
        <td><span class="privacy-pill pill-red">${row.blocked} blocked</span></td>
      </tr>`;
  }).join('');

  const sel = document.getElementById('deleteSiteSelect');
  if (sel) {
    sel.innerHTML = '<option value="">— Select site —</option>';
    siteData.forEach(row => {
      const opt = document.createElement('option');
      opt.value = row.site; opt.textContent = row.site;
      sel.appendChild(opt);
    });
  }
}

function sortTable(key) {
  if (sortConfig.key === key) {
    sortConfig.dir = sortConfig.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortConfig.key = key; sortConfig.dir = 'desc';
  }
  renderTableRows();
}

// ── DONUT CHART ───────────────────────────────────
function renderDonutChart(model, behavior) {
  const canvas = document.getElementById('donutChart');
  const ctx    = canvas.getContext('2d');
  const legend = document.getElementById('donutLegend');
  let categories = [];

  if (model && model.scores && Object.keys(model.scores).length > 0) {
    categories = Object.entries(model.scores)
      .map(([name, data]) => ({ name, pct: data.percentage || 0 }))
      .filter(c => c.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 8);
  }

  if (categories.length === 0 && behavior && behavior.categories) {
    const cats  = behavior.categories;
    const total = Object.values(cats).reduce((s, c) => s + (c.timeSpent || 0), 0) || 1;
    categories  = Object.entries(cats)
      .map(([name, data]) => ({ name, pct: Math.round(((data.timeSpent || 0) / total) * 100) }))
      .filter(c => c.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 8);
  }

  if (categories.length === 0) {
    ctx.beginPath(); ctx.arc(90, 90, 70, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    legend.innerHTML = '<div style="color:#55557a;font-size:12px;text-align:center;">Browse more to see your interests</div>';
    document.getElementById('donutCenterNum').textContent = '0';
    return;
  }

  document.getElementById('donutCenterNum').textContent = categories.length;
  const cx = 90, cy = 90, r = 70, ir = 46;
  let animProgress = 0;
  const totalPct   = categories.reduce((s, c) => s + c.pct, 0) || 1;

  function drawFrame() {
    ctx.clearRect(0, 0, 180, 180);
    let a = -Math.PI / 2;
    categories.forEach((cat, i) => {
      const slice = (cat.pct / totalPct) * Math.PI * 2 * Math.min(animProgress, 1);
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a, a + slice); ctx.closePath();
      ctx.fillStyle = CAT_COLORS[i % CAT_COLORS.length]; ctx.fill();
      a += slice;
    });
    ctx.beginPath(); ctx.arc(cx, cy, ir, 0, Math.PI * 2);
    ctx.fillStyle = '#0d0d1a'; ctx.fill();
    animProgress += 0.04;
    if (animProgress < 1) requestAnimationFrame(drawFrame);
  }
  requestAnimationFrame(drawFrame);

  legend.innerHTML = categories.map((cat, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${CAT_COLORS[i % CAT_COLORS.length]}"></div>
      <div class="legend-cat">${cat.name}</div>
      <div class="legend-pct">${cat.pct}%</div>
    </div>`).join('');

  const sel = document.getElementById('deletePrefSelect');
  if (sel) {
    sel.innerHTML = '<option value="">— Select category —</option>';
    categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.name; opt.textContent = cat.name;
      sel.appendChild(opt);
    });
  }
}

// ── BLOCKING LIST ─────────────────────────────────
function renderBlockingList(blocked) {
  const list = document.getElementById('blockingList');
  if (!list) return;

  if (!blocked || !blocked.attempts || blocked.attempts.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🛡️</div>
        <p>No tracking attempts recorded yet.<br>Browse websites to see protection in action.</p>
      </div>`;
    return;
  }

  const typeIcons = {
    'Canvas Fingerprinting':'🎨','Audio Fingerprinting':'🔊',
    'Font Fingerprinting':'🔤','WebGL Fingerprinting':'🖼️',
    'Screen Fingerprinting':'📺','Battery Fingerprinting':'🔋','Default':'🕵️'
  };

  const grouped = {};
  blocked.attempts.forEach(a => {
    const site = a.site || 'Unknown';
    if (!grouped[site]) grouped[site] = { types: new Set(), count: 0, latest: '' };
    grouped[site].count++;
    grouped[site].types.add(a.type || 'Unknown');
    if (!grouped[site].latest || a.timestamp > grouped[site].latest) grouped[site].latest = a.timestamp;
  });

  list.innerHTML = Object.entries(grouped)
    .sort((a, b) => b[1].count - a[1].count).slice(0, 10)
    .map(([site, data]) => {
      const icon    = typeIcons[data.types.values().next().value] || typeIcons['Default'];
      const timeStr = data.latest ? new Date(data.latest).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <li class="blocking-item">
          <div class="blocking-icon">${icon}</div>
          <div class="blocking-info">
            <div class="blocking-site">${site}</div>
            <div class="blocking-type">${[...data.types].join(', ')}</div>
          </div>
          <div>
            <div class="blocked-count-badge">${data.count}x blocked</div>
            <div class="blocking-time" style="margin-top:4px">${timeStr}</div>
          </div>
        </li>`;
    }).join('');
}

// ── PERIOD CHANGE ─────────────────────────────────
function changePeriod(period, btn) {
  currentPeriod = period;
  document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  chrome.storage.local.get([KEYS.BEHAVIOR, KEYS.BLOCKED], (result) => {
    renderSummaryStats(result[KEYS.BEHAVIOR] || {}, result[KEYS.BLOCKED] || { attempts: [] });
  });
}

// ── ATTACH ALL LISTENERS ──────────────────────────
function attachAllListeners() {
  document.querySelectorAll('.period-tab').forEach(btn => {
    btn.addEventListener('click', () => changePeriod(btn.dataset.period || btn.textContent.trim().toLowerCase(), btn));
  });
  document.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => sortTable(th.dataset.sort));
  });
  const btns = {
    'btnReset': showResetModal, 'btnDeleteSite': showDeleteSiteModal,
    'btnDeletePref': showDeletePrefModal, 'btnExport': exportAllData,
    'btnRefresh': () => { syncThenLoad(); showToast('🔄 Data refreshed'); }
  };
  Object.entries(btns).forEach(([id, fn]) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); });

  const imp = document.getElementById('importInput');
  if (imp) imp.addEventListener('change', importData);

  const modals = {
    'btnConfirmReset': confirmResetFn,       'btnCancelReset': () => closeModal('resetModal'),
    'btnConfirmDeleteSite': confirmDeleteSite,'btnCancelDeleteSite': () => closeModal('deleteSiteModal'),
    'btnConfirmDeletePref': confirmDeletePref,'btnCancelDeletePref': () => closeModal('deletePrefModal')
  };
  Object.entries(modals).forEach(([id, fn]) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); });
}

// ── MODALS ────────────────────────────────────────
function showResetModal()      { document.getElementById('resetModal').classList.add('show'); }
function showDeleteSiteModal() { document.getElementById('deleteSiteModal').classList.add('show'); }
function showDeletePrefModal() { document.getElementById('deletePrefModal').classList.add('show'); }
function closeModal(id)        { document.getElementById(id).classList.remove('show'); }

function confirmResetFn() {
  chrome.storage.local.remove(Object.values(KEYS), () => {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    closeModal('resetModal');
    showToast('✅ Everything reset successfully');
    setTimeout(() => loadAllData(), 300);
  });
}

function confirmDeleteSite() {
  const site = document.getElementById('deleteSiteSelect').value;
  if (!site) { showToast('Please select a site', true); return; }
  chrome.storage.local.get(KEYS.BEHAVIOR, (result) => {
    const b = result[KEYS.BEHAVIOR] || { sites: {} };
    if (b.sites && b.sites[site]) {
      delete b.sites[site];
      chrome.storage.local.set({ [KEYS.BEHAVIOR]: b }, () => {
        closeModal('deleteSiteModal'); loadAllData();
        showToast('🗂️ ' + site + ' data deleted');
      });
    } else { showToast('Site not found', true); }
  });
}

function confirmDeletePref() {
  const cat = document.getElementById('deletePrefSelect').value;
  if (!cat) { showToast('Please select a category', true); return; }
  chrome.storage.local.get([KEYS.BEHAVIOR, KEYS.MODEL], (result) => {
    const b = result[KEYS.BEHAVIOR] || { categories: {} };
    const m = result[KEYS.MODEL]    || { scores: {} };
    if (b.categories && b.categories[cat]) delete b.categories[cat];
    if (m.scores && m.scores[cat]) delete m.scores[cat];
    chrome.storage.local.set({ [KEYS.BEHAVIOR]: b, [KEYS.MODEL]: m }, () => {
      closeModal('deletePrefModal'); loadAllData();
      showToast('🗑️ ' + cat + ' preference deleted');
    });
  });
}

function exportAllData() {
  chrome.storage.local.get(null, (allData) => {
    const out = { _exportedAt: new Date().toISOString(), _version: '1.0' };
    Object.keys(allData).forEach(k => { if (k.startsWith('privacyshield_')) out[k] = allData[k]; });
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'privacyshield-export-' + Date.now() + '.json';
    a.click(); URL.revokeObjectURL(url);
    showToast('📤 Data exported successfully');
  });
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const out  = {};
      Object.entries(data).forEach(([k, v]) => { if (k.startsWith('privacyshield_')) out[k] = v; });
      chrome.storage.local.set(out, () => { loadAllData(); showToast('📥 Data imported successfully'); });
    } catch (err) { showToast('Import failed — invalid file', true); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className   = 'toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  });
}
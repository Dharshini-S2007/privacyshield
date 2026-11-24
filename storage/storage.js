/**
 * PrivacyShield — storage/storage.js
 * Uses chrome.storage.local (NOT localStorage)
 * All functions use callbacks because chrome.storage.local is async
 */

const PREFIX = 'privacyshield_';

const KEYS = {
  BEHAVIOR    : 'privacyshield_behavior',
  BLOCKED     : 'privacyshield_blocked',
  ANALYTICS   : 'privacyshield_analytics',
  SETTINGS    : 'privacyshield_settings',
  MODEL       : 'privacyshield_model',
  SITES       : 'privacyshield_sites',
};

// ── SAVE ONE CATEGORY PREFERENCE ─────────────────
function savePreference(category, data) {
  chrome.storage.local.get(KEYS.BEHAVIOR, (result) => {
    const existing = result[KEYS.BEHAVIOR] || { categories: {}, sites: {}, lastUpdated: null };
    existing.categories[category] = data;
    existing.lastUpdated = Date.now();
    chrome.storage.local.set({ [KEYS.BEHAVIOR]: existing });
  });
}

// ── GET ONE CATEGORY PREFERENCE ──────────────────
function getPreference(category, callback) {
  chrome.storage.local.get(KEYS.BEHAVIOR, (result) => {
    const data = result[KEYS.BEHAVIOR] || {};
    callback(data.categories?.[category] || null);
  });
}

// ── GET ALL PREFERENCES ──────────────────────────
function getAllPreferences(callback) {
  chrome.storage.local.get(KEYS.BEHAVIOR, (result) => {
    callback(result[KEYS.BEHAVIOR] || { categories: {}, sites: {}, lastUpdated: null });
  });
}

// ── DELETE ONE SPECIFIC CATEGORY ─────────────────
function deletePreference(category, callback) {
  chrome.storage.local.get(KEYS.BEHAVIOR, (result) => {
    const existing = result[KEYS.BEHAVIOR] || { categories: {}, sites: {}, lastUpdated: null };
    if (existing.categories && existing.categories[category]) {
      delete existing.categories[category];
      existing.lastUpdated = Date.now();
      chrome.storage.local.set({ [KEYS.BEHAVIOR]: existing }, () => {
        console.log('[PrivacyShield] Deleted category:', category);
        if (callback) callback(true);
      });
    } else {
      console.warn('[PrivacyShield] Category not found:', category);
      if (callback) callback(false);
    }
  });
}

// ── RESET ALL DATA ───────────────────────────────
function resetAllPreferences(callback) {
  chrome.storage.local.remove(Object.values(KEYS), () => {
    console.log('[PrivacyShield] All data wiped');
    if (callback) callback();
  });
}

// ── EXPORT DATA AS JSON STRING ───────────────────
function exportData(callback) {
  chrome.storage.local.get(null, (allData) => {
    const exportable = { _exportedAt: new Date().toISOString(), _version: '1.0' };
    Object.keys(allData).forEach(key => {
      if (key.startsWith(PREFIX)) exportable[key] = allData[key];
    });
    callback(JSON.stringify(exportable, null, 2));
  });
}

// ── IMPORT DATA FROM JSON STRING ─────────────────
function importData(jsonString, callback) {
  try {
    const parsed = JSON.parse(jsonString);
    const toImport = {};
    Object.keys(parsed).forEach(key => {
      if (key.startsWith(PREFIX)) toImport[key] = parsed[key];
    });
    chrome.storage.local.set(toImport, () => {
      if (callback) callback(true);
    });
  } catch (e) {
    console.error('[PrivacyShield] Import failed:', e);
    if (callback) callback(false);
  }
}

// ── GET SITE DATA ────────────────────────────────
function getSiteData(callback) {
  chrome.storage.local.get(KEYS.BEHAVIOR, (result) => {
    const data = result[KEYS.BEHAVIOR] || {};
    callback(data.sites || {});
  });
}

// ── SAVE SITE DATA ───────────────────────────────
function saveSiteData(siteData) {
  chrome.storage.local.get(KEYS.BEHAVIOR, (result) => {
    const existing = result[KEYS.BEHAVIOR] || { categories: {}, sites: {}, lastUpdated: null };
    existing.sites = siteData;
    existing.lastUpdated = Date.now();
    chrome.storage.local.set({ [KEYS.BEHAVIOR]: existing });
  });
}

// ── GET BEHAVIOR DATA ────────────────────────────
function getBehaviorData(callback) {
  chrome.storage.local.get(KEYS.BEHAVIOR, (result) => {
    callback(result[KEYS.BEHAVIOR] || { categories: {}, sites: {}, lastUpdated: null });
  });
}

// ── SAVE BEHAVIOR DATA ───────────────────────────
function saveBehaviorData(data) {
  data.lastUpdated = Date.now();
  chrome.storage.local.set({ [KEYS.BEHAVIOR]: data });
}

// ── GET BLOCKED ATTEMPTS ─────────────────────────
function getBlockedAttempts(callback) {
  chrome.storage.local.get(KEYS.BLOCKED, (result) => {
    callback(result[KEYS.BLOCKED] || { attempts: [], totalBlocked: 0 });
  });
}

// ── LOG ONE BLOCKED ATTEMPT ──────────────────────
function logBlockedAttempt(entry) {
  chrome.storage.local.get(KEYS.BLOCKED, (result) => {
    const existing = result[KEYS.BLOCKED] || { attempts: [], totalBlocked: 0 };
    existing.attempts.push({
      type      : entry.type || 'unknown',
      site      : entry.site || location.hostname,
      timestamp : new Date().toISOString(),
      blocked   : true,
    });
    // Cap log at 500 entries
    if (existing.attempts.length > 500) existing.attempts.splice(0, existing.attempts.length - 500);
    existing.totalBlocked = existing.attempts.length;
    chrome.storage.local.set({ [KEYS.BLOCKED]: existing });
  });
}

// ── GET SETTINGS ─────────────────────────────────
function getSettings(callback) {
  const defaults = { trackingEnabled: true, fingerprintBlocking: true, personalizationOn: true, paused: false };
  chrome.storage.local.get(KEYS.SETTINGS, (result) => {
    callback({ ...defaults, ...(result[KEYS.SETTINGS] || {}) });
  });
}

// ── SAVE SETTINGS ────────────────────────────────
function saveSettings(settings) {
  chrome.storage.local.get(KEYS.SETTINGS, (result) => {
    const existing = result[KEYS.SETTINGS] || {};
    chrome.storage.local.set({ [KEYS.SETTINGS]: { ...existing, ...settings } });
  });
}

// ── GLOBAL EXPORT ────────────────────────────────
window.PrivacyShieldStorage = {
  KEYS,
  savePreference, getPreference, getAllPreferences,
  deletePreference, resetAllPreferences,
  exportData, importData,
  getSiteData, saveSiteData,
  getBehaviorData, saveBehaviorData,
  getBlockedAttempts, logBlockedAttempt,
  getSettings, saveSettings,
};
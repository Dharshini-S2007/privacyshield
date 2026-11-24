/**
 * PrivacyShield — analytics/analytics.js
 * Member 2 | Hackathon Build
 *
 * Tracks site visits, time spent, interests and privacy metrics entirely locally.
 * All data lives in localStorage under 'privacyshield_analytics'.
 * ZERO data sent to any external server.
 * GDPR + India DPDP Act 2023 compliant.
 */

(function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────
  const ANALYTICS_KEY = 'privacyshield_analytics';
  const BLOCKED_KEY   = 'privacyshield_blocked';
  const TICK_MS       = 60 * 1000; // 1 minute — timer resolution

  // Interest keyword mapping: word → category
  // Extend this list to improve accuracy.
  const INTEREST_KEYWORDS = {
    Fashion:     ['fashion', 'clothing', 'apparel', 'outfit', 'dress', 'shoes', 'jewellery', 'jewelry', 'myntra', 'zara', 'h&m'],
    Electronics: ['electronics', 'laptop', 'mobile', 'smartphone', 'tablet', 'camera', 'headphones', 'gadget', 'amazon', 'flipkart', 'croma'],
    Sports:      ['sport', 'cricket', 'football', 'tennis', 'gym', 'fitness', 'nike', 'adidas', 'decathlon'],
    Finance:     ['bank', 'finance', 'invest', 'stock', 'mutual fund', 'insurance', 'loan', 'zerodha', 'groww', 'hdfc', 'sbi', 'icici'],
    News:        ['news', 'politics', 'election', 'times', 'hindu', 'ndtv', 'bbc', 'reuters', 'thehindu', 'indiatimes'],
    Travel:      ['travel', 'flight', 'hotel', 'trip', 'tour', 'booking', 'makemytrip', 'goibibo', 'airbnb'],
    Food:        ['food', 'recipe', 'restaurant', 'zomato', 'swiggy', 'eat', 'cafe', 'pizza', 'biryani'],
    Education:   ['learn', 'course', 'education', 'university', 'college', 'udemy', 'coursera', 'upsc', 'jee', 'neet', 'khan'],
    Social:      ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'reddit', 'snapchat', 'whatsapp'],
    Health:      ['health', 'medicine', 'doctor', 'hospital', 'pharmacy', '1mg', 'netmeds', 'practo'],
  };

  // ─── Internal State ─────────────────────────────────────────────────────────
  let _sessionStart   = Date.now(); // When did this session begin?
  let _currentSite    = window.location.hostname || 'unknown';
  let _tickInterval   = null;       // setInterval handle
  let _isActive       = false;

  // ─── Utility: Load analytics from localStorage ──────────────────────────────
  /**
   * Reads analytics data from localStorage.
   * Returns a default skeleton if nothing is stored yet.
   * @returns {Object} Full analytics data object.
   */
  function _loadAnalytics() {
    try {
      const raw = localStorage.getItem(ANALYTICS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      sites: {},
      interests: {},
      dailyStats: {},
      overallPrivacyScore: 100,
    };
  }

  // ─── Utility: Save analytics to localStorage ────────────────────────────────
  /**
   * Persists analytics data to localStorage.
   * @param {Object} data - Full analytics data object.
   */
  function _saveAnalytics(data) {
    try {
      localStorage.setItem(ANALYTICS_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  // ─── Utility: Get today's date string (YYYY-MM-DD) ──────────────────────────
  function _today() {
    return new Date().toISOString().slice(0, 10);
  }

  // ─── Utility: Get ISO week string (YYYY-WNN) ────────────────────────────────
  function _weekKey(dateStr) {
    const d   = new Date(dateStr);
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  // ─── Utility: Infer interest category from hostname ─────────────────────────
  /**
   * Looks at the site hostname and current page title to guess a category.
   * @param {string} siteName - e.g. "flipkart.com"
   * @returns {string|null} Category name or null if none matched.
   */
  function _inferCategory(siteName) {
    const haystack = (siteName + ' ' + document.title).toLowerCase();
    for (const [category, keywords] of Object.entries(INTEREST_KEYWORDS)) {
      if (keywords.some((kw) => haystack.includes(kw))) {
        return category;
      }
    }
    return null;
  }

  // ─── Utility: Compute privacy score for one site ────────────────────────────
  /**
   * Score = 100 − (penalty per tracking attempt).
   * Formula:
   *   base: 100
   *   − 5 per tracking attempt, capped at 80 total penalty
   *   Minimum score: 20 (no site gets 0 — it still loaded fine)
   * @param {Object} siteData - Single site entry from analytics.sites
   * @returns {number} 0..100
   */
  function _computeSiteScore(siteData) {
    const attempts = siteData.trackingAttempts || 0;
    const penalty  = Math.min(attempts * 5, 80);
    return Math.max(100 - penalty, 20);
  }

  // ─── Utility: Compute overall privacy score ─────────────────────────────────
  /**
   * Overall score = average of all site scores, weighted by visit count.
   * More visits to privacy-hostile sites drag the score down.
   * @param {Object} data - Full analytics data.
   * @returns {number} 0..100
   */
  function _computeOverallScore(data) {
    const sites  = Object.values(data.sites);
    if (sites.length === 0) return 100;

    const totalVisits = sites.reduce((acc, s) => acc + (s.visits || 0), 0);
    if (totalVisits === 0) return 100;

    const weightedSum = sites.reduce((acc, s) => {
      return acc + _computeSiteScore(s) * (s.visits || 0);
    }, 0);

    return Math.round(weightedSum / totalVisits);
  }

  // ─── Utility: Ensure site entry exists ─────────────────────────────────────
  function _ensureSite(data, siteName) {
    if (!data.sites[siteName]) {
      data.sites[siteName] = {
        visits:           0,
        totalTime:        0,
        lastVisit:        null,
        trackingAttempts: 0,
        privacyScore:     100,
      };
    }
  }

  // ─── Utility: Ensure daily stat entry exists ───────────────────────────────
  function _ensureDay(data, dateKey) {
    if (!data.dailyStats[dateKey]) {
      data.dailyStats[dateKey] = {
        sitesVisited:    0,
        trackingBlocked: 0,
        timeOnline:      0,
      };
    }
  }

  // ─── Sync tracking attempts from fingerprint module ─────────────────────────
  /**
   * Reads the blocked attempts log and syncs per-site tracking attempt counts
   * into the analytics data. Called on recordSiteVisit and on the tick timer.
   * @param {Object} data - Full analytics data (mutated in-place).
   */
  function _syncTrackingAttempts(data) {
    try {
      const raw = localStorage.getItem(BLOCKED_KEY);
      if (!raw) return;
      const blockedLog = JSON.parse(raw);
      const today      = _today();

      // Count attempts per site from the log
      const counts = {};
      (blockedLog.attempts || []).forEach((entry) => {
        counts[entry.site] = (counts[entry.site] || 0) + 1;
      });

      // Merge into analytics
      for (const [site, count] of Object.entries(counts)) {
        _ensureSite(data, site);
        data.sites[site].trackingAttempts = count;
        data.sites[site].privacyScore     = _computeSiteScore(data.sites[site]);
      }

      // Update daily stat
      _ensureDay(data, today);
      data.dailyStats[today].trackingBlocked = blockedLog.totalBlocked || 0;
    } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * startAnalytics()
   * Boots the analytics module:
   *  - Records the initial site visit.
   *  - Starts a 1-minute tick timer to record time spent.
   * Call from your content script after startFingerprintProtection().
   */
  function startAnalytics() {
    if (_isActive) return;
    _isActive    = true;
    _sessionStart = Date.now();

    recordSiteVisit(_currentSite);

    // Tick every minute — updates time spent on current site
    _tickInterval = setInterval(() => {
      updateTimeSpent(_currentSite, 1); // 1 minute per tick
    }, TICK_MS);

    // Stop timer when user leaves the page
    window.addEventListener('beforeunload', () => {
      const elapsed = Math.round((Date.now() - _sessionStart) / 60000);
      if (elapsed > 0) updateTimeSpent(_currentSite, elapsed);
      clearInterval(_tickInterval);
    });

    // Handle page visibility changes (tab switching)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearInterval(_tickInterval); // Pause when hidden
      } else {
        _tickInterval = setInterval(() => updateTimeSpent(_currentSite, 1), TICK_MS);
      }
    });

    console.info('[PrivacyShield] Analytics ACTIVE on', _currentSite);
  }

  /**
   * recordSiteVisit(siteName)
   * Increments the visit counter for a site and records today's activity.
   * Also syncs tracking attempt data from the fingerprint module.
   * @param {string} siteName - e.g. "amazon.in"
   */
  function recordSiteVisit(siteName) {
    const data    = _loadAnalytics();
    const today   = _today();

    _ensureSite(data, siteName);
    _ensureDay(data, today);
    _syncTrackingAttempts(data);

    data.sites[siteName].visits++;
    data.sites[siteName].lastVisit = new Date().toISOString();

    data.dailyStats[today].sitesVisited++;

    // Update interest breakdown
    const category = _inferCategory(siteName);
    if (category) {
      data.interests[category] = (data.interests[category] || 0) + 1;
    }

    // Recompute overall score
    data.overallPrivacyScore = _computeOverallScore(data);

    _saveAnalytics(data);
  }

  /**
   * updateTimeSpent(siteName, minutes)
   * Adds `minutes` to the time tracked for a site and today's total.
   * @param {string} siteName - e.g. "youtube.com"
   * @param {number} minutes  - Positive integer
   */
  function updateTimeSpent(siteName, minutes) {
    if (!minutes || minutes <= 0) return;
    const data  = _loadAnalytics();
    const today = _today();

    _ensureSite(data, siteName);
    _ensureDay(data, today);

    data.sites[siteName].totalTime        += minutes;
    data.dailyStats[today].timeOnline     += minutes;

    _saveAnalytics(data);
  }

  /**
   * getAnalytics(period)
   * Returns analytics filtered to a time window.
   * @param {string} period - 'today' | 'week' | 'month' | 'all'
   * @returns {Object} Filtered analytics snapshot.
   */
  function getAnalytics(period) {
    const data  = _loadAnalytics();
    _syncTrackingAttempts(data);
    data.overallPrivacyScore = _computeOverallScore(data);
    _saveAnalytics(data);

    if (period === 'all' || !period) return data;

    const today = _today();
    const now   = new Date();

    // Determine the cutoff date string
    let cutoff;
    if (period === 'today') {
      cutoff = today;
    } else if (period === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      cutoff = d.toISOString().slice(0, 10);
    } else if (period === 'month') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      cutoff = d.toISOString().slice(0, 10);
    }

    // Filter dailyStats
    const filteredDaily = {};
    for (const [day, stat] of Object.entries(data.dailyStats)) {
      if (day >= cutoff) filteredDaily[day] = stat;
    }

    // Filter sites by lastVisit
    const filteredSites = {};
    for (const [site, info] of Object.entries(data.sites)) {
      if (info.lastVisit && info.lastVisit.slice(0, 10) >= cutoff) {
        filteredSites[site] = info;
      }
    }

    return {
      sites:               filteredSites,
      interests:           data.interests,
      dailyStats:          filteredDaily,
      overallPrivacyScore: data.overallPrivacyScore,
    };
  }

  /**
   * getSitePrivacyScore(siteName)
   * Returns the privacy score (0–100) for a specific site.
   * @param {string} siteName
   * @returns {number}
   */
  function getSitePrivacyScore(siteName) {
    const data = _loadAnalytics();
    const site = data.sites[siteName];
    if (!site) return 100; // Unknown site → assumed clean
    return _computeSiteScore(site);
  }

  /**
   * getOverallPrivacyScore()
   * Returns the user's overall privacy score (0–100).
   * @returns {number}
   */
  function getOverallPrivacyScore() {
    const data = _loadAnalytics();
    _syncTrackingAttempts(data);
    data.overallPrivacyScore = _computeOverallScore(data);
    _saveAnalytics(data);
    return data.overallPrivacyScore;
  }

  /**
   * getTopSites(limit)
   * Returns the most-visited sites, sorted by visit count descending.
   * @param {number} limit - How many sites to return (default 5).
   * @returns {Array<{site, visits, totalTime, trackingAttempts, privacyScore}>}
   */
  function getTopSites(limit) {
    limit = limit || 5;
    const data = _loadAnalytics();
    return Object.entries(data.sites)
      .map(([site, info]) => ({
        site,
        visits:           info.visits || 0,
        totalTime:        info.totalTime || 0,
        trackingAttempts: info.trackingAttempts || 0,
        privacyScore:     _computeSiteScore(info),
      }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, limit);
  }

  /**
   * getInterestBreakdown()
   * Returns interest categories with percentage breakdown.
   * @returns {Array<{category, count, percentage}>} sorted by percentage desc.
   */
  function getInterestBreakdown() {
    const data  = _loadAnalytics();
    const total = Object.values(data.interests).reduce((a, b) => a + b, 0);
    if (total === 0) return [];

    return Object.entries(data.interests)
      .map(([category, count]) => ({
        category,
        count,
        percentage: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.percentage - a.percentage);
  }

  // ─── Exports ─────────────────────────────────────────────────────────────────
  window.PrivacyShieldAnalytics = {
    startAnalytics,
    recordSiteVisit,
    updateTimeSpent,
    getAnalytics,
    getSitePrivacyScore,
    getOverallPrivacyScore,
    getTopSites,
    getInterestBreakdown,
  };

  // Individual global exports for convenience
  window.startAnalytics       = startAnalytics;
  window.recordSiteVisit      = recordSiteVisit;
  window.updateTimeSpent      = updateTimeSpent;
  window.getAnalytics         = getAnalytics;
  window.getSitePrivacyScore  = getSitePrivacyScore;
  window.getOverallPrivacyScore = getOverallPrivacyScore;
  window.getTopSites          = getTopSites;
  window.getInterestBreakdown = getInterestBreakdown;
  // ── BRIDGE: Copy localStorage → chrome.storage.local ──
  // Dashboard and popup read from chrome.storage.local
  // This bridge keeps both storages in sync
  function _syncToExtensionStorage() {
    try {
      const analyticsRaw = localStorage.getItem(ANALYTICS_KEY);
      const blockedRaw   = localStorage.getItem(BLOCKED_KEY);

      const toSync = {};
      if (analyticsRaw) toSync[ANALYTICS_KEY] = JSON.parse(analyticsRaw);
      if (blockedRaw)   toSync[BLOCKED_KEY]   = JSON.parse(blockedRaw);

      if (
        Object.keys(toSync).length > 0 &&
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local
      ) {
        chrome.storage.local.set(toSync);
      }
    } catch (e) {}
  }

  // Sync immediately and every 10 seconds
  _syncToExtensionStorage();
  setInterval(_syncToExtensionStorage, 10000);
})();

/**
 * PrivacyShield — tracker/tracker.js
 * FIXED: Uses localStorage (safe for content scripts)
 * All _readBehavior calls converted from callback to sync
 */

(function () {
  'use strict';

  const CATEGORY_KEYWORDS = {
    'Fashion'       : ['fashion','clothing','dress','shoes','shirt','jeans','kurta','saree','lehenga','jacket','top','trouser','apparel','outfit','style','wear','collection','brand','designer','ethnic'],
    'Electronics'   : ['electronics','laptop','mobile','phone','camera','headphone','speaker','tv','television','tablet','charger','battery','monitor','keyboard','processor','gpu','cpu','gadget','tech','smart'],
    'Sports'        : ['sports','cricket','football','tennis','badminton','gym','fitness','yoga','cycling','running','marathon','exercise','training','jersey','racket','bat','ball','wicket','club'],
    'Food'          : ['food','restaurant','recipe','cuisine','pizza','burger','biryani','masala','spice','vegetarian','vegan','breakfast','lunch','dinner','snack','dessert','sweet','cafe','delivery','zomato','swiggy'],
    'Travel'        : ['travel','hotel','flight','booking','destination','trip','tour','vacation','holiday','resort','beach','mountain','visa','passport','airline','bus','train','map','itinerary'],
    'Books'         : ['book','novel','author','literature','fiction','biography','education','textbook','reading','library','chapter','story','kindle','ebook','publish','magazine','journal'],
    'Beauty'        : ['beauty','skincare','makeup','cosmetic','lipstick','foundation','serum','moisturizer','hair','salon','spa','grooming','fragrance','perfume','cream','lotion','sunscreen'],
    'Home'          : ['furniture','home','decor','kitchen','bedroom','sofa','mattress','pillow','curtain','lamp','shelf','appliance','interior','garden','bathroom','dining','cleaning'],
    'Finance'       : ['finance','bank','loan','emi','credit','debit','insurance','invest','stock','mutual fund','sip','nifty','sensex','tax','gst','aadhaar','pan','wallet','upi','payment'],
    'Entertainment' : ['movie','music','game','streaming','netflix','youtube','series','episode','actor','actress','song','album','playlist','concert','ott','anime','comic','podcast'],
  };

  const BEHAVIOR_KEY = 'privacyshield_behavior';

  let _tracking      = false;
  let _pageStartTime = null;
  let _scrollDepth   = 0;
  let _hoverTimers   = {};
  let _detectedCats  = [];

  const _handlers = { click: null, scroll: null, mouseover: null, mouseout: null, unload: null };

  // ── STORAGE HELPERS (localStorage — SYNC — safe for content scripts) ──
  function _readBehavior() {
    try {
      const raw = localStorage.getItem(BEHAVIOR_KEY);
      return raw ? JSON.parse(raw) : { categories: {}, sites: {}, lastUpdated: Date.now() };
    } catch (e) {
      return { categories: {}, sites: {}, lastUpdated: Date.now() };
    }
  }

  function _writeBehavior(data) {
    try {
      data.lastUpdated = Date.now();
      localStorage.setItem(BEHAVIOR_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[PrivacyShield Tracker] Write failed:', e);
    }
  }

  function _defaultCategory() { return { clicks: 0, timeSpent: 0, score: 0 }; }
  function _defaultSite(hostname) { return { visits: 0, timeSpent: 0, lastVisit: '', hostname }; }

  // ── CATEGORY DETECTION ────────────────────────
  function detectPageCategories() {
    const sources = [];
    sources.push(document.title || '');
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) sources.push(metaDesc.getAttribute('content') || '');
    document.querySelectorAll('h1,h2,h3').forEach(el => sources.push(el.textContent));
    let linkCount = 0;
    document.querySelectorAll('a').forEach(el => { if (linkCount++ < 50) sources.push(el.textContent); });
    const bodyText = (document.body && document.body.innerText)
      ? document.body.innerText.substring(0, 3000) : '';
    sources.push(bodyText);

    const combined = sources.join(' ').toLowerCase();
    const found = [];
    Object.entries(CATEGORY_KEYWORDS).forEach(([category, keywords]) => {
      let hits = 0;
      keywords.forEach(kw => {
        let idx = 0;
        while ((idx = combined.indexOf(kw, idx)) !== -1) { hits++; idx += kw.length; }
      });
      if (hits >= 2) found.push({ category, hits });
    });
    found.sort((a, b) => b.hits - a.hits);
    return found.slice(0, 3).map(f => f.category);
  }

  function _recalcScore(cat) {
    return Math.min(1000, Math.round((cat.clicks * 10) + (cat.timeSpent / 1000 * 0.5)));
  }

  function _elementKey(el) {
    if (!el) return 'unknown';
    return (el.id || '') + (el.className || '').toString().slice(0, 20) + (el.tagName || '');
  }

  // ── EVENT HANDLERS (ALL SYNC NOW) ────────────

  function _onClick(e) {
    try {
      const target = e.target;
      if (!target) return;
      const el   = target.closest('a, button, [role="button"]') || target;
      const text = (el.textContent || el.getAttribute('href') || '').toLowerCase();

      // SYNC — no callback
      const data = _readBehavior();

      _detectedCats.forEach(cat => {
        if (!data.categories[cat]) data.categories[cat] = _defaultCategory();
        data.categories[cat].clicks += 1;
        data.categories[cat].score   = _recalcScore(data.categories[cat]);
      });

      Object.entries(CATEGORY_KEYWORDS).forEach(([cat, keywords]) => {
        if (keywords.some(kw => text.includes(kw))) {
          if (!data.categories[cat]) data.categories[cat] = _defaultCategory();
          data.categories[cat].clicks += 1;
          data.categories[cat].score   = _recalcScore(data.categories[cat]);
        }
      });

      _writeBehavior(data);
    } catch (e) {
      console.warn('[PrivacyShield] onClick error:', e);
    }
  }

  function _onScroll() {
    try {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      const pct = Math.round((scrollTop / docHeight) * 100);
      if (pct > _scrollDepth) _scrollDepth = pct;
    } catch (e) {}
  }

  function _onMouseOver(e) {
    try {
      const el = e.target;
      if (!el || !el.tagName) return;
      const tag = el.tagName.toLowerCase();
      if (!['a','button','img','article','section','li','div'].includes(tag)) return;
      const key = _elementKey(el);
      if (_hoverTimers[key]) return;

      _hoverTimers[key] = setTimeout(() => {
        try {
          const text = (el.textContent || el.getAttribute('alt') || '').toLowerCase();

          // SYNC — no callback
          const data = _readBehavior();

          _detectedCats.forEach(cat => {
            if (!data.categories[cat]) data.categories[cat] = _defaultCategory();
            data.categories[cat].timeSpent += 2000;
            data.categories[cat].score      = _recalcScore(data.categories[cat]);
          });

          Object.entries(CATEGORY_KEYWORDS).forEach(([cat, keywords]) => {
            if (keywords.some(kw => text.includes(kw))) {
              if (!data.categories[cat]) data.categories[cat] = _defaultCategory();
              data.categories[cat].timeSpent += 2000;
              data.categories[cat].score      = _recalcScore(data.categories[cat]);
            }
          });

          _writeBehavior(data);
          delete _hoverTimers[key];
        } catch (e) {
          console.warn('[PrivacyShield] mouseOver timer error:', e);
          delete _hoverTimers[key];
        }
      }, 2000);
    } catch (e) {
      console.warn('[PrivacyShield] onMouseOver error:', e);
    }
  }

  function _onMouseOut(e) {
    try {
      const key = _elementKey(e.target);
      if (_hoverTimers[key]) { clearTimeout(_hoverTimers[key]); delete _hoverTimers[key]; }
    } catch (e) {}
  }

  function _onUnload() {
    try {
      if (!_pageStartTime) return;
      const timeOnPage = Date.now() - _pageStartTime;
      const hostname   = location.hostname;

      // SYNC — no callback
      const data = _readBehavior();

      _detectedCats.forEach(cat => {
        if (!data.categories[cat]) data.categories[cat] = _defaultCategory();
        data.categories[cat].timeSpent += timeOnPage;
        data.categories[cat].score      = _recalcScore(data.categories[cat]);
      });

      if (!data.sites[hostname]) data.sites[hostname] = _defaultSite(hostname);
      data.sites[hostname].timeSpent   += timeOnPage;
      data.sites[hostname].scrollDepth  = _scrollDepth;

      _writeBehavior(data);
    } catch (e) {
      console.warn('[PrivacyShield] onUnload error:', e);
    }
  }

  function _recordVisit() {
    try {
      const hostname = location.hostname;
      if (!hostname) return;

      // SYNC — no callback
      const data = _readBehavior();

      if (!data.sites[hostname]) data.sites[hostname] = _defaultSite(hostname);
      data.sites[hostname].visits    += 1;
      data.sites[hostname].lastVisit  = new Date().toISOString();

      _writeBehavior(data);
    } catch (e) {
      console.warn('[PrivacyShield] recordVisit error:', e);
    }
  }

  // ── PUBLIC API ────────────────────────────────
  function startTracking() {
    if (_tracking) return;
    _tracking      = true;
    _pageStartTime = Date.now();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        _detectedCats = detectPageCategories();
      });
    } else {
      _detectedCats = detectPageCategories();
    }

    _recordVisit();

    _handlers.click     = _onClick;
    _handlers.scroll    = _onScroll;
    _handlers.mouseover = _onMouseOver;
    _handlers.mouseout  = _onMouseOut;
    _handlers.unload    = _onUnload;

    document.addEventListener('click',      _handlers.click,     true);
    window.addEventListener('scroll',       _handlers.scroll,    { passive: true });
    document.addEventListener('mouseover',  _handlers.mouseover, true);
    document.addEventListener('mouseout',   _handlers.mouseout,  true);
    window.addEventListener('beforeunload', _handlers.unload);

    console.log('[PrivacyShield Tracker] Started on', location.hostname, '| Cats:', _detectedCats);
  }

  function stopTracking() {
    if (!_tracking) return;
    _tracking = false;
    document.removeEventListener('click',      _handlers.click,     true);
    window.removeEventListener('scroll',       _handlers.scroll);
    document.removeEventListener('mouseover',  _handlers.mouseover, true);
    document.removeEventListener('mouseout',   _handlers.mouseout,  true);
    window.removeEventListener('beforeunload', _handlers.unload);
    Object.values(_hoverTimers).forEach(t => clearTimeout(t));
    _hoverTimers = {};
    console.log('[PrivacyShield Tracker] Stopped.');
  }

  // SYNC version — no callback needed
  function getTrackingData() {
    const data = _readBehavior();
    data.currentPage = {
      url         : location.href,
      hostname    : location.hostname,
      detectedCats: _detectedCats,
      scrollDepth : _scrollDepth,
      timeOnPage  : _pageStartTime ? Date.now() - _pageStartTime : 0,
    };
    return data;
  }

  window.PrivacyShieldTracker = {
    startTracking,
    stopTracking,
    getTrackingData,
    detectPageCategories,
    CATEGORY_KEYWORDS,
  };
  // ── BRIDGE: Copy localStorage → chrome.storage.local ──
  function _syncToExtensionStorage() {
    try {
      const raw = localStorage.getItem(BEHAVIOR_KEY);
      if (!raw) return;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [BEHAVIOR_KEY]: JSON.parse(raw) });
      }
    } catch (e) {}
  }

  // Sync every 10 seconds and on page unload
  setInterval(_syncToExtensionStorage, 10000);
  window.addEventListener('beforeunload', _syncToExtensionStorage);

})();
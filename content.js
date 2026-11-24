/**
 * PrivacyShield — content.js
 * FIXED: No script injection. Modules loaded via manifest.json directly.
 * chrome.storage.local works here because this IS a content script context.
 */

(function () {
  'use strict';

  // ─── INIT ───────────────────────────────────────
  function boot() {
    try {
      if (!document.documentElement) return;
      console.log('[PrivacyShield] Booting on:', location.hostname);

      // storage.js and tracker.js are already loaded by manifest.json
      // Just call their functions directly — no injection needed

      initTracker();

      console.log('[PrivacyShield] Boot complete on:', location.hostname);
    } catch (err) {
      console.warn('[PrivacyShield] Boot error:', err);
    }
  }

  function initTracker() {
    try {
      if (window.PrivacyShieldTracker) {
        // Check settings first, then start
        chrome.storage.local.get('privacyshield_settings', (result) => {
          const settings = result['privacyshield_settings'] || {};
          if (settings.paused !== true) {
            window.PrivacyShieldTracker.startTracking();
            console.log('[PrivacyShield] Tracker started');
          } else {
            console.log('[PrivacyShield] Tracker paused by user setting');
          }
        });
      } else {
        console.warn('[PrivacyShield] Tracker not found on window');
      }
    } catch (err) {
      console.warn('[PrivacyShield] Tracker init failed:', err);
    }
  }

  // ─── MESSAGE LISTENER ───────────────────────────
  // Listens for messages from popup.js
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // Popup toggle pause/resume
    if (message.type === 'PRIVACYSHIELD_TOGGLE') {
      try {
        const tracker = window.PrivacyShieldTracker;
        if (tracker) {
          message.paused ? tracker.stopTracking() : tracker.startTracking();
        }
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false });
      }
      return true;
    }

    // Popup reset all
    if (message.type === 'PRIVACYSHIELD_RESET') {
      try {
        chrome.storage.local.remove([
          'privacyshield_behavior',
          'privacyshield_blocked',
          'privacyshield_analytics',
          'privacyshield_settings',
          'privacyshield_model'
        ]);
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false });
      }
      return true;
    }

    // Popup asking for current page data
    if (message.type === 'GET_PAGE_DATA') {
      try {
        const tracker = window.PrivacyShieldTracker;
        if (tracker) {
          tracker.getTrackingData((data) => {
            sendResponse({ success: true, data });
          });
        } else {
          sendResponse({ success: false, error: 'Tracker not loaded' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true; // keep channel open for async response
    }

    // Ping — popup checking if content.js is alive
    if (message.type === 'PING') {
      sendResponse({ success: true, alive: true });
      return true;
    }
  });

  // ─── START ──────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
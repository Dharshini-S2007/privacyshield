/**
 * PrivacyShield — background.js
 * Service worker — injects fingerprint protection into every page
 */

// Inject injected.js into every page at document_start in MAIN world
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return;
  if (!tab.url) return;
  if (tab.url.startsWith('chrome://')) return;
  if (tab.url.startsWith('chrome-extension://')) return;
  if (tab.url.startsWith('about:')) return;

  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files:  ['injected.js'],
    world:  'MAIN',
    injectImmediately: true
  }).catch(() => {
    // Some pages block injection — silently ignore
  });
});

// Also inject when extension first installed or reloaded
chrome.runtime.onInstalled.addListener(() => {
  console.log('[PrivacyShield] Extension installed — fingerprint protection ready');
});
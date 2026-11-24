# PrivacyShield — Member 2 Deliverables
## `fingerprint/fingerprint.js` + `analytics/analytics.js`

---

## How Fingerprint Blocking Works (Technical)

### The Core Trick: `Object.defineProperty()`

Websites read your browser's properties using JavaScript getters like:
```js
navigator.hardwareConcurrency  // → 8 (your real CPU cores)
screen.width                   // → 1920 (your real screen)
```

`Object.defineProperty()` lets us **replace the getter** before any website code runs:
```js
Object.defineProperty(navigator, 'hardwareConcurrency', {
  get() { return 4; }  // ← website gets this lie instead
});
```

Because our content script runs at `document_start` (declared in `manifest.json`), our
code patches these values **before the page's own JavaScript even begins to parse**.

### Method-by-Method Technical Summary

| Attack | What the site does | What we do |
|---|---|---|
| **Canvas** | Draws text → reads pixels → hashes | Flip 8 random pixels ±1 in `getImageData`, append noise to `toDataURL` |
| **Audio** | Creates OfflineAudioContext → reads floats | Add ±0.0001 noise to first 100 samples in `startRendering` |
| **Font** | Draws text in 100s of fonts, measures width | Round `getBoundingClientRect` to 1dp for elements < 50px |
| **WebGL** | Reads GPU vendor + renderer string | Return `"ANGLE (Generic GPU…)"` from `getParameter(37445/37446)`, block `WEBGL_debug_renderer_info` |
| **Screen** | Reads exact px dimensions | Round to nearest 10px, hardcode `colorDepth=24` |
| **Navigator** | Reads CPU cores, RAM, plugins, UA | Return generic: 4 cores, 8GB RAM, 0 plugins, generic Chrome UA |
| **Battery** | Reads level + chargingTime → unique combo | Always return `level=1.0, charging=true, chargingTime=0` |
| **Timezone** | `Intl.DateTimeFormat().resolvedOptions()` | Spoof `timeZone = 'UTC'` |

---

## manifest.json — Required Entries

Your `manifest.json` MUST declare the content scripts to run at `document_start`:

```json
{
  "manifest_version": 3,
  "name": "PrivacyShield",
  "version": "1.0",
  "permissions": ["storage", "activeTab", "scripting"],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "fingerprint/fingerprint.js",
        "analytics/analytics.js"
      ],
      "run_at": "document_start",
      "all_frames": false
    }
  ]
}
```

> **`run_at: document_start`** is critical — without it, the site's JS loads first
> and reads real values before we can intercept them.

---

## Integration — What Member 1 Calls From My Files

### From fingerprint.js

```js
// ✅ Start protection — call ONCE when extension loads
startFingerprintProtection();

// ✅ Pause protection (when user toggles off in popup)
stopFingerprintProtection();

// ✅ Get full log for dashboard rendering
const log = getBlockedAttempts();
// Returns:
// {
//   attempts: [{ site, type, timestamp, blocked }],
//   totalBlocked: 42,
//   sitesTracked: ['facebook.com', 'amazon.in']
// }

// ✅ Get just the count (for badge/counter in popup)
const count = getBlockedCount(); // → 42

// ✅ User presses "Clear Data" button
clearBlockedLog();
```

### From analytics.js

```js
// ✅ Start analytics engine — call once after startFingerprintProtection()
startAnalytics();

// ✅ Manually record a visit (auto-called by startAnalytics on load)
recordSiteVisit('flipkart.com');

// ✅ Manually add time (auto-called every 1 min by internal timer)
updateTimeSpent('youtube.com', 5); // 5 minutes

// ✅ Get analytics for the dashboard
const today   = getAnalytics('today');
const weekly  = getAnalytics('week');
const monthly = getAnalytics('month');
const all     = getAnalytics('all');

// ✅ Score for a single site
const score = getSitePrivacyScore('facebook.com'); // → 20

// ✅ User's overall score (0-100) — show in header of dashboard
const overall = getOverallPrivacyScore(); // → 78

// ✅ Top 5 most-visited sites
const top = getTopSites(5);
// Returns:
// [
//   { site: 'youtube.com', visits: 12, totalTime: 340, trackingAttempts: 3, privacyScore: 85 },
//   ...
// ]

// ✅ Interest donut chart data
const interests = getInterestBreakdown();
// Returns:
// [
//   { category: 'Electronics', count: 8, percentage: 45 },
//   { category: 'News', count: 5, percentage: 28 },
//   ...
// ]
```

### Recommended Boot Sequence (content_script.js)

```js
// content_script.js — runs at document_start
startFingerprintProtection();  // Must be first
startAnalytics();              // Second
```

---

## Testing: How to Verify Fingerprinting Is Actually Blocked

### Step 1 — Open DevTools Console on any site

Paste this into the console to test each intercept manually:

```js
// Canvas test
const c = document.createElement('canvas');
const ctx = c.getContext('2d');
ctx.fillText('test', 10, 10);
console.log('Canvas toDataURL:', c.toDataURL().slice(-20)); // Should vary each call

// WebGL test
const gl = c.getContext('webgl');
const ext = gl.getExtension('WEBGL_debug_renderer_info');
console.log('WebGL ext (should be null):', ext); // Should be null

const vendor = gl.getParameter(37445);
console.log('GPU Vendor (should be generic):', vendor); // Should say "Generic"

// Navigator test
console.log('CPU cores (should be 4):', navigator.hardwareConcurrency);
console.log('RAM (should be 8):', navigator.deviceMemory);
console.log('Plugins (should be 0):', navigator.plugins.length);

// Battery test
navigator.getBattery().then(b => console.log('Battery level (should be 1):', b.level));

// Timezone test
console.log('TZ (should be UTC):', Intl.DateTimeFormat().resolvedOptions().timeZone);
```

### Step 2 — Use These Fingerprinting Test Sites

| Website | What It Tests |
|---|---|
| `https://coveryourtracks.eff.org` | Full fingerprint audit by EFF — best overall |
| `https://browserleaks.com` | Detailed breakdown of every property |
| `https://fingerprintjs.com/demo` | Commercial fingerprint library |
| `https://amiunique.org` | Uniqueness score |
| `https://deviceinfo.me` | Screen, battery, navigator values |

**What to look for:**
- `coveryourtracks.eff.org` should show "randomized canvas" ✅
- `browserleaks.com/canvas` should show different hashes on each reload ✅
- GPU vendor on `browserleaks.com/webgl` should show "Generic" ✅

### Step 3 — Verify Blocking Log in localStorage

Open DevTools → Application → Local Storage → your extension's origin:

```js
JSON.parse(localStorage.getItem('privacyshield_blocked'))
// Should show attempts array filling up as you browse
```

### Step 4 — Sites to Test On (Aggressive Trackers)

| Site | Why |
|---|---|
| `facebook.com` | Canvas + Audio + WebGL fingerprinting |
| `amazon.in` | Canvas + screen fingerprinting |
| `google.com` | Font + navigator fingerprinting |
| `youtube.com` | Canvas + AudioContext |
| `naukri.com` | Multiple fingerprint vectors |
| `linkedin.com` | Canvas + WebGL |
| `flipkart.com` | Screen + navigator |
| `hotstar.com` | AudioContext + Canvas |

---

## Testing Checklist

```
FINGERPRINT MODULE
─────────────────────────────────────────────────────────────────
[ ] startFingerprintProtection() runs without errors in console
[ ] canvas.toDataURL() returns different value on repeated calls
[ ] WebGL WEBGL_debug_renderer_info extension returns null
[ ] WebGL getParameter(37445) returns "Generic" not real GPU
[ ] navigator.hardwareConcurrency === 4
[ ] navigator.deviceMemory === 8
[ ] navigator.plugins.length === 0
[ ] navigator.getBattery() resolves with level=1.0
[ ] Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC'
[ ] Blocked attempts appear in localStorage under 'privacyshield_blocked'
[ ] getBlockedCount() returns correct total
[ ] clearBlockedLog() empties the log
[ ] stopFingerprintProtection() pauses logging (no new entries)
[ ] coveryourtracks.eff.org shows randomized canvas result

ANALYTICS MODULE
─────────────────────────────────────────────────────────────────
[ ] startAnalytics() runs without errors
[ ] recordSiteVisit() increments visits in localStorage
[ ] localStorage 'privacyshield_analytics' is created on first visit
[ ] getAnalytics('today') returns only today's data
[ ] getAnalytics('week') returns last 7 days
[ ] getAnalytics('month') returns last 30 days
[ ] getAnalytics('all') returns everything
[ ] getTopSites(5) returns sorted array of 5 sites
[ ] getInterestBreakdown() returns percentage array summing to ~100
[ ] getSitePrivacyScore('facebook.com') returns value between 0-100
[ ] getOverallPrivacyScore() returns value between 0-100
[ ] Time spent auto-increments (wait 1 min and recheck localStorage)
[ ] Tracking attempts from fingerprint module sync into analytics

INTEGRATION
─────────────────────────────────────────────────────────────────
[ ] Both files load at document_start (no console errors)
[ ] fingerprint.js loads before analytics.js
[ ] window.PrivacyShieldFingerprint object exists on any page
[ ] window.PrivacyShieldAnalytics object exists on any page
[ ] Data persists across page reloads (localStorage survives)
[ ] No data sent to any network endpoint (check DevTools Network tab — no external calls)
[ ] Extension does NOT slow page load noticeably (< 50ms overhead)
```

---

## Privacy Compliance Notes

- **GDPR Article 25** (Data minimisation): We store only site names and aggregated counts — no personal identifiers.
- **India DPDP Act 2023 Section 4**: All data processing is local; no data fiduciary relationship is created.
- **No cookies set**. No `fetch()` or `XMLHttpRequest` calls. No WebSockets.
- User can run `clearBlockedLog()` + `localStorage.clear()` to exercise their right to erasure.

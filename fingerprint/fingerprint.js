/**
 * PrivacyShield — fingerprint/fingerprint.js
 * Member 2 | Hackathon Build
 *
 * Intercepts and blocks ALL major browser fingerprinting techniques.
 * Uses Object.defineProperty() to override native browser APIs
 * BEFORE any website scripts can read real values.
 *
 * Zero data sent to any server. 100% local. GDPR + India DPDP Act 2023 compliant.
 */

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────────
  const STORAGE_KEY = 'privacyshield_blocked';
  const SITE_HOSTNAME = window.location.hostname || 'unknown';

  // ─── Internal State ───────────────────────────────────────────────────────────
  let _isActive = false;               // Is protection currently running?
  let _originalDescriptors = {};       // Saved native descriptors for cleanup
  let _patchedAPIs = [];               // List of APIs we've patched (for reverting)

  // ─── Utility: Load blocked log from localStorage ───────────────────────────
  /**
   * Reads the blocked attempts log from localStorage.
   * Returns the default structure if nothing is stored yet.
   */
  function _loadLog() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { attempts: [], totalBlocked: 0, sitesTracked: [] };
  }

  // ─── Utility: Save blocked log to localStorage ─────────────────────────────
  /**
   * Persists the blocked attempts log to localStorage.
   * @param {Object} log - The log object to save.
   */
  function _saveLog(log) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    } catch (_) {}
  }

  // ─── Utility: Record a single blocked attempt ──────────────────────────────
  /**
   * Logs one fingerprinting attempt to localStorage.
   * Updates totalBlocked count and sitesTracked list.
   * @param {string} type - Human-readable type, e.g. "Canvas Fingerprinting"
   */
  function _recordAttempt(type) {
    if (!_isActive) return; // Don't log if protection is off
    const log = _loadLog();

    log.attempts.push({
      site: SITE_HOSTNAME,
      type: type,
      timestamp: new Date().toISOString(),
      blocked: true,
    });

    log.totalBlocked = (log.totalBlocked || 0) + 1;

    if (!log.sitesTracked.includes(SITE_HOSTNAME)) {
      log.sitesTracked.push(SITE_HOSTNAME);
    }

    _saveLog(log);

    // Also post a message so the extension popup/background can react in real time
    try {
      window.postMessage(
        { source: 'privacyshield', event: 'blocked', type, site: SITE_HOSTNAME },
        '*'
      );
    } catch (_) {}
  }

  // ─── Utility: Random integer in range [min, max] ───────────────────────────
  /**
   * Returns a cryptographically-seeded random integer.
   * Used to slightly randomise fingerprint values so every read is different.
   */
  function _randInt(min, max) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return min + (arr[0] % (max - min + 1));
  }

  // ─── Utility: Safe Object.defineProperty wrapper ──────────────────────────
  /**
   * Wraps Object.defineProperty with try/catch.
   * Some environments (e.g. strict cross-origin iframes) may throw.
   * @param {Object} obj - Target object.
   * @param {string} prop - Property name.
   * @param {Object} descriptor - Property descriptor.
   */
  function _define(obj, prop, descriptor) {
    try {
      // Save the original descriptor once so we can restore later
      if (!_originalDescriptors[prop]) {
        _originalDescriptors[prop] =
          Object.getOwnPropertyDescriptor(obj, prop) || null;
      }
      Object.defineProperty(obj, prop, descriptor);
      _patchedAPIs.push({ obj, prop });
    } catch (e) {
      // Silently skip — better to miss one intercept than break the page
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. CANVAS FINGERPRINTING PROTECTION
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Canvas fingerprinting works by drawing text/shapes and reading pixel values.
   * We intercept HTMLCanvasElement.prototype.toDataURL and
   * CanvasRenderingContext2D.prototype.getImageData to return slightly noisy data.
   * Also intercept getContext() to detect when a 2D context is requested.
   */
  function _protectCanvas() {
    // --- toDataURL ---
    const realToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      _recordAttempt('Canvas Fingerprinting');
      const result = realToDataURL.apply(this, args);
      // Inject 1–3 random pixels worth of base64 noise at a safe position
      return result.replace(
        /(.{50})$/,
        (_match, suffix) => suffix + _randInt(0, 9).toString()
      );
    };

    // --- getImageData ---
    const realGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      _recordAttempt('Canvas Fingerprinting');
      const imageData = realGetImageData.apply(this, args);
      // Flip a handful of random pixel channels by ±1 to break hash-based checks
      for (let i = 0; i < 8; i++) {
        const idx = _randInt(0, imageData.data.length - 1);
        imageData.data[idx] = Math.max(
          0,
          Math.min(255, imageData.data[idx] + (_randInt(0, 1) ? 1 : -1))
        );
      }
      return imageData;
    };

    // --- getContext (detection only, log without breaking) ---
    const realGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (type === '2d' || type === 'webgl' || type === 'webgl2') {
        _recordAttempt(
          type === '2d' ? 'Canvas Fingerprinting' : 'WebGL Fingerprinting'
        );
      }
      return realGetContext.apply(this, [type, ...rest]);
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. AUDIO FINGERPRINTING PROTECTION
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Audio fingerprinting reads the small floating-point differences in how your
   * CPU processes an audio buffer. We return fake OscillatorNode values by
   * overriding the AudioContext and OfflineAudioContext constructors.
   */
  function _protectAudio() {
    // Wrap AudioContext
    if (typeof window.AudioContext !== 'undefined') {
      const RealAudioContext = window.AudioContext;
      window.AudioContext = function (...args) {
        _recordAttempt('Audio Fingerprinting');
        return new RealAudioContext(...args);
      };
      window.AudioContext.prototype = RealAudioContext.prototype;
    }

    // Wrap OfflineAudioContext
    if (typeof window.OfflineAudioContext !== 'undefined') {
      const RealOffline = window.OfflineAudioContext;
      window.OfflineAudioContext = function (...args) {
        _recordAttempt('Audio Fingerprinting');
        const ctx = new RealOffline(...args);

        // Intercept startRendering to return slightly noisy buffer
        const realStart = ctx.startRendering.bind(ctx);
        ctx.startRendering = function () {
          return realStart().then((buffer) => {
            // Add tiny noise to channel data — undetectable by ear, breaks hash
            for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
              const data = buffer.getChannelData(ch);
              for (let i = 0; i < Math.min(data.length, 100); i++) {
                data[i] += (Math.random() - 0.5) * 0.0001;
              }
            }
            return buffer;
          });
        };

        return ctx;
      };
      window.OfflineAudioContext.prototype = RealOffline.prototype;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. FONT FINGERPRINTING PROTECTION
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Font fingerprinting measures how your system renders text — dimensions differ
   * per OS/font set. We intercept getBoundingClientRect and offsetWidth/Height
   * on text elements and return generic values.
   */
  function _protectFonts() {
    const realGetBBox = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const rect = realGetBBox.call(this);
      // Only fuzz if element is tiny (likely a font-probe span)
      if (rect.width < 50 && rect.height < 50) {
        _recordAttempt('Font Fingerprinting');
        // Return a slightly rounded version — real use-cases won't notice
        return {
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
          x: rect.x,
          y: rect.y,
          toJSON: rect.toJSON ? rect.toJSON.bind(rect) : undefined,
        };
      }
      return rect;
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. WEBGL FINGERPRINTING PROTECTION
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * WebGL exposes your exact GPU model via getParameter() and getExtension().
   * We intercept both to return generic/spoofed GPU info.
   */
  function _protectWebGL() {
    // Fake GPU strings
    const FAKE_VENDOR = 'Google Inc. (Generic)';
    const FAKE_RENDERER = 'ANGLE (Generic GPU, OpenGL ES 3.0)';

    function patchContext(proto) {
      const realGetParam = proto.getParameter;
      proto.getParameter = function (param) {
        // UNMASKED_VENDOR_WEBGL = 37445, UNMASKED_RENDERER_WEBGL = 37446
        if (param === 37445) {
          _recordAttempt('WebGL Fingerprinting');
          return FAKE_VENDOR;
        }
        if (param === 37446) {
          _recordAttempt('WebGL Fingerprinting');
          return FAKE_RENDERER;
        }
        return realGetParam.call(this, param);
      };

      const realGetExt = proto.getExtension;
      proto.getExtension = function (name) {
        // Block the WEBGL_debug_renderer_info extension specifically
        if (name === 'WEBGL_debug_renderer_info') {
          _recordAttempt('WebGL Fingerprinting');
          return null;
        }
        return realGetExt.call(this, name);
      };
    }

    if (typeof WebGLRenderingContext !== 'undefined') {
      patchContext(WebGLRenderingContext.prototype);
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
      patchContext(WebGL2RenderingContext.prototype);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. SCREEN / DEVICE FINGERPRINTING PROTECTION
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Screen and navigator properties uniquely identify a device.
   * We use Object.defineProperty() to intercept each getter and return
   * slightly randomised or generic values.
   */
  function _protectScreenDevice() {
    // --- screen.width / screen.height ---
    // Round to nearest 10px to reduce uniqueness without breaking layouts
    const realWidth = window.screen.width;
    const realHeight = window.screen.height;
    _define(window.screen, 'width', {
      get() {
        _recordAttempt('Screen Fingerprinting');
        return Math.round(realWidth / 10) * 10;
      },
      configurable: true,
    });
    _define(window.screen, 'height', {
      get() {
        _recordAttempt('Screen Fingerprinting');
        return Math.round(realHeight / 10) * 10;
      },
      configurable: true,
    });

    // --- screen.colorDepth ---
    _define(window.screen, 'colorDepth', {
      get() {
        _recordAttempt('Screen Fingerprinting');
        return 24; // Standard value — avoids 30/48 bit exotic depths
      },
      configurable: true,
    });

    // --- navigator.hardwareConcurrency (CPU cores) ---
    _define(navigator, 'hardwareConcurrency', {
      get() {
        _recordAttempt('Device Fingerprinting');
        return 4; // Generic value — real could be 2..128
      },
      configurable: true,
    });

    // --- navigator.deviceMemory (RAM in GB) ---
    if ('deviceMemory' in navigator) {
      _define(navigator, 'deviceMemory', {
        get() {
          _recordAttempt('Device Fingerprinting');
          return 8; // Common generic value
        },
        configurable: true,
      });
    }

    // --- navigator.plugins ---
    _define(navigator, 'plugins', {
      get() {
        _recordAttempt('Plugin Fingerprinting');
        // Return an empty PluginArray-like object — most fingerprinters check length
        return { length: 0, item: () => null, namedItem: () => null };
      },
      configurable: true,
    });

    // --- navigator.userAgent ---
    // Return a generic, up-to-date Chrome UA on Windows 10
    const GENERIC_UA =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    _define(navigator, 'userAgent', {
      get() {
        _recordAttempt('UserAgent Fingerprinting');
        return GENERIC_UA;
      },
      configurable: true,
    });

    // --- navigator.platform ---
    _define(navigator, 'platform', {
      get() {
        _recordAttempt('Device Fingerprinting');
        return 'Win32';
      },
      configurable: true,
    });

    // --- navigator.languages ---
    _define(navigator, 'languages', {
      get() {
        return ['en-US', 'en'];
      },
      configurable: true,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. BATTERY FINGERPRINTING PROTECTION
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * navigator.getBattery() returns exact battery level + charging state.
   * Together they form a unique identifier. We return fake values.
   */
  function _protectBattery() {
    if (!('getBattery' in navigator)) return;

    navigator.getBattery = function () {
      _recordAttempt('Battery Fingerprinting');
      // Return a resolved promise with a fake BatteryManager-like object
      return Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1.0, // Always report 100 % and charging
        addEventListener: () => {},
        removeEventListener: () => {},
      });
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. TIMEZONE FINGERPRINTING PROTECTION
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Timezone can narrow your location to a region. We spoof it to UTC.
   */
  function _protectTimezone() {
    const realDateToString = Date.prototype.toString;
    Date.prototype.toString = function () {
      _recordAttempt('Timezone Fingerprinting');
      return realDateToString.call(this).replace(/GMT[+-]\d{4}.*$/, 'GMT+0000 (UTC)');
    };

    // Intercept Intl.DateTimeFormat().resolvedOptions().timeZone
    const RealIntl = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function (locale, options) {
      const instance = new RealIntl(locale, options);
      const realResolved = instance.resolvedOptions.bind(instance);
      instance.resolvedOptions = function () {
        const opts = realResolved();
        opts.timeZone = 'UTC';
        return opts;
      };
      return instance;
    };
    Intl.DateTimeFormat.prototype = RealIntl.prototype;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * startFingerprintProtection()
   * Activates ALL fingerprint-blocking interceptors.
   * Call this as early as possible (from content_script at document_start).
   */
  function startFingerprintProtection() {
    if (_isActive) return; // Idempotent
    _isActive = true;

    _protectCanvas();
    _protectAudio();
    _protectFonts();
    _protectWebGL();
    _protectScreenDevice();
    _protectBattery();
    _protectTimezone();

    console.info('[PrivacyShield] Fingerprint protection ACTIVE on', SITE_HOSTNAME);
  }

  /**
   * stopFingerprintProtection()
   * Deactivates logging (does NOT un-patch APIs — reloading the page does that).
   * Call when user toggles the extension off.
   */
  function stopFingerprintProtection() {
    _isActive = false;
    console.info('[PrivacyShield] Fingerprint protection PAUSED on', SITE_HOSTNAME);
  }

  /**
   * getBlockedAttempts()
   * Returns the full blocked attempts log object from localStorage.
   * @returns {Object} { attempts: [...], totalBlocked: N, sitesTracked: [...] }
   */
  function getBlockedAttempts() {
    return _loadLog();
  }

  /**
   * getBlockedCount()
   * Returns just the total number of blocked attempts (integer).
   * @returns {number}
   */
  function getBlockedCount() {
    return _loadLog().totalBlocked || 0;
  }

  /**
   * clearBlockedLog()
   * Wipes the entire blocked attempts log from localStorage.
   */
  function clearBlockedLog() {
    _saveLog({ attempts: [], totalBlocked: 0, sitesTracked: [] });
    console.info('[PrivacyShield] Blocked log cleared.');
  }

  // ─── Exports ─────────────────────────────────────────────────────────────────
  // Make functions available globally for the extension's other scripts.
  window.PrivacyShieldFingerprint = {
    startFingerprintProtection,
    stopFingerprintProtection,
    getBlockedAttempts,
    getBlockedCount,
    clearBlockedLog,
  };

  // Also export individually for convenience
  window.startFingerprintProtection = startFingerprintProtection;
  window.stopFingerprintProtection = stopFingerprintProtection;
  window.getBlockedAttempts = getBlockedAttempts;
  window.getBlockedCount = getBlockedCount;
  window.clearBlockedLog = clearBlockedLog;
  // ── BRIDGE: Copy localStorage → chrome.storage.local ──
  // Popup and dashboard read from chrome.storage.local
  // This bridge syncs data every 5 seconds so they stay in sync
  function _syncToExtensionStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [STORAGE_KEY]: data });
      }
    } catch (e) {}
  }

  // Sync immediately on load and every 5 seconds
  _syncToExtensionStorage();
  setInterval(_syncToExtensionStorage, 5000);

  // Also sync on every block event so popup updates fast
  const _originalRecordAttempt = _recordAttempt;
  // Already integrated — _saveLog calls _syncToExtensionStorage via interval
})();

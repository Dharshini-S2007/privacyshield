/**
 * PrivacyShield — injected.js
 * Runs in MAIN world (page context) via chrome.scripting.executeScript
 * This is the correct MV3 way to intercept native browser APIs
 */

(function () {
  if (window.__ps_active__) return;
  window.__ps_active__ = true;

  const recentAlerts = {};

  // ── LOG TO LOCALSTORAGE ───────────────────────
  function logAttempt(type) {
    try {
      const key  = 'privacyshield_blocked';
      const raw  = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : { attempts: [], totalBlocked: 0, sitesTracked: [] };
      data.attempts.push({
        site:      location.hostname,
        type:      type,
        timestamp: new Date().toISOString(),
        blocked:   true
      });
      data.totalBlocked = data.attempts.length;
      if (!data.sitesTracked.includes(location.hostname)) {
        data.sitesTracked.push(location.hostname);
      }
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
  }

  // ── SHOW ALERT ────────────────────────────────
  function showAlert(type) {
    const now = Date.now();
    if (recentAlerts[type] && now - recentAlerts[type] < 5000) return;
    recentAlerts[type] = now;

    const icons = {
      'Canvas Fingerprinting':  '🎨',
      'Audio Fingerprinting':   '🔊',
      'WebGL Fingerprinting':   '🖼️',
      'Font Fingerprinting':    '🔤',
      'Screen Fingerprinting':  '📺',
      'Battery Fingerprinting': '🔋'
    };

    let root = document.getElementById('__ps_alerts__');
    if (!root) {
      root = document.createElement('div');
      root.id = '__ps_alerts__';
      root.style.cssText = [
        'position:fixed',
        'top:16px',
        'right:16px',
        'z-index:2147483647',
        'display:flex',
        'flex-direction:column',
        'gap:8px',
        'pointer-events:none',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif'
      ].join(';');
      document.documentElement.appendChild(root);
    }

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#1a1a2e',
      'border:1px solid rgba(108,99,255,0.5)',
      'border-left:3px solid #ff5c7c',
      'border-radius:10px',
      'padding:10px 14px',
      'width:290px',
      'pointer-events:all',
      'opacity:0',
      'transform:translateX(310px)',
      'transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1)',
      'box-shadow:0 4px 20px rgba(0,0,0,0.5)'
    ].join(';');

    box.innerHTML =
      '<div style="display:flex;align-items:flex-start;gap:8px;">' +
        '<span style="font-size:18px;flex-shrink:0;">' + (icons[type] || '🕵️') + '</span>' +
        '<div>' +
          '<div style="color:#ff5c7c;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:2px;">Tracking Blocked</div>' +
          '<div style="color:#f0f0ff;font-size:12px;font-weight:600;margin-bottom:2px;">' + type + '</div>' +
          '<div style="color:#9999cc;font-size:11px;">' + location.hostname + ' tried to fingerprint you</div>' +
          '<div style="color:#00e5a0;font-size:11px;font-weight:600;margin-top:2px;">PrivacyShield blocked it ✓</div>' +
        '</div>' +
      '</div>';

    root.appendChild(box);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        box.style.opacity   = '1';
        box.style.transform = 'translateX(0)';
      });
    });

    setTimeout(() => {
      box.style.opacity   = '0';
      box.style.transform = 'translateX(310px)';
      setTimeout(() => { if (box.parentNode) box.parentNode.removeChild(box); }, 400);
    }, 4000);
  }

  function detect(type) {
    logAttempt(type);
    showAlert(type);
  }

  // ── 1. CANVAS ─────────────────────────────────
  const _getCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const ctx = _getCtx.call(this, type, attrs);
    if (type === '2d' && ctx) {
      const el         = this;
      const _toDataURL = el.toDataURL.bind(el);
      const _getImgData = ctx.getImageData.bind(ctx);

      el.toDataURL = function () {
        detect('Canvas Fingerprinting');
        ctx.fillStyle = 'rgba(255,255,255,0.004)';
        ctx.fillRect(Math.random() * 5, Math.random() * 5, 1, 1);
        return _toDataURL.apply(el, arguments);
      };

      ctx.getImageData = function () {
        detect('Canvas Fingerprinting');
        const d = _getImgData.apply(ctx, arguments);
        if (d && d.data.length > 4) {
          d.data[Math.floor(Math.random() * d.data.length / 4) * 4] ^= 1;
        }
        return d;
      };
    }
    return ctx;
  };

  // ── 2. WEBGL ──────────────────────────────────
  const _wglParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (p) {
    if (p === 37446) { detect('WebGL Fingerprinting'); return 'Intel Open Source Technology Center'; }
    if (p === 37445) { detect('WebGL Fingerprinting'); return 'Mesa'; }
    return _wglParam.call(this, p);
  };

  if (window.WebGL2RenderingContext) {
    const _wgl2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (p) {
      if (p === 37446) { detect('WebGL Fingerprinting'); return 'Intel Open Source Technology Center'; }
      if (p === 37445) { detect('WebGL Fingerprinting'); return 'Mesa'; }
      return _wgl2.call(this, p);
    };
  }

  // ── 3. AUDIO ──────────────────────────────────
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const _createAnalyser = AC.prototype.createAnalyser;
      AC.prototype.createAnalyser = function () {
        detect('Audio Fingerprinting');
        const node   = _createAnalyser.call(this);
        const _getFF = node.getFloatFrequencyData.bind(node);
        node.getFloatFrequencyData = function (arr) {
          _getFF(arr);
          for (let i = 0; i < arr.length; i += 10) {
            arr[i] += (Math.random() - 0.5) * 0.0001;
          }
        };
        return node;
      };
    }
  } catch (e) {}

  // ── 4. BATTERY ────────────────────────────────
  if (navigator.getBattery) {
    navigator.getBattery = function () {
      detect('Battery Fingerprinting');
      return Promise.resolve({
        charging: true, chargingTime: 0,
        dischargingTime: Infinity, level: 1.0,
        addEventListener: function () {},
        removeEventListener: function () {}
      });
    };
  }

  // ── 5. HARDWARE ───────────────────────────────
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: function () { return 4; }, configurable: true
    });
  } catch (e) {}

  try {
    if ('deviceMemory' in navigator) {
      Object.defineProperty(navigator, 'deviceMemory', {
        get: function () { return 8; }, configurable: true
      });
    }
  } catch (e) {}

  console.log('[PrivacyShield] MAIN world fingerprint protection active ✓');

})();

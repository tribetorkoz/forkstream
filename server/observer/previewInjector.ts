/**
 * Lightweight DevTools-style Preview Telemetry & Element Inspector Bridge.
 * Injected into served HTML pages from `main` and `fork/*` worktrees so the Observer Agent can:
 *  1. Capture live console logs, warnings, uncaught runtime errors, and unhandled rejections
 *  2. Direct the live preview "camera" smoothly to whatever section Builder/Fork just modified
 *  3. Allow the user to toggle "Click-to-Fork Element Inspector" directly inside the live preview
 */
export function injectObserverPreviewBridge(
  html: string,
  sessionId: string,
  source: 'main' | string,
): string {
  const bridgeScript = `
<script data-forkstream-bridge="1">
(function() {
  const SESSION_ID = ${JSON.stringify(sessionId)};
  const SOURCE = ${JSON.stringify(source)};
  let inspectMode = false;
  let hoverBox = null;

  function sendTelemetry(level, args, fileHint) {
    try {
      const msg = Array.from(args).map(a => {
        if (a instanceof Error) return a.message;
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
      }).join(' ').slice(0, 600);

      window.parent.postMessage({
        type: 'FORKSTREAM_CONSOLE',
        sessionId: SESSION_ID,
        source: SOURCE,
        level,
        message: msg,
        fileHint: fileHint || null
      }, '*');

    } catch {}
  }

  ['log', 'info', 'warn', 'error'].forEach(function(level) {
    const orig = console[level];
    console[level] = function() {
      sendTelemetry(level, arguments);
      return orig.apply(console, arguments);
    };
  });

  window.addEventListener('error', function(e) {
    const hint = e.filename ? e.filename.split('/').slice(-2).join('/') : undefined;
    sendTelemetry('error', [e.message || 'Runtime Error'], hint);
  });

  window.addEventListener('unhandledrejection', function(e) {
    sendTelemetry('error', ['Unhandled Promise: ' + (e.reason && e.reason.message || e.reason)]);
  });

  function ensureHoverBox() {
    if (hoverBox) return hoverBox;
    hoverBox = document.createElement('div');
    hoverBox.style.cssText = 'position:fixed;pointer-events:none;z-index:999999;border:2px solid #22d3ee;background:rgba(34,211,238,0.12);border-radius:6px;transition:all 80ms ease;display:none;box-shadow:0 0 0 1px rgba(0,0,0,0.4),0 0 18px rgba(34,211,238,0.35);';
    document.body.appendChild(hoverBox);
    return hoverBox;
  }

  function buildSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + el.id;
    let sel = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) sel += '.' + cls.join('.');
    }
    return sel;
  }

  function findSectionId(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.section) return cur.dataset.section;
      if (cur.id) return cur.id;
      cur = cur.parentElement;
    }
    return undefined;
  }

  document.addEventListener('mousemove', function(e) {
    if (!inspectMode) return;
    const el = e.target;
    if (!el || el === hoverBox || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    const box = ensureHoverBox();
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
  }, true);

  document.addEventListener('click', function(e) {
    if (!inspectMode) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    if (!el) return;
    const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    window.parent.postMessage({
      type: 'FORKSTREAM_ELEMENT_SELECTED',
      sessionId: SESSION_ID,
      source: SOURCE,
      element: {
        selector: buildSelector(el),
        tagName: el.tagName.toLowerCase(),
        textSnippet: text,
        sectionId: findSectionId(el),
        inferredFile: (el.closest('[data-file]') && el.closest('[data-file]').getAttribute('data-file')) || undefined
      }
    }, '*');
    inspectMode = false;
    document.body.style.cursor = '';
    if (hoverBox) hoverBox.style.display = 'none';
  }, true);

  window.addEventListener('message', function(e) {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'FORKSTREAM_SET_INSPECT') {
      inspectMode = !!data.enabled;
      document.body.style.cursor = inspectMode ? 'crosshair' : '';
      if (!inspectMode && hoverBox) hoverBox.style.display = 'none';
    } else if (data.type === 'FORKSTREAM_FOCUS_SECTION' && data.section) {
      const target = document.getElementById(data.section) || document.querySelector('[data-section="' + data.section + '"]');
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prev = target.style.outline;
        target.style.outline = '2px solid rgba(34, 211, 238, 0.7)';
        target.style.outlineOffset = '4px';
        setTimeout(function() {
          target.style.outline = prev;
          target.style.outlineOffset = '';
        }, 1400);
      }
    }
  });
})();
</script>`

  if (html.includes('</head>')) {
    return html.replace('</head>', `${bridgeScript}\n</head>`)
  }
  if (html.includes('</body>')) {
    return html.replace('</body>', `${bridgeScript}\n</body>`)
  }
  return bridgeScript + '\n' + html
}

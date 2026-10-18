// Progressive enhancements for article pages, inlined once at the end of <body> (no framework, ~1.5 KB):
//   1. a slim reading-progress bar (decorative, aria-hidden; blog.css drops its easing for reduced motion)
//   2. a Copy button on every code block, announced through a polite live region
// Both elements are created here, so nothing half-works without JavaScript.
//
// Written as a real function so it stays readable; build-blog.mjs serializes it, collapses the
// whitespace (so: no // comments inside, end every statement with a semicolon) and syntax-checks it.

import crypto from 'node:crypto';

/* global document, window, requestAnimationFrame -- enhanceArticle runs in the browser */
function enhanceArticle() {
  const d = document;
  const prose = d.querySelector('.prose');
  if (prose) {
    const bar = d.createElement('div');
    bar.className = 'progress';
    bar.setAttribute('aria-hidden', 'true');
    d.body.appendChild(bar);
    let queued = false;
    const update = function () {
      queued = false;
      const r = prose.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : r.top < 0 ? 1 : 0;
      bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    };
    const queue = function () {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    update();
  }

  const blocks = d.querySelectorAll('.code');
  if (!blocks.length) return;
  const live = d.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  d.body.appendChild(live);
  blocks.forEach(function (box) {
    const code = box.querySelector('pre code') || box.querySelector('pre');
    if (!code) return;
    let head = box.querySelector('.code__bar');
    if (!head) {
      head = d.createElement('div');
      head.className = 'code__bar';
      box.insertBefore(head, box.firstChild);
    }
    const btn = d.createElement('button');
    btn.type = 'button';
    btn.className = 'code__copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code');
    let timer = 0;
    const done = function (ok) {
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      live.textContent = ok ? 'Code copied to clipboard' : 'Could not copy the code';
      clearTimeout(timer);
      timer = setTimeout(function () {
        btn.textContent = 'Copy';
        live.textContent = '';
      }, 2000);
    };
    const fallback = function () {
      const ta = d.createElement('textarea');
      ta.value = code.textContent;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      d.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = d.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      btn.focus();
      done(ok);
    };
    btn.addEventListener('click', function () {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(code.textContent).then(function () {
          done(true);
        }, fallback);
      } else {
        fallback();
      }
    });
    head.appendChild(btn);
  });
}

export const ARTICLE_SCRIPT = `(${enhanceArticle.toString().replace(/\n\s*/g, ' ')})();`;

// Throws at build time if the collapsed script no longer parses.
new Function(ARTICLE_SCRIPT);

// For a Content-Security-Policy that disallows inline scripts: script-src 'sha256-...'
export const ARTICLE_SCRIPT_HASH = `sha256-${crypto.createHash('sha256').update(ARTICLE_SCRIPT).digest('base64')}`;

import { useEffect } from 'react';

// Reveal `.reveal-up` elements as they enter the viewport.
// Uses IntersectionObserver (browser-native, reliable even when the 3D canvases
// saturate the main thread) + a CSS transition, with a safety net so content is
// never left hidden if observers don't fire.
const useScrollReveal = () => {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.reveal-up'));
    if (!els.length) return undefined;

    const revealAll = () => els.forEach((el) => el.classList.add('is-visible'));

    let io;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add('is-visible');
              io.unobserve(e.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
      );
      els.forEach((el) => io.observe(el));
    } else {
      revealAll();
    }

    // Safety net: guarantee content becomes visible even if observers stall.
    const fallback = setTimeout(revealAll, 4000);

    return () => {
      clearTimeout(fallback);
      if (io) io.disconnect();
    };
  }, []);
};

export default useScrollReveal;

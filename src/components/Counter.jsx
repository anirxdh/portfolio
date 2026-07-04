import { useEffect, useRef, useState } from 'react';

// Time-based count-up (robust even if requestAnimationFrame is throttled by the
// 3D canvases) that runs once when scrolled into view.
const Counter = ({ value, suffix = '', label }) => {
  const ref = useRef(null);
  const started = useRef(false);
  const [n, setN] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            const duration = 1400;
            let start;
            const step = (t) => {
              if (start === undefined) start = t;
              const p = Math.min((t - start) / duration, 1);
              const eased = 1 - Math.pow(1 - p, 3);
              setN(Math.round(eased * value));
              if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
            // Safety endpoint: guarantee the final value even if rAF stalls.
            setTimeout(() => setN(value), duration + 400);
          }
        });
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value]);

  return (
    <div ref={ref} className="flex flex-col items-center text-center">
      <p className="text-4xl sm:text-5xl font-bold text-white">
        {n}
        <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">{suffix}</span>
      </p>
      <p className="text-sm text-white-600 mt-2">{label}</p>
    </div>
  );
};

export default Counter;

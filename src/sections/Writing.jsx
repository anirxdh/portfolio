import { useEffect, useRef, useState } from 'react';

import { loadBlogIndex } from '../data/blogIndex.js';

// Latest long-form articles. The list comes from /blog/index.json, which the static blog
// generator writes at build time, so the homepage needs no rebuild when articles change.
const Writing = () => {
  const [articles, setArticles] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadBlogIndex()
      .then((list) => {
        if (!cancelled) setArticles(Array.isArray(list) ? list.slice(0, 3) : []);
      })
      .catch(() => {
        if (!cancelled) setArticles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The cards arrive after the fetch, so useScrollReveal (which looks for .reveal-up once, when the
  // app mounts) never sees them and they stayed at opacity 0. Reveal them here with the same
  // rules: fade in when scrolled into view, and all of them after 4 seconds regardless.
  const sectionRef = useRef(null);
  useEffect(() => {
    const cards = sectionRef.current ? [...sectionRef.current.querySelectorAll('.reveal-up:not(.is-visible)')] : [];
    if (!cards.length) return undefined;
    const reveal = (el) => el.classList.add('is-visible');
    if (typeof IntersectionObserver === 'undefined') {
      cards.forEach(reveal);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          reveal(e.target);
          io.unobserve(e.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    cards.forEach((el) => io.observe(el));
    const fallback = setTimeout(() => cards.forEach(reveal), 4000);
    return () => {
      clearTimeout(fallback);
      io.disconnect();
    };
  }, [articles]);

  if (!articles || articles.length === 0) return null;

  return (
    <section className="c-space my-20" id="writing" ref={sectionRef}>
      <div className="flex items-end justify-between gap-5 flex-wrap">
        <div>
          <h2 className="head-text">Writing</h2>
          <p className="text-white-600 mt-3 max-w-2xl">
            How I built the things I built: architecture, trade-offs, and the honest story behind each project.
          </p>
        </div>
        <a href="/blog/" className="text-white-600 hover:text-white transition-colors underline underline-offset-4">
          All articles →
        </a>
      </div>

      <div className="grid md:grid-cols-3 gap-5 mt-10">
        {articles.map((a) => (
          <a
            key={a.slug}
            href={`/blog/${a.slug}/`}
            className="reveal-up group flex flex-col gap-3 rounded-2xl border border-black-300 bg-black-200 p-6 transition-colors hover:border-black-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <div className="flex items-center gap-2 flex-wrap">
              {a.award && (
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: `${a.accent}22`, color: a.accent }}
                >
                  {a.award}
                </span>
              )}
              <span className="text-[11px] uppercase tracking-widest text-white-600">{a.project}</span>
            </div>
            <h3 className="text-white text-lg font-semibold leading-tight">{a.title}</h3>
            <p className="text-sm text-white-600">{a.description}</p>
            <p className="text-xs text-white-600 mt-auto pt-2">{a.readingMinutes} min read</p>
          </a>
        ))}
      </div>
    </section>
  );
};

export default Writing;

import { useEffect, useState } from 'react';

// Latest long-form articles. The list comes from /blog/index.json, which the static blog
// generator writes at build time, so the homepage needs no rebuild when articles change.
const Writing = () => {
  const [articles, setArticles] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/blog/index.json')
      .then((r) => (r.ok ? r.json() : []))
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

  if (!articles || articles.length === 0) return null;

  return (
    <section className="c-space my-20" id="writing">
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

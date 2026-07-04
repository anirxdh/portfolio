import { hackathons } from '../constants/index.js';

const Hackathons = () => {
  return (
    <section className="c-space my-20" id="hackathons">
      <h3 className="head-text">Hackathons</h3>
      <p className="text-white-600 mt-3 max-w-2xl">
        A serial builder — 5× hackathon wins and podium finishes, shipping end-to-end AI products in days,
        from Y Combinator to ElevenLabs, Zed, Replit, and Firecrawl.
      </p>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
        {hackathons.map((h) => (
          <a
            key={h.id}
            href={h.href}
            target="_blank"
            rel="noopener noreferrer"
            className="reveal-up group flex flex-col gap-3 rounded-2xl border border-black-300 bg-black-200 p-6 transition-colors hover:border-black-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <div className="flex items-center justify-between">
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: `${h.accent}22`, color: h.accent }}
              >
                {h.result}
              </span>
              <img
                src="/assets/arrow-up.png"
                alt=""
                aria-hidden="true"
                className="w-3 h-3 opacity-40 group-hover:opacity-100 transition-opacity"
              />
            </div>
            <p className="text-[11px] uppercase tracking-widest text-white-500">{h.event}</p>
            <p className="text-white text-lg font-semibold leading-tight">{h.project}</p>
            <p className="text-sm text-white-600">{h.blurb}</p>
          </a>
        ))}
      </div>
    </section>
  );
};

export default Hackathons;

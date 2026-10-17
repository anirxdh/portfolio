import { hackathons } from '../constants/index.js';

// Each card is one big click target for the project itself (a stretched link on the title), and
// cards with a published deep dive also get a separate "Read how I built it" link that sits above
// the stretched area. Two sibling links, never one anchor inside another.
const Hackathons = () => {
  return (
    <section className="c-space my-20" id="hackathons">
      <div className="flex items-end justify-between gap-5 flex-wrap">
        <div>
          <h2 className="head-text">Hackathons</h2>
          <p className="text-white-600 mt-3 max-w-2xl">
            A serial builder with 5× hackathon wins and podium finishes. I ship end-to-end AI products in days, from Y
            Combinator to ElevenLabs, Zed, Replit, and Firecrawl. In ElevenHacks Season 1, I submitted a project to all
            11 hacks and finished 4th overall on the season leaderboard.
          </p>
        </div>
        <a
          href="https://devpost.com/anirxdh"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white-600 hover:text-white transition-colors underline underline-offset-4"
        >
          My Devpost profile
          <span className="sr-only"> (opens in a new tab)</span>
          <span aria-hidden="true"> ↗</span>
        </a>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
        {hackathons.map((h) => (
          <article
            key={h.id}
            className="reveal-up group relative flex flex-col gap-3 rounded-2xl border border-black-300 bg-black-200 p-6 transition-colors hover:border-black-500 focus-within:border-black-500"
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
            <p className="text-[11px] uppercase tracking-widest text-white-600">{h.event}</p>
            <h3 className="text-white text-lg font-semibold leading-tight">
              <a
                href={h.href}
                target="_blank"
                rel="noopener noreferrer"
                className="focus:outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-blue-400"
              >
                {h.project}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </h3>
            <p className="text-sm text-white-600">{h.blurb}</p>
            {h.article && (
              <a
                href={`/blog/${h.article}/`}
                className="relative z-10 mt-auto w-fit pt-1 text-sm text-white-600 hover:text-white transition-colors underline underline-offset-4 decoration-white/30 hover:decoration-white focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                Read how I built it
                <span className="sr-only">: {h.project}</span>
                <span aria-hidden="true"> →</span>
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
};

export default Hackathons;

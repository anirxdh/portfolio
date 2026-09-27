import { lazy, Suspense, useState } from 'react';

import Button from '../components/Button.jsx';

// react-globe.gl is heavy and below the fold — load it on demand.
const Globe = lazy(() => import('react-globe.gl'));

const About = () => {
  const [hasCopied, setHasCopied] = useState(false);
  const scrollToContact = () => {
    const contactSection = document.getElementById("contact");
    if (contactSection) {
      contactSection.scrollIntoView({ behavior: "smooth" });
    }
  };
  const handleCopy = () => {
    navigator.clipboard.writeText(' anirudhvasudevan11@gmail.com');
    setHasCopied(true);

    setTimeout(() => {
      setHasCopied(false);
    }, 2000);
  };

  return (
    <section className="c-space my-20" id="about">
      <div className="grid xl:grid-cols-3 xl:grid-rows-6 md:grid-cols-2 grid-cols-1 gap-5 h-full">
        <div className="col-span-1 xl:row-span-3">
          <div className="grid-container reveal-up">
            <img
              src="/assets/grid1.png"
              alt="Illustration of a developer workspace"
              width="816"
              height="672"
              loading="lazy"
              decoding="async"
              className="w-full sm:h-[276px] h-fit object-contain"
            />

            <div>
              <h2 className="grid-headtext">Hi, I’m Anirudh Vasudevan</h2>
              <p className="grid-subtext">
              I’m a Full-Stack &amp; AI Engineer focused on frontend and AI integration. I’m currently a Member of Technical Staff at Rivo (a San Francisco fintech), building voice AI agents and owning observability, analytics, and growth. I hold an MS in Computer Science from the University of Minnesota, and I’m a 5× hackathon winner with a top-10 finish at the YC AI Hackathon.
              </p>
            </div>
          </div>
        </div>

        <div className="col-span-1 xl:row-span-3">
          <div className="grid-container reveal-up">
            <img
              src="/assets/skills.webp"
              alt="Logos of the languages, frameworks, and tools in Anirudh's tech stack"
              width="1100"
              height="881"
              loading="lazy"
              decoding="async"
              className="w-full sm:h-[276px] h-fit object-contain"
            />

            <div>
              <h3 className="grid-headtext">Tech Stack</h3>
              <p className="grid-subtext">
                I specialize in a variety of languages, frameworks, and tools that allow me to build robust and scalable
                applications , with a primary focus on frontend innovation and seamless AI integration.
              </p>
            </div>
          </div>
        </div>

        <div className="col-span-1 xl:row-span-4">
          <div className="grid-container reveal-up">
            <div className="rounded-3xl w-full sm:h-[326px] h-fit flex justify-center items-center">
              <Suspense fallback={null}>
                <Globe
                  height={326}
                  width={326}
                  backgroundColor="rgba(0, 0, 0, 0)"
                  backgroundImageOpacity={0.5}
                  showAtmosphere
                  showGraticules
                  globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
                  bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
                  labelsData={[{ lat: 37.7749, lng: -122.4194, text: 'San Francisco, CA', color: 'white', size: 15 }]}
                />
              </Suspense>
            </div>
            <div>
              <h3 className="grid-headtext">Based in San Francisco, building at the intersection of AI and the web.</h3>
              <p className="grid-subtext">Originally from India and now in the Bay Area, I’m flexible with time zones and love collaborating with global teams. Always happy to connect about interesting problems, AI/agent work, and collaborations.</p>
              <Button name="Contact Me" isBeam containerClass="w-full mt-10" onClick={scrollToContact}/>
              <a
                href="/assets/anirudh-vasudevan-resume.pdf"
                download
                className="btn w-full mt-3 no-underline"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-4 h-4"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
                </svg>
                Download Resume
              </a>
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 xl:row-span-3">
          <div className="grid-container reveal-up">
            <img
              src="/assets/grid3.png"
              alt="Abstract illustration representing a passion for coding"
              width="1608"
              height="648"
              loading="lazy"
              decoding="async"
              className="w-full sm:h-[266px] h-fit object-contain"
            />

            <div>
              <h3 className="grid-headtext">My Passion for Coding</h3>
              <p className="grid-subtext">
              I thrive on problem-solving, creativity, and building seamless user experiences. While I work across the full stack, I have a particular passion for frontend engineering and AI-driven application development — from autonomous agents and MCP systems to RAG and voice interfaces. I’m also a serial hackathon builder who loves shipping polished, end-to-end products in just a few days.
              </p>
            </div>
          </div>
        </div>

        <div className="xl:col-span-1 xl:row-span-2">
          <div className="grid-container reveal-up">
            <img
              src="/assets/grid4.png"
              alt=""
              aria-hidden="true"
              width="720"
              height="544"
              loading="lazy"
              decoding="async"
              className="w-full md:h-[126px] sm:h-[276px] h-fit object-cover sm:object-top"
            />

            <div className="space-y-2">
              <p className="grid-subtext text-center">Contact me</p>
              <button
                type="button"
                className="copy-container w-full bg-transparent border-0"
                onClick={handleCopy}
                aria-label={hasCopied ? 'Email address copied' : 'Copy email address to clipboard'}
              >
                <img src={hasCopied ? '/assets/tick.svg' : '/assets/copy.svg'} alt="" aria-hidden="true" />
                <span className="lg:text-xl md:text-xl font-medium text-gray_gradient text-white">anirudhvasudevan11@gmail.com</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default About;
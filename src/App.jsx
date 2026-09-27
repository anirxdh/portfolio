import { lazy, Suspense } from 'react';

import Hero from './sections/Hero.jsx';
import About from './sections/About.jsx';
import Footer from './sections/Footer.jsx';
import Navbar from './sections/Navbar.jsx';
import Contact from './sections/Contact.jsx';
import ImpactBand from './sections/ImpactBand.jsx';
import Hackathons from './sections/Hackathons.jsx';
import Writing from './sections/Writing.jsx';
import Projects from './sections/Projects.jsx';
import WorkExperience from './sections/Experience.jsx';
import useScrollReveal from './hooks/useScrollReveal.js';

// The chat widget (react-markdown + streaming client) is off-screen at load, so keep it out of the first paint.
const AiChatbot = lazy(() => import('./components/AiChat/AiChatbot.jsx'));

const App = () => {
  useScrollReveal();
  return (
    <>
      <a
        href="#home"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:bg-black-300 focus:text-white focus:px-4 focus:py-2 focus:rounded-md"
      >
        Skip to main content
      </a>
      <Navbar />
      <main className="max-w-7xl mx-auto relative">
        <Hero />
        <About />
        <ImpactBand />
        <Projects />
        <Hackathons />
        <Writing />
        <WorkExperience />
        <Contact />
      </main>
      <div className="max-w-7xl mx-auto relative">
        <Footer />
      </div>
      <Suspense fallback={null}>
        <AiChatbot />
      </Suspense>
    </>
  );
};

export default App;

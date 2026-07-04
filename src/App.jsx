import { useState } from 'react';
import Hero from './sections/Hero.jsx';
import About from './sections/About.jsx';
import Footer from './sections/Footer.jsx';
import Navbar from './sections/Navbar.jsx';
import Contact from './sections/Contact.jsx';
import ImpactBand from './sections/ImpactBand.jsx';
import Hackathons from './sections/Hackathons.jsx';
import Projects from './sections/Projects.jsx';
import WorkExperience from './sections/Experience.jsx';
import ExploreWorld from './sections/ExploreWorld.jsx';
import HeroLab from './sections/HeroLab.jsx';
import AiChatbot from './components/AiChat/AiChatbot.jsx';
import useScrollReveal from './hooks/useScrollReveal.js';

// The main site. Kept as its own component so its scroll-reveal + 3D canvases
// mount/unmount cleanly when toggling in and out of full-screen modes.
const Site = ({ onExplore, onHeroLab }) => {
  useScrollReveal();
  return (
    <main className="max-w-7xl mx-auto relative">
      <Navbar onExplore={onExplore} onHeroLab={onHeroLab} />
      <Hero />
      <About />
      <ImpactBand />
      <Projects />
      <Hackathons />
      <WorkExperience />
      <Contact />
      <Footer />
      <AiChatbot />
    </main>
  );
};

const App = () => {
  const [view, setView] = useState('site'); // 'site' | 'explore' | 'herolab'
  const back = () => setView('site');

  // Only one 3D experience is mounted at a time, so each runs smoothly.
  if (view === 'explore') return <ExploreWorld onExit={back} />;
  if (view === 'herolab') return <HeroLab onExit={back} />;
  return <Site onExplore={() => setView('explore')} onHeroLab={() => setView('herolab')} />;
};

export default App;

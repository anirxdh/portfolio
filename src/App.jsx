import Hero from './sections/Hero.jsx';
import About from './sections/About.jsx';
import Footer from './sections/Footer.jsx';
import Navbar from './sections/Navbar.jsx';
import Contact from './sections/Contact.jsx';
import ImpactBand from './sections/ImpactBand.jsx';
import Hackathons from './sections/Hackathons.jsx';
import Projects from './sections/Projects.jsx';
import WorkExperience from './sections/Experience.jsx';
import AiChatbot from './components/AiChat/AiChatbot.jsx';
import useScrollReveal from './hooks/useScrollReveal.js';

const App = () => {
  useScrollReveal();
  return (
    <main className="max-w-7xl mx-auto relative">
      <Navbar />
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

export default App;

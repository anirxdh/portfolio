const Footer = () => {
  return (
    <footer className="c-space pt-7 pb-3 border-t border-black-300 flex justify-between items-center flex-wrap gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-white-600">© 2026 Anirudh Vasudevan. All rights reserved.</p>
        <nav aria-label="Footer" className="flex gap-4 text-sm text-white-600">
          <a href="/about/" className="hover:text-white transition-colors">About</a>
          <a href="/blog/" className="hover:text-white transition-colors">Writing</a>
          <a href="/assets/anirudh-vasudevan-resume.pdf" className="hover:text-white transition-colors">Resume</a>
        </nav>
      </div>

      <div className="flex gap-3">
        <a href="https://github.com/anirxdh" target="_blank" rel="noopener noreferrer" className="social-icon" aria-label="Anirudh on GitHub">
          <img src="/assets/github.svg" alt="" aria-hidden="true" className="w-1/2 h-1/2" />
        </a>
        <a href="https://www.linkedin.com/in/anirudhvasudev/" target="_blank" rel="noopener noreferrer" className="social-icon" aria-label="Anirudh on LinkedIn">
          <img src="/assets/linkedin.png" alt="" aria-hidden="true" className="w-1/2 h-1/2" />
        </a>
        <a href="https://www.instagram.com/anirxdh/" target="_blank" rel="noopener noreferrer" className="social-icon" aria-label="Anirudh on Instagram">
          <img src="/assets/instagram.svg" alt="" aria-hidden="true" className="w-1/2 h-1/2" />
        </a>
      </div>
    </footer>
  );
};

export default Footer;

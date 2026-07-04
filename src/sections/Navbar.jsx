import { useState } from 'react';

import { navLinks } from '../constants/index.js';

const NavItems = ({ onClick = () => {} }) => (
  <ul className="nav-ul">
    {navLinks.map((item) => (
      <li key={item.id} className="nav-li">
        <a href={item.href} className="nav-li_a" onClick={onClick}>
          {item.name}
        </a>
      </li>
    ))}
  </ul>
);

const PillButton = ({ onClick, icon, label }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1.5 rounded-full border border-purple-400/40 bg-purple-500/10 px-3.5 py-1.5 text-sm text-purple-200 hover:bg-purple-500/20 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-purple-400"
  >
    <span aria-hidden="true">{icon}</span> {label}
  </button>
);

const Navbar = ({ onExplore = () => {}, onHeroLab = () => {} }) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/90">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center py-5 mx-auto c-space">
          <a href="/" className="text-neutral-400 font-bold text-xl hover:text-white transition-colors">
            Anirudh's Website {" </>"}
          </a>

          <button
            onClick={toggleMenu}
            className="text-neutral-400 hover:text-white focus:outline-none sm:hidden flex"
            aria-label="Toggle menu">
            <img src={isOpen ? 'assets/close.svg' : 'assets/menu.svg'} alt="toggle" className="w-6 h-6" />
          </button>

          <nav className="sm:flex hidden items-center gap-4">
            <NavItems />
            <PillButton onClick={onHeroLab} icon="✨" label="New Hero" />
            <PillButton onClick={onExplore} icon="🎮" label="Explore" />
          </nav>
        </div>
      </div>

      <div className={`nav-sidebar ${isOpen ? 'max-h-screen' : 'max-h-0'}`}>
        <nav className="p-5 flex flex-col gap-4 items-start">
          <NavItems onClick={closeMenu} />
          <PillButton
            onClick={() => {
              closeMenu();
              onHeroLab();
            }}
            icon="✨"
            label="New Hero"
          />
          <PillButton
            onClick={() => {
              closeMenu();
              onExplore();
            }}
            icon="🎮"
            label="Explore"
          />
        </nav>
      </div>
    </header>
  );
};

export default Navbar;

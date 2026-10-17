import { useState } from 'react';

import { navLinks } from '../constants/index.js';
import { openCommandPalette, preloadCommandPalette, shortcutLabel } from '../components/CommandPalette/events.js';

const NavItems = ({ onClick = () => {} }) => (
  <ul className="nav-ul">
    {navLinks.map((item) => (
      <li key={item.id} className="nav-li">
        <a
          href={item.href}
          className="nav-li_a"
          onClick={onClick}
          {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {item.name}
        </a>
      </li>
    ))}
  </ul>
);

const SearchIcon = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  // Read once on the client: "⌘K" on Apple devices, "Ctrl K" elsewhere.
  const [shortcut] = useState(shortcutLabel);

  const toggleMenu = () => {
    // Opening the menu warms up the palette chunk behind its "Search the site" button.
    if (!isOpen) preloadCommandPalette();
    setIsOpen(!isOpen);
  };
  const closeMenu = () => setIsOpen(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/90">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center py-5 mx-auto c-space">
          <a href="/" className="text-neutral-400 font-bold text-xl hover:text-white transition-colors">
            Anirudh&apos;s Website {' </>'}
          </a>

          <button
            onClick={toggleMenu}
            className="text-neutral-400 hover:text-white focus:outline-none sm:hidden flex"
            aria-label="Toggle menu"
            aria-expanded={isOpen}
            aria-controls="mobile-nav">
            <img src={isOpen ? '/assets/close.svg' : '/assets/menu.svg'} alt="" aria-hidden="true" className="w-6 h-6" />
          </button>

          <div className="sm:flex hidden items-center gap-6">
            <nav>
              <NavItems />
            </nav>

            {/* Command palette hint (desktop only; the shortcut works at any width). */}
            <button
              type="button"
              onClick={openCommandPalette}
              onPointerEnter={preloadCommandPalette}
              onFocus={preloadCommandPalette}
              aria-haspopup="dialog"
              aria-keyshortcuts="Meta+K Control+K"
              title={`Search the site (${shortcut})`}
              className="hidden lg:inline-flex items-center gap-2 rounded-md border border-black-300 bg-black-200 px-2.5 py-1.5 text-neutral-400 hover:text-white hover:border-black-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
              <SearchIcon className="w-3.5 h-3.5" />
              <span className="sr-only">Search the site</span>
              <kbd aria-hidden="true" className="font-generalsans text-xs font-medium tracking-wide">
                {shortcut}
              </kbd>
            </button>
          </div>
        </div>
      </div>

      {/* inert while collapsed, so Tab does not walk through links you cannot see. */}
      <div
        id="mobile-nav"
        className={`nav-sidebar ${isOpen ? 'max-h-screen' : 'max-h-0'}`}
        {...(isOpen ? {} : { inert: '' })}>
        <nav className="p-5">
          <NavItems onClick={closeMenu} />
          <button
            type="button"
            onClick={() => {
              closeMenu();
              openCommandPalette();
            }}
            onFocus={preloadCommandPalette}
            aria-haspopup="dialog"
            className="mt-4 w-full flex items-center justify-center gap-2 rounded-md border border-black-300 bg-black-300/40 py-2.5 text-lg text-neutral-400 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            <SearchIcon className="w-4 h-4" />
            Search the site
          </button>
        </nav>
      </div>
    </header>
  );
};

export default Navbar;

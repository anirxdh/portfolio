/* eslint-disable react/prop-types -- the codebase does not use PropTypes */
// The one arrow the homepage uses (hero buttons, star and planet cards, the universe list, the
// chat's send button), so every arrow has the same weight. Decorative: the link text says where.
export const Arrow = ({ size = 16, className = '' }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d="M3 8h9.5M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// For links that leave the site (a live demo, the source on GitHub).
export const ArrowOut = ({ size = 16, className = '' }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d="M5 11 11.5 4.5M6 4.5h5.5V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

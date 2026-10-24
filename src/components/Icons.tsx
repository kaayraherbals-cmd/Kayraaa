const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' } as const;

/** Small line icons for the header and shop. All decorative: the control that holds them carries the accessible name. */
export const IconSearch = () => (
  <svg {...base}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
);
export const IconUser = () => (
  <svg {...base}><circle cx="12" cy="8.5" r="3.6" /><path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" /></svg>
);
export const IconBag = () => (
  <svg {...base}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></svg>
);
export const IconClose = () => (
  <svg {...base}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconArrow = () => (
  <svg {...base} width={18} height={18}><path d="M4 12h15M13 6l6 6-6 6" /></svg>
);
export const IconCheck = () => (
  <svg {...base} width={18} height={18}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const IconPin = () => (
  <svg {...base} width={18} height={18}><path d="M12 21s6-5.6 6-10.5a6 6 0 1 0-12 0C6 15.4 12 21 12 21Z" /><circle cx="12" cy="10.5" r="2.2" /></svg>
);
export const IconTruck = () => (
  <svg {...base} width={18} height={18}><path d="M3 6.5h11v9H3zM14 10h4l3 3v2.5h-7" /><circle cx="7.5" cy="17.5" r="1.7" /><circle cx="17.5" cy="17.5" r="1.7" /></svg>
);
export const IconMail = () => (
  <svg {...base}><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></svg>
);
export const IconInstagram = () => (
  <svg {...base}><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="12" cy="12" r="3.9" /><circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" /></svg>
);

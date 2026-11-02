const env = import.meta.env;

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const INSTAGRAM_USERNAME = 'kaayra.herbals';
export const INSTAGRAM_HANDLE = `@${INSTAGRAM_USERNAME}`;
/** Instagram's own profile embed (latest posts). Loaded only after a visitor taps "Show latest posts". */
export const INSTAGRAM_EMBED_URL = `https://www.instagram.com/${INSTAGRAM_USERNAME}/embed`;

/**
 * Verified against the Certificate of Incorporation (Ministry of Corporate Affairs), issued 16 October 2026.
 * The certificate also shows a PAN and a TAN. They are deliberately NOT stored here or published.
 * (The GSTIN below contains the PAN as characters 3 to 12, so it is public by design once the GSTIN is shown; GST law requires it on invoices.)
 * The full mailing address on the certificate is also not published: its first line needs checking against the
 * source before any use, so only the registered location is shown.
 * The certificate confirms incorporation only. It is not a manufacturing licence or a product approval.
 */
export const company = {
  legalName: 'KAAYRA HERBALS PRIVATE LIMITED',
  displayName: 'Kaayra Herbals Private Limited',
  type: 'Private Limited Company',
  incorporatedOn: '2026-10-16',
  incorporatedDisplay: '16 October 2026',
  cin: 'U21003UP2026PTC253906',
  /** GST Identification Number (15 characters). Verified against the GST portal "Search Taxpayer" result; checksum validated in shared/gstin.test.ts. Public by law, shown on GST invoices. */
  gstin: '09AANCK3387L1ZQ',
  registeredLocation: 'Varanasi, Uttar Pradesh, India',
} as const;

export const site = {
  name: 'Kaayra Herbals',
  tagline: 'Ancient Wisdom. Modern Thinking. Better Living.',
  url: (clean(env.VITE_SITE_URL) || 'https://kaayraherbals.example').replace(/\/$/, ''),
  // Contact details are intentionally blank until the owner supplies real ones (see .env.example).
  email: clean(env.VITE_CONTACT_EMAIL),
  phone: clean(env.VITE_CONTACT_PHONE),
  address: clean(env.VITE_CONTACT_ADDRESS),
  legalEntity: clean(env.VITE_LEGAL_ENTITY_NAME) || company.legalName,
  instagram: clean(env.VITE_INSTAGRAM_URL) || 'https://www.instagram.com/kaayra.herbals?srtk=MXc4aXA3YmsycWRldg==',
} as const;

/**
 * Other official profiles. Each one is shown (footer link and structured-data sameAs) only when its VITE_ variable holds a real
 * https address, so nothing is linked until the profile exists. See docs/SEO_AUDIT_FIXES.md.
 */
const profile = (label: string, v: unknown) => {
  const url = clean(v);
  return /^https:\/\//.test(url) ? [{ label, url }] : [];
};
export const socialProfiles: { label: string; url: string }[] = [
  ...profile('Facebook', env.VITE_FACEBOOK_URL),
  ...profile('X', env.VITE_X_URL),
  ...profile('LinkedIn', env.VITE_LINKEDIN_URL),
  ...profile('YouTube', env.VITE_YOUTUBE_URL),
];

export const hasContactRoute = Boolean(site.email || site.phone || site.address);

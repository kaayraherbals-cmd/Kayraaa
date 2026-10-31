/**
 * Logo integration points. The owner-supplied Kaayra Herbals logo (green K mark + KAAYRA / HERBALS wordmark) is
 * registered here; every place on the site that shows the brand reads it through <Logo /> (src/components/Logo.tsx).
 * Nothing here claims trademark clearance.
 *
 * Files live in /public/brand (PNG with transparent background, made from the supplied image by scripts/brand-logo.py):
 *   "light" = original colours, for light backgrounds
 *   "dark"  = single-colour Warm Ivory #F7F5EF, for dark backgrounds (footer, mobile menu)
 *   "mono"  = single-colour Deep Herbal Green #173A2D, for one-colour use
 * To replace the artwork later, overwrite the files (same names) or change the paths and sizes below.
 */
export interface LogoArtwork {
  light: string;
  dark: string;
  mono: string;
  width: number;
  height: number;
}

export type LogoKind = 'horizontal' | 'stacked' | 'icon';

export const logos: Record<LogoKind, LogoArtwork | null> = {
  /** 1. Horizontal website logo: K mark beside KAAYRA / HERBALS (header, mobile menu, footer). */
  horizontal: {
    light: '/brand/kaayra-horizontal-light.png',
    dark: '/brand/kaayra-horizontal-dark.png',
    mono: '/brand/kaayra-horizontal-mono.png',
    width: 720,
    height: 197,
  },
  /** 2. Stacked logo: K mark above KAAYRA / HERBALS (loading screen, login, packaging). */
  stacked: {
    light: '/brand/kaayra-stacked-light.png',
    dark: '/brand/kaayra-stacked-dark.png',
    mono: '/brand/kaayra-stacked-mono.png',
    width: 640,
    height: 464,
  },
  /** 3. Standalone botanical K icon (very narrow headers, admin). */
  icon: {
    light: '/brand/kaayra-icon-light.png',
    dark: '/brand/kaayra-icon-dark.png',
    mono: '/brand/kaayra-icon-mono.png',
    width: 360,
    height: 395,
  },
};

/** Square, solid-background logo used for Organization.logo in structured data (path under the site URL). */
export const SCHEMA_LOGO_PATH = '/brand/kaayra-logo-square.png';

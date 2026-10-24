/**
 * Logo integration points. No approved logo artwork has been supplied, so every slot is null and the site
 * shows the typeset wordmark (Fraunces). Nothing here claims trademark clearance.
 *
 * To add final approved vector artwork: place the SVG files in /public/brand, then set the path, e.g.
 *   horizontal: { light: '/brand/kaayra-horizontal-light.svg', dark: '/brand/kaayra-horizontal-dark.svg', mono: '/brand/kaayra-horizontal-mono.svg', width: 220, height: 48 }
 * "light" = artwork for light backgrounds, "dark" = artwork for dark backgrounds, "mono" = single-colour.
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
  /** 1. Horizontal website logo. */
  horizontal: null,
  /** 2. Compact stacked packaging logo. */
  stacked: null,
  /** 3. Standalone botanical K icon. */
  icon: null,
};

import type { Script } from '../../../shared/languages';

/**
 * Script fonts are self-hosted (the Content Security Policy only allows 'self') and each one is downloaded only when a visitor
 * picks a language that needs it. Latin keeps Fraunces and Instrument Sans: they are first in every stack, so English words inside
 * a translated page (brand names, prices) keep the brand look and only the native letters use the script font.
 */
export const loadScriptFont: Record<Script, (() => Promise<unknown>) | null> = {
  latin: null,
  deva: () => import('./deva'),
  bengali: () => import('./bengali'),
  tamil: () => import('./tamil'),
  telugu: () => import('./telugu'),
  gujarati: () => import('./gujarati'),
  kannada: () => import('./kannada'),
  malayalam: () => import('./malayalam'),
  gurmukhi: () => import('./gurmukhi'),
  oriya: () => import('./oriya'),
  nastaliq: () => import('./nastaliq'),
  naskh: () => import('./naskh'),
  olchiki: () => import('./olchiki'),
  meetei: () => import('./meetei'),
};

/** A family and a sample letter per script: used to wait until the font is really ready before the page switches. */
export const probe: Record<Script, { family: string; sample: string } | null> = {
  latin: null,
  deva: { family: 'Noto Sans Devanagari Variable', sample: 'क' },
  bengali: { family: 'Noto Sans Bengali Variable', sample: 'ক' },
  tamil: { family: 'Noto Sans Tamil Variable', sample: 'க' },
  telugu: { family: 'Noto Sans Telugu Variable', sample: 'క' },
  gujarati: { family: 'Noto Sans Gujarati Variable', sample: 'ક' },
  kannada: { family: 'Noto Sans Kannada Variable', sample: 'ಕ' },
  malayalam: { family: 'Noto Sans Malayalam Variable', sample: 'ക' },
  gurmukhi: { family: 'Noto Sans Gurmukhi Variable', sample: 'ਕ' },
  oriya: { family: 'Noto Sans Oriya Variable', sample: 'କ' },
  nastaliq: { family: 'Noto Nastaliq Urdu Variable', sample: 'ا' },
  naskh: { family: 'Noto Naskh Arabic Variable', sample: 'ا' },
  olchiki: { family: 'Noto Sans Ol Chiki Variable', sample: 'ᱚ' },
  meetei: { family: 'Noto Sans Meetei Mayek Variable', sample: 'ꯀ' },
};

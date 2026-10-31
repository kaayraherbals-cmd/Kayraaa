/**
 * Languages offered on the website: English plus the 22 languages of the Eighth Schedule of the Constitution of India.
 * Shared by the browser (switcher, interface text, fonts) and the server (Kaayra AI replies in the visitor's language).
 *
 * `ui` is the language whose interface text is shown. Thirteen languages have their own interface text; for the rest the
 * closest language that its readers also read is used (the switcher says so), and Kaayra AI still answers in the chosen language.
 */
export type Script = 'latin' | 'deva' | 'bengali' | 'tamil' | 'telugu' | 'gujarati' | 'kannada' | 'malayalam' | 'gurmukhi' | 'oriya' | 'nastaliq' | 'naskh' | 'olchiki' | 'meetei';

export interface Language {
  /** BCP 47 code, also the value stored in the browser and sent to Kaayra AI. */
  readonly code: string;
  /** English name (used in the AI instruction). */
  readonly name: string;
  /** Name written in the language itself (shown in the switcher). */
  readonly native: string;
  readonly script: Script;
  /** Reads right to left. */
  readonly rtl: boolean;
  /** Code of the language whose interface text is shown. */
  readonly ui: string;
}

export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', script: 'latin', rtl: false, ui: 'en' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', script: 'deva', rtl: false, ui: 'hi' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', script: 'bengali', rtl: false, ui: 'bn' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', script: 'telugu', rtl: false, ui: 'te' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', script: 'deva', rtl: false, ui: 'mr' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', script: 'tamil', rtl: false, ui: 'ta' },
  { code: 'ur', name: 'Urdu', native: 'اردو', script: 'nastaliq', rtl: true, ui: 'ur' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', script: 'gujarati', rtl: false, ui: 'gu' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', script: 'kannada', rtl: false, ui: 'kn' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', script: 'malayalam', rtl: false, ui: 'ml' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', script: 'oriya', rtl: false, ui: 'or' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', script: 'gurmukhi', rtl: false, ui: 'pa' },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া', script: 'bengali', rtl: false, ui: 'as' },
  { code: 'mai', name: 'Maithili', native: 'मैथिली', script: 'deva', rtl: false, ui: 'hi' },
  { code: 'sat', name: 'Santali', native: 'ᱥᱟᱱᱛᱟᱲᱤ', script: 'olchiki', rtl: false, ui: 'en' },
  { code: 'ks', name: 'Kashmiri', native: 'کٲشُر', script: 'naskh', rtl: true, ui: 'ur' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', script: 'deva', rtl: false, ui: 'ne' },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي', script: 'naskh', rtl: true, ui: 'ur' },
  { code: 'kok', name: 'Konkani', native: 'कोंकणी', script: 'deva', rtl: false, ui: 'mr' },
  { code: 'doi', name: 'Dogri', native: 'डोगरी', script: 'deva', rtl: false, ui: 'hi' },
  { code: 'mni', name: 'Meitei (Manipuri)', native: 'ꯃꯦꯇꯦꯏꯂꯣꯟ', script: 'meetei', rtl: false, ui: 'en' },
  { code: 'brx', name: 'Bodo', native: 'बड़ो', script: 'deva', rtl: false, ui: 'hi' },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्', script: 'deva', rtl: false, ui: 'hi' },
] as const satisfies readonly Language[];

export type LangCode = (typeof LANGUAGES)[number]['code'];
export const DEFAULT_LANG: LangCode = 'en';

export const isLangCode = (v: unknown): v is LangCode => typeof v === 'string' && LANGUAGES.some((l) => l.code === v);
export const languageOf = (code: string): Language => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];

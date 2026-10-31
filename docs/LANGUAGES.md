# Website languages

English plus the 22 scheduled languages of India, chosen from the globe button at the top right of the header (saved in the browser as `kaayra-lang`).

## What changes when a visitor picks a language
- **Interface text** (header, menu, search, account menu, bag, footer, Kaayra AI widget): `src/i18n/en.ts` is the source; `src/i18n/dict/<code>.ts` holds each translation. A test (`src/i18n/i18n.test.ts`) fails if a key is missing or a `{placeholder}` changes.
- **Fonts**: each script's font (Noto, self-hosted via @fontsource, so the Content Security Policy is unchanged) downloads only when that language is chosen. Latin stays Fraunces / Instrument Sans. The names inside the picker use tiny subset fonts (`public/fonts/lang`, regenerate with `python3 scripts/build-language-name-fonts.py`).
- **Kaayra AI** answers in the chosen language (`language` is sent with each question and checked against the allowed list on the server). Fixed replies and the health safety note are written in the language too (`shared/aiLanguage.ts`). Prices written in Indian digits or rupee words are checked like `₹450`.
- Search engines always get the English pages, unchanged: no language URLs, no hreflang, canonical unchanged.

## Interface translated vs. closest language
Own interface text: Hindi, Bengali, Telugu, Marathi, Tamil, Urdu, Gujarati, Kannada, Malayalam, Odia, Punjabi, Assamese, Nepali.
Closest language (the picker says so): Maithili, Dogri, Bodo and Sanskrit use Hindi; Konkani uses Marathi; Kashmiri and Sindhi use Urdu; Santali and Meitei use English. Kaayra AI still answers in all of them.

## Whole-site translation (added in v8)
Everything without a reviewed dictionary entry is now translated at run time into the chosen language: page text on every public page, product and ingredient names and descriptions (including products loaded from the database), journal, legal, privacy and medical pages, forms, buttons, placeholders, `aria-label`, `title` and image `alt` text. The owner's admin screens stay in English.
- Browser: `src/i18n/pageTranslator.ts` walks the live page after React has drawn it, sends the English lines to `POST /api/products?action=translate` (`src/lib/translateApi.ts`), writes the answers into the same text nodes and follows the page as it changes (new route, product loaded, cart updated). Answers are kept in the browser (`kaayra-tr-<lang>` in localStorage), so a repeat visit shows the language at once. Switching back to English restores the original text exactly. English pages, structured data, canonical URLs and what search engines read are never touched.
- Server: `server/translate.ts` (shares `api/products.ts`, so the 12-function limit is unchanged). Same switch and key as Kaayra AI (`AI_ENABLED`, `GEMINI_API_KEY`). Origin check, rate limit, size limits, per-instance cache, and a daily ceiling on model calls (`TRANSLATE_MAX_PER_DAY`, default 1500 per instance). It never sees anything about the visitor, only public page text.
- Protected text: prices, numbers, PIN codes, order numbers, dates, links, e-mail addresses and the brand and partner names in `shared/translate.ts` are swapped for markers before the model sees the text and put back after; a reply that loses or invents a marker is discarded and the line stays English.
- Wording rules for the model (`translationSystem` in `server/translate.ts`): translate every word, natural everyday wording, plant and product names as people say them in that language, never add, remove, strengthen or soften a claim, translate health, privacy and legal sentences literally.
- Logo: the artwork is untouched; its alt text is localised (`brandAlt`, "Kaayra Herbals (काय्रा हर्बल्स)") and the typeset fallback wordmark is marked `translate="no"`. Parts of the page that must never be translated: add `translate="no"` or `data-no-translate`.
- Footer shows a short note in the chosen language that pages are translated automatically and English is the official text (`autoNote`).
- Santali and Meitei (no dictionary of their own) now get translated page text too, not English.
- If AI is off or a request fails, the page simply stays in English; nothing is blanked.

Whole sentences: a block made of text plus simple inline elements (bold, italic, link, span) is sent as one sentence with tags (`⟨a⟩quality promise⟨/a⟩`), so word order can change while links and formatting stay attached. If the model does not keep the tags exactly, that sentence falls back to piece-by-piece translation.

Known limits: Quality for Santali, Meitei, Kashmiri, Sindhi, Dogri, Bodo and Konkani is weaker than for the large languages.

## Before launch
- Have native speakers review the machine-translated legal, privacy, medical-disclaimer, ingredient and product pages in each language you launch (read them in the browser, language by language), and every dictionary and the fixed AI replies, especially `aiErr*`, `footerNotLive`, `footerLive`, `footerMedical` and the `safety` text.
- Urdu, Kashmiri, Sindhi: text reads right to left, but the page layout stays left to right (a mirrored layout needs a separate CSS review).
- Automatic health-claim and dosage checks on AI replies are English-only; other languages rely on the model rules, the model's own `medical_concern` flag and the translated safety note. Test Kaayra AI in each language before switching `AI_ENABLED` on.

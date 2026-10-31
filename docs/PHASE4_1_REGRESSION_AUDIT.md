# Phase 4.1: regression audit

## Finding 1: the FAQ had 8 questions, not 11 (confirmed, fixed)

`shared/faq.json` in `kaayra-herbals-geo-phase4.zip` held 8 questions. The Phase 4.1 brief says the Phase 3 report confirmed 11.

What the ZIP itself shows:

- The Phase 4 documents (`PHASE4_GEO_REMAINING_ISSUES.md`, `PHASE4_GEO_STRUCTURED_DATA_AUDIT.md`, `HANDOFF.md`) already recorded 8 and asked for the missing three. So the 8-question file was what Phase 4 received, not something Phase 4 removed.
- `server/ai/siteContent.generated.ts` in the ZIP was an exact regeneration of the 8-question file (verified: regenerating from the original 8 gives a byte-identical file). No hidden 11-question copy exists anywhere in the ZIP.
- No Phase 3 source for the three answers is in the ZIP. **The exact historical wording could not be recovered and was not invented.**

The three missing questions were identified from the brief. Their answers were reconstructed only from text already published on the site (see CHANGELOG for the source of each sentence).

## Finding 2: "Phase 3 improvements" in the existing 8 answers cannot be proven

Without the Phase 3 source there is nothing to diff against. What was verified instead: the 8 existing answers are unchanged (byte-identical to the ZIP), contain no banned claim words (`clinically|proven|cure|treat|certified by|approved by|award|best |#1`), keep the exact approval disclaimer, and agree with the published pre-launch statements. If a Phase 3 copy exists elsewhere, send it and the three answers can be swapped for the originals.

## Finding 3: schema test fails on Node 22.16.0 (reproduced, fixed)

Reproduced with the exact Node 22.16.0 binary: `node --test scripts/structured-data.check.mjs` throws `ERR_UNKNOWN_FILE_EXTENSION` for `src/content/journal.ts`. Native TypeScript stripping is only on by default from Node 22.18. The same defect affected `npm run ai:site` (it imports `ingredients.ts`). Details in CHANGELOG.

## Finding 4: the 3,000-character retrieval limit does not remove FAQ answers (verified), but ranking can

- Largest section anywhere in the knowledge file: 698 characters; four sections at most, so 2,792 characters at most. **The 3,000 cap cannot bind today.** Lifting it changes the result for 0 of 11 FAQ questions.
- Separately, the retriever returns at most 4 sections ranked by relevance. For 4 of the 11 exact questions the FAQ section is not among them (see REMAINING_ISSUES, item 2). That is ranking, not truncation, and was left alone because the brief forbids changing Gemini behavior.

## Finding 5: one stale unit test (pre-existing, fixed)

`server/ai/customer.test.ts` expected an output cap of 900 tokens; the code's effective cap is 1,024 (`min(config default 1024, CUSTOMER_MAX_TOKENS 1400)`). It fails identically on the untouched ZIP. The test was stale; the code was not changed.

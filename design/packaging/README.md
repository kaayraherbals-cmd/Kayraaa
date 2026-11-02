# Packaging design templates

Reusable layout templates for the three planned formats. They show **zones**, not content.

| File | Format |
|---|---|
| `label-syrup-150ml.svg`, `container-syrup-150ml.svg` | 150 ml syrup bottle (Iron Syrup) |
| `label-syrup-200ml.svg`, `container-syrup-200ml.svg` | 200 ml syrup bottle (most syrups) |
| `label-capsule-30ct.svg`, `container-capsule-30ct.svg` | 30-count capsule container |

Palette: Deep Herbal Green `#173A2D`, Warm Ivory `#F7F5EF`, Muted Bronze `#A88452`, Botanical Sage `#A9BBA6`.
Type: Cormorant Garamond (product name, logo lockup) and Manrope (all technical information).

## Zones on every label

Logo, product name, dosage form, net quantity, approved composition, manufacturer information, batch number,
manufacturing date, expiry date, required warnings, applicable licence details.

## Rules

- **Nothing in the zones is filled in.** Composition, manufacturer details, warnings and licence information must come
  from approved sources and be checked against the applicable regulations before any label is produced.
- Every unapproved preview must carry the banner **CONCEPT — NOT FOR COMMERCIAL USE** (it is built into these files).
  Remove it only on a label that has been approved for production.
- Do not add claims, certifications ("AYUSH approved", "GMP certified", "clinically proven") or benefit statements.
- Keep batch, manufacturing and expiry as blank, legible fields so they can be printed or stamped later.
- Final artwork needs a regulatory and printer review: font embedding, bleed, minimum text sizes and any mandatory
  declarations are not decided here.

## Two palettes, one identity

| Family | Files | Colours |
|---|---|---|
| Master brand | `label-*.svg`, `container-*.svg` | Deep Herbal Green `#173A2D`, Warm Ivory `#F7F5EF`, Muted Bronze `#A88452`, Botanical Sage `#A9BBA6` |
| Women's wellness | `label-*.womens.svg`, `container-*.womens.svg` | Burgundy `#5E2233`, Warm Ivory `#F7F5EF`, Muted Gold `#B39454`, Botanical Rose `#D9A9B2` |

The women's wellness hex values are **proposed** (the brief names the colours but gives no values) and need brand approval. The variants are generated from the master labels by `node scripts/packaging-variants.mjs`, which swaps colours only, so logo proportions, type, label hierarchy and every zone (ingredients, batch, regulatory declarations, warnings, manufacturer) stay identical. Edit the master label, then regenerate. `scripts/packaging-variants.test.ts` checks that the variants match. All files remain concepts until a regulatory reviewer approves them.

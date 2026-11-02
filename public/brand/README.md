# Brand artwork

Registered in `src/content/brand.ts`, shown through `<Logo />`. Source image: `design/brand/kaayra-logo-original.png`.
Rebuild every file with `python3 scripts/brand-logo.py` (Pillow + numpy).

| Slot | Files (light = original colours, dark = ivory, mono = deep green) |
|---|---|
| Horizontal (header, menu, footer) | `kaayra-horizontal-{light,dark,mono}.png` |
| Stacked (loading screen) | `kaayra-stacked-{light,dark,mono}.png` |
| K icon (320px header, admin) | `kaayra-icon-{light,dark,mono}.png` |
| Organization.logo (structured data) | `kaayra-logo-square.png` (1200x1200) |

The horizontal lockup and the dark/mono versions are derived from the supplied image (re-arranged / recoloured, not redrawn): approve them or supply vector files. Trademark clearance is not confirmed.

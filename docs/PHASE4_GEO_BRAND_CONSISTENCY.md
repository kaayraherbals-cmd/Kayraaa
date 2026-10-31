# Phase 4 GEO: brand consistency report

Authoritative source: `src/config/site.ts` (brand name, legal name, tagline, incorporation date, registered location, Instagram) and `shared/founders.json` (names, roles).

| Fact | Config | Home / routes | Our Story, Approach, Founders, Journal | Footer | Structured data | llms.txt, llms-full.txt | AI knowledge file |
|---|---|---|---|---|---|---|---|
| Name "Kaayra Herbals" | yes | yes | yes | yes | yes | yes | yes |
| Legal entity "Kaayra Herbals Private Limited" | yes | FAQ answer | n/a | n/a | legalName | yes | yes |
| "Ayurvedic wellness company in Varanasi" | location in config | yes | yes (Home, Story, Founders, article footer) | n/a | description | yes | yes |
| Incorporated 16 Oct 2026 | yes | FAQ | Story | n/a | foundingDate | yes | yes |
| Product status: in development, nothing for sale | n/a | yes | yes | announcement bar | no Offer markup | yes | yes |
| Instagram `kaayra.herbals` | yes | n/a | Home preview | yes | yes | yes | yes |
| Founders and roles | founders.json | Founders route text | Founders page, Story | Founders link | Person nodes | now added | now added |
| Founder qualifications | founders.json | route description says qualifications are on the page | Founders page only | n/a | none | none | none (removed) |
| Journal authorship | n/a | n/a | "by Kaayra Herbals" on every article | n/a | Organization | now stated | now stated |

Differences found and what was done
- Role casing "Co-founder" (data, cards, alt text) vs approved "Co-Founder": changed to the approved wording.
- Co-founder roles missing from the AI knowledge file and llms files: added (roles only).
- AI knowledge file carried a partial qualifications list for two founders: removed, per the instruction not to duplicate qualifications into AI-readable files.
- Article schema headline differed from the visible H1 on one article: fixed.
- Differences left alone because both wordings are accurate: "new Ayurvedic wellness company" (site) vs "Indian Ayurvedic wellness company" (llms); route titles shorter than article H1s; the Organization description does not repeat "nothing is for sale" (its absence of any Offer markup carries that); Story page uses lower-case "co-founders" inside a sentence.
- The FAQ "Who founded" answer lists the founders in a different order from the cards and without roles. It is accurate, and the FAQ was not rewritten as instructed.

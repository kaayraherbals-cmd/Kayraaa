# Phase 4 GEO: structured-data audit

Audited from `scripts/prerender.mjs` as received, then re-checked on the output of the new code. "Before" = the uploaded ZIP.

| Area | Before | Finding | Now |
|---|---|---|---|
| Organization | Defined inline on home; a second thinner copy (same `@id`) on founders; two separate un-identified objects as Article author and publisher | Duplicate or inconsistent entity | One builder, one `@id` (`/#organization`), identical identity facts on every page where it appears |
| Organization facts | Name, legal name, slogan, founding date and place, Instagram were hard-coded in the script | Could drift from `site.ts` | Read from `src/config/site.ts`; Instagram sameAs is the configured account as a clean profile URL |
| Person (3 founders) | Embedded in `Organization.founder` with no `@id`; `worksFor` only on the founders page; role "Co-founder" | No stable identity, one-way link, role casing not the approved one | Own nodes, stable `@id`, `worksFor` + `Organization.founder` both ways, approved roles. Contains name, role, portrait and own Instagram only |
| WebSite | Home only | Fine; articles referenced no website | Same node, also on founders and article pages; `publisher` is the Organization |
| Article | Headline from the meta title; author/publisher inline objects; no `@id`; no breadcrumb | Headline differed from the visible H1 on one article; no entity links | Headline and date read from the page, build fails if they disagree; `@id`, `url`, `mainEntityOfPage`, `isPartOf`; author and publisher reference the Organization; breadcrumb added |
| Canonical consistency | `index.html` has a relative placeholder, prerender sets it per route; hreflang and og:url match; `cleanUrls` and no trailing slash in `vercel.json` | Consistent | Unchanged; seo-check now also asserts og:url and every structured-data page URL equal the canonical |
| Social profiles | Instagram hard-coded with the clean URL; others only from env | Matches config handle | Derived from config; `kaayraherbals_official` appears nowhere |
| Public company facts | Legal name, founding date, Varanasi/Uttar Pradesh/IN | Match `site.ts` | Same, read from config. CIN, PAN, TAN and street address are not published in structured data |
| Forbidden markup | None present | OK | Checked in tests and seo-check: no Offer, Product, Review, Rating, price, availability, logo, credential, `dateModified`, `reviewedBy`, contact detail |
| FAQPage | 8 Q&A, matches visible FAQ | Unchanged | Checked identical to `shared/faq.json` |

Entity map (home and founders pages): WebSite -publisher-> Organization -founder-> 3 Person; each Person -worksFor-> Organization. Article pages: Article -isPartOf-> WebSite, -author/publisher-> Organization.

Limits of this audit: validity against Google's Rich Results Test and the schema.org validator could not be checked (no network). The graphs were validated for JSON syntax, unique `@id`, resolving references and forbidden properties by the checks in the test results file. Google shows no rich result for Organization or Person markup; it is used for entity understanding only.

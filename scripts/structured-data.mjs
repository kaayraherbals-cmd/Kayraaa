// Builds the JSON-LD graphs for the prerender (scripts/prerender.mjs). Pure functions, no file or network access,
// so scripts/structured-data.check.mjs can test them directly.
//
// Rules this file follows (Phase 4 GEO):
//  - One Organization entity (stable @id `${siteUrl}/#organization`) and one WebSite entity (`${siteUrl}/#website`).
//    Every page that mentions them uses the same @id, never a second differently-shaped copy.
//  - One Person entity per founder (stable @id), connected to the Organization both ways (founder / worksFor).
//  - Founder details are limited to name, role, portrait and the founder's own Instagram page. Qualifications,
//    contact details, credentials and any other claim are NOT published in structured data.
//  - Articles are authored and published by the Organization UNLESS the article's own data (src/content/journal.ts) names a real
//    author and/or reviewer. Then, and only then, a Person node for that person (name, role and page only), `reviewedBy` +
//    `lastReviewed` (on the WebPage) and `dateModified` are emitted, and the same facts must be visible on the page.
//    No rating, price or offer is ever emitted. Headline and dates come from what the article page shows.
//  - The Organization carries the owner-supplied logo (`logo` ImageObject + `image`): a square PNG on a solid background,
//    path registered in src/content/brand.ts, size read from the real file (scripts/brand-facts.mjs).
//  - Nothing implies that anything is for sale.

const SLUG = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const ids = (siteUrl) => ({
  organization: `${siteUrl}/#organization`,
  website: `${siteUrl}/#website`,
  logo: `${siteUrl}/#logo`,
  faq: `${siteUrl}/#faq`,
  person: (name) => `${siteUrl}/founders#${SLUG(name)}`,
});

/** Name, job title, portrait and own Instagram page only. */
export function personNode(f, siteUrl) {
  const id = ids(siteUrl);
  return {
    '@type': 'Person',
    '@id': id.person(f.name),
    name: f.name,
    jobTitle: f.role,
    ...(f.photo ? { image: siteUrl + f.photo.src } : {}),
    ...(f.instagram || f.profiles?.length
      ? { sameAs: [...(f.instagram ? [`https://www.instagram.com/${f.instagram}/`] : []), ...(f.profiles ?? []).map((x) => x.url).filter((u) => /^https:\/\//.test(u))] }
      : {}),
    worksFor: { '@id': id.organization },
  };
}

/**
 * The single Organization entity. `founders` is passed only on pages whose graph also contains the Person nodes,
 * so every reference resolves inside the same graph.
 */
export function organizationNode({ siteUrl, brand, otherProfiles = [], founders = [] }) {
  const id = ids(siteUrl);
  return {
    '@type': 'Organization',
    '@id': id.organization,
    name: brand.name,
    legalName: brand.legalName,
    url: siteUrl + '/',
    slogan: brand.tagline,
    description: 'Kaayra Herbals is a new Ayurvedic wellness company in Varanasi, India. Its first formulations are in development.',
    foundingDate: brand.incorporatedOn,
    ...(brand.gstin ? { taxID: brand.gstin } : {}),
    foundingLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: brand.locality, addressRegion: brand.region, addressCountry: brand.countryCode },
    },
    ...(brand.logo
      ? {
          logo: {
            '@type': 'ImageObject',
            '@id': id.logo,
            url: siteUrl + brand.logo.path,
            contentUrl: siteUrl + brand.logo.path,
            width: brand.logo.width,
            height: brand.logo.height,
            caption: `${brand.name} logo`,
          },
          image: siteUrl + brand.logo.path,
        }
      : {}),
    sameAs: [brand.instagramUrl, ...otherProfiles],
    ...(founders.length ? { founder: founders.map((f) => ({ '@id': id.person(f.name) })) } : {}),
  };
}

export function websiteNode({ siteUrl, brand }) {
  const id = ids(siteUrl);
  return {
    '@type': 'WebSite',
    '@id': id.website,
    name: brand.name,
    alternateName: 'Kaayra',
    url: siteUrl + '/',
    inLanguage: 'en-IN',
    publisher: { '@id': id.organization },
  };
}

export function breadcrumbNode(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.item })),
  };
}

const personFromData = (p, id, extra = {}) => ({
  '@type': 'Person',
  '@id': id,
  name: p.name,
  ...(p.role ? { jobTitle: p.role } : {}),
  ...(p.url ? { url: p.url } : {}),
  ...extra,
});

/**
 * `visible` = { headline, datePublished } read from the rendered article page.
 * `meta` = optional verified facts from the article's own data: { author?, review?, updated?, sources? } (see src/content/journal.ts).
 * Returns the article node and any extra nodes it needs (Person for a named author or reviewer, WebPage carrying the review).
 */
export function articleNodes({ siteUrl, url, route, visible, meta = {} }) {
  const id = ids(siteUrl);
  const extra = [];
  const authorId = `${url}#author`;
  const reviewerId = `${url}#reviewer`;
  if (meta.author?.name) extra.push(personFromData(meta.author, authorId));
  if (meta.review?.reviewer?.name) {
    // Credentials are a free-text description here, never a `hasCredential` claim: the page shows the same text.
    extra.push(personFromData(meta.review.reviewer, reviewerId, meta.review.reviewer.credentials ? { description: meta.review.reviewer.credentials } : {}));
    extra.push({
      '@type': 'WebPage',
      '@id': url,
      url,
      name: visible.headline,
      inLanguage: 'en-IN',
      reviewedBy: { '@id': reviewerId },
      ...(meta.review.reviewedOn ? { lastReviewed: meta.review.reviewedOn } : {}),
    });
  }
  const article = {
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: visible.headline,
    description: route.description,
    datePublished: visible.datePublished,
    ...(meta.updated ? { dateModified: meta.updated } : {}),
    inLanguage: 'en-IN',
    url,
    mainEntityOfPage: meta.review?.reviewer?.name ? { '@id': url } : { '@type': 'WebPage', '@id': url },
    isPartOf: { '@id': id.website },
    author: { '@id': meta.author?.name ? authorId : id.organization },
    publisher: { '@id': id.organization },
    ...(meta.sources?.length ? { citation: meta.sources.map((x) => ({ '@type': 'CreativeWork', name: x.label, url: x.url })) } : {}),
  };
  return [article, ...extra];
}

/** The Article node alone (kept for callers and tests that do not need the extra nodes). */
export const articleNode = (args) => articleNodes(args)[0];

/** Reads what an article page really shows: its H1 and its <time datetime>. Throws if either is missing or disagrees with the route. */
export function readVisibleArticle(html, route) {
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  const time = html.match(/<time[^>]*\sdatetime="([^"]+)"/i)?.[1];
  if (!h1) throw new Error(`[structured-data] ${route.path}: no <h1> in the rendered article`);
  if (!time) throw new Error(`[structured-data] ${route.path}: no <time datetime> in the rendered article`);
  const headline = decode(h1.replace(/<[^>]+>/g, '')).trim();
  if (route.date && route.date !== time) throw new Error(`[structured-data] ${route.path}: routes.json date ${route.date} differs from the date shown on the page (${time})`);
  return { headline, datePublished: time };
}

/**
 * The JSON-LD object for one indexable route, or null when the route carries none.
 * `html` is the rendered page body (needed only for articles).
 */
export function graphFor({ route, url, html, siteUrl, brand, founders, faq, otherProfiles = [], articleMeta = {} }) {
  const id = ids(siteUrl);
  const home = { name: 'Home', item: siteUrl + '/' };
  const organizationWithFounders = organizationNode({ siteUrl, brand, otherProfiles, founders });
  const people = founders.map((f) => personNode(f, siteUrl));
  const website = websiteNode({ siteUrl, brand });

  if (route.path === '/') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        website,
        { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: route.title, description: route.description, inLanguage: 'en-IN', isPartOf: { '@id': id.website }, about: { '@id': id.organization } },
        organizationWithFounders,
        ...people,
        {
          '@type': 'FAQPage',
          '@id': id.faq,
          inLanguage: 'en-IN',
          mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
        },
      ],
    };
  }
  if (route.type === 'article') {
    const visible = readVisibleArticle(html, route);
    return {
      '@context': 'https://schema.org',
      '@graph': [
        ...articleNodes({ siteUrl, url, route, visible, meta: articleMeta }),
        website,
        organizationNode({ siteUrl, brand, otherProfiles }),
        breadcrumbNode([home, { name: 'Journal', item: siteUrl + '/journal' }, { name: visible.headline, item: url }]),
      ],
    };
  }
  if (route.path === '/founders') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'AboutPage', '@id': `${url}#page`, name: route.title.split(' | ')[0], url, inLanguage: 'en-IN', isPartOf: { '@id': id.website }, about: { '@id': id.organization } },
        website,
        organizationWithFounders,
        ...people,
        breadcrumbNode([home, { name: route.title.split(' | ')[0], item: url }]),
      ],
    };
  }
  if (!route.type) {
    const pageType = { '/contact': 'ContactPage', '/our-story': 'AboutPage', '/our-approach': 'AboutPage', '/journal': 'CollectionPage', '/ingredients': 'CollectionPage' }[route.path] ?? 'WebPage';
    return {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': pageType, '@id': `${url}#webpage`, url, name: route.title.split(' | ')[0], description: route.description, inLanguage: 'en-IN', isPartOf: { '@id': id.website }, breadcrumb: { '@id': `${url}#breadcrumb` } },
        website,
        organizationNode({ siteUrl, brand, otherProfiles }),
        { ...breadcrumbNode([home, { name: route.title.split(' | ')[0], item: url }]), '@id': `${url}#breadcrumb` },
      ],
    };
  }
  return null;
}

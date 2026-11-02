import { Link } from 'react-router-dom';
import Botanical from '../components/Botanical';
import CollectionGrid from '../components/CollectionGrid';
import Figure from '../components/Figure';
import ResponsiveImage from '../components/ResponsiveImage';
import Reveal from '../components/Reveal';
import InstagramPreview from '../components/InstagramPreview';
import SignupForm from '../components/SignupForm';
import { INSTAGRAM_HANDLE, company, site } from '../config/site';
import FoundersShowcase from '../components/FoundersShowcase';
import Faq from '../components/Faq';
import { instagramPhotos, photos } from '../content/images';
import { ingredients } from '../content/ingredients';
import { articles } from '../content/journal';
import { useCollection } from '../lib/products';
import { useSiteHints } from '../lib/siteHints';

const PILLARS = [
  { title: 'Ancient Wisdom', text: 'Ayurveda is where we start. We respect the tradition and describe it as tradition, never as proof.' },
  { title: 'Modern Thinking', text: 'Careful formulation development, clear ingredient identity and honest quality standards.' },
  { title: 'Better Living', text: 'Products designed for daily use, with plain labels and no exaggerated promises.' },
];

// Only things the company actually does or has said it will do. No ratings, no counts, no badges we have not earned.
const ASSURANCES = [
  { k: 'Origin', v: 'Born in Kashi, built for a new generation' },
  { k: 'Ingredients', v: 'Plant, part and source, published in full' },
  { k: 'Claims', v: 'Tradition and evidence kept apart' },
  { k: 'Labels', v: 'Plain language, read before you buy' },
];

const pad = (n: number) => String(n + 1).padStart(2, '0');

export default function Home() {
  const collection = useCollection();
  const hints = useSiteHints();
  const items = collection.status === 'ready' ? collection.items : [];
  // What the hero buttons and the status line say depends on the shop's real state. The live answer wins; until it arrives the
  // last-known answer from this browser is used, so a returning visitor never sees the wrong wording for a moment.
  // On a very first visit nothing is known yet: 'pending' keeps the space reserved and quiet instead of guessing.
  const shop: { has: boolean; sale: boolean } | undefined =
    collection.status === 'ready'
      ? { has: items.length > 0, sale: items.some((p) => p.purchasable) }
      : collection.status === 'error'
        ? hints.shop ?? { has: false, sale: false }
        : hints.shop;
  const hasCollection = shop?.has === true;
  const anyForSale = shop?.sale === true;
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      {/* 1. Hero: oversized type against an arched botanical plate */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="hero-eyebrow" data-hero="1"><span className="deva" lang="hi">काशी</span><span className="rule" aria-hidden="true" />Varanasi, India</p>
            <h1 id="hero-title" className="hero-brandname" data-hero="2">Kaayra Herbals</h1>
            <p className="hero-tagline">
              <span className="hero-line" data-hero="2">Ancient <em>Wisdom.</em></span>
              <span className="hero-line" data-hero="3">Modern Thinking.</span>
              <span className="hero-line" data-hero="4">Better Living.</span>
            </p>
            <p className="lede" data-hero="5">
              Kaayra Herbals is a new Ayurvedic wellness company in Varanasi. We publish how we work, plant by plant, before we ask anyone to trust us.
            </p>
            <div className="hero-actions" data-hero="5" data-state={shop ? 'ready' : 'pending'} aria-busy={shop ? undefined : true}>
              {shop === undefined ? (
                <>
                  {/* Same size as the real button, invisible, so the page does not move when the answer arrives. */}
                  <span className="btn btn--gold hero-action-ghost" aria-hidden="true">Shop the collection</span>
                  <Link className="link-arrow" to="/our-approach">Our approach</Link>
                </>
              ) : hasCollection ? (
                <>
                  <Link className="btn btn--gold hero-action-in" to="/collection">Shop the collection</Link>
                  <Link className="link-arrow" to="/our-approach">Our approach</Link>
                </>
              ) : (
                <>
                  <a className="btn btn--gold hero-action-in" href="#notify">Join the launch list</a>
                  <Link className="link-arrow" to="/our-approach">Our approach</Link>
                </>
              )}
            </div>
            {shop === undefined ? (
              <p className="status-note status-note--ghost" aria-hidden="true">Our products are in development. Nothing is for sale yet, and nothing has been approved or tested.</p>
            ) : (
              !anyForSale && (
                <p className="status-note status-note--in" data-hero="5">Our products are in development. Nothing is for sale yet, and nothing has been approved or tested.</p>
              )
            )}
          </div>
          <div className="hero-plate" data-hero="3">
            <Figure photo={photos.hero} priority fallback={<Botanical variant="b" draw />} caption={photos.hero ? undefined : 'Illustration, not a product image.'} />
            <p className="hero-stamp" aria-hidden="true"><span lang="hi">काशी</span> · Est. {company.incorporatedOn.slice(0, 4)}</p>
          </div>
        </div>
      </section>

      <section className="assure" aria-label="What we stand for">
        <ul className="wrap assure-list">
          {ASSURANCES.map((a) => (
            <li key={a.k}><span className="assure-k">{a.k}</span><span className="assure-v">{a.v}</span></li>
          ))}
        </ul>
      </section>

      {/* 2. Philosophy */}
      <section className="section philosophy" aria-labelledby="philosophy">
        <div className="wrap philosophy-grid">
          <Reveal className="philosophy-title">
            <p className="eyebrow">Our philosophy</p>
            <h2 id="philosophy">Slow, <em>on purpose.</em></h2>
          </Reveal>
          <Reveal className="philosophy-body">
            <p className="lede">
              Herbal wellness is crowded with big promises. We would rather explain what we are making, how we decide, and what we do not yet know.
            </p>
            <p>
              Kaayra is built on Ayurveda as a living tradition. We treat it with respect, which includes being clear about the difference between traditional use and proven effect.
            </p>
            <p><Link className="link-arrow" to="/our-story">Read our story</Link></p>
          </Reveal>
          <Reveal className="pillars">
            {PILLARS.map((p, n) => (
              <div className="pillar" key={p.title}>
                <span className="pillar-n" aria-hidden="true">{pad(n)}</span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* 3. Collection preview, from the real catalogue */}
      <section className="section section--cream collection-preview" aria-labelledby="collection">
        <div className="wrap">
          <Reveal className="section-head section-head--row">
            <div>
              <p className="eyebrow">The collection</p>
              <h2 id="collection">Made in small, <em>named</em> batches.</h2>
            </div>
            <Link className="link-arrow" to="/collection">All products</Link>
          </Reveal>
          <CollectionGrid limit={3} />
        </div>
      </section>

      {/* 4. Ingredient storytelling */}
      <section className="section section--midnight on-dark story-ingredients" aria-labelledby="science">
        <div className="wrap story-grid">
          <Reveal className="story-lead">
            <p className="eyebrow">Ingredient transparency</p>
            <h2 id="science">Name the plant. <em>Name the part.</em></h2>
            <p className="lede">
              We aim to publish ingredient identity in full, show real test reports when they exist, and keep tradition and evidence apart.
            </p>
            <p><Link className="btn btn--gold" to="/quality-and-transparency">Quality and transparency</Link></p>
            <p><Link className="link-arrow" to="/product-development">Where product development stands</Link></p>
          </Reveal>
          <Reveal>
            <ol className="story-list">
              {ingredients.slice(0, 4).map((i, n) => (
                <li key={i.slug}>
                  <Link to={`/ingredients#${i.slug}`}>
                    <span className="story-n" aria-hidden="true">{pad(n)}</span>
                    <span className="story-name">{i.name}</span>
                    <span className="story-bot">{i.botanical.split(' (')[0]}</span>
                    <span className="story-part">{i.part}</span>
                  </Link>
                </li>
              ))}
            </ol>
            <p className="story-note">An educational reference to botanicals in Ayurveda. Listing a plant here does not mean it will be used in any Kaayra product. <Link className="link-arrow" to="/ingredients">Browse all ingredients</Link></p>
          </Reveal>
        </div>
      </section>

      {/* 5. Rooted in Kashi */}
      <section className="section kashi" aria-labelledby="kashi">
        <p className="kashi-mark" aria-hidden="true" lang="hi">काशी</p>
        <div className="wrap kashi-grid">
          <Reveal>
            <p className="eyebrow">Our roots</p>
            <h2 id="kashi">Rooted in <em>Kashi.</em></h2>
          </Reveal>
          <Reveal>
            <p className="lede">Kaayra Herbals began in Varanasi, the city of Kashi, long associated with learning and with Ayurvedic tradition.</p>
            <p>
              On <time dateTime={company.incorporatedOn}>{company.incorporatedDisplay}</time>, {company.displayName} was incorporated in India, marking an important milestone in the company’s development.
            </p>
            <p><Link className="link-arrow" to="/our-story">Our story</Link></p>
          </Reveal>
        </div>
      </section>

      <FoundersShowcase />

      {/* Questions and answers (also published as FAQPage structured data) */}
      <section className="section" aria-labelledby="faq-title">
        <div className="wrap">
          <Reveal className="section-head">
            <p className="eyebrow">Questions</p>
            <h2 id="faq-title">Plain answers to <em>common questions.</em></h2>
          </Reveal>
          <Faq />
        </div>
      </section>

      {/* 6. Journal */}
      <section className="section section--sand journal-preview" aria-labelledby="journal">
        <div className="wrap">
          <Reveal className="section-head section-head--row">
            <div>
              <p className="eyebrow">The journal</p>
              <h2 id="journal">Reading, <em>not selling.</em></h2>
            </div>
            <Link className="link-arrow" to="/journal">All articles</Link>
          </Reveal>
          <Reveal>
            <ol className="journal-list">
              {articles.slice(0, 3).map((a, n) => (
                <li key={a.slug}>
                  <Link to={`/journal/${a.slug}`}>
                    <span className="journal-n" aria-hidden="true">{pad(n)}</span>
                    <span className="journal-main">
                      <span className="journal-title">{a.title}</span>
                      <span className="journal-excerpt">{a.excerpt}</span>
                    </span>
                    <span className="journal-meta"><time dateTime={a.date}>{date(a.date)}</time> · {a.readingMinutes} min read</span>
                  </Link>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      {/* 7. Newsletter */}
      <section id="notify" tabIndex={-1} className="section section--midnight on-dark newsletter" aria-labelledby="notify-title">
        <div className="wrap newsletter-grid">
          <Reveal>
            <p className="eyebrow">The launch list</p>
            <h2 id="notify-title">Hear from us when there is <em>something real</em> to say.</h2>
            <p className="lede">
              Optional, and only about our launch. We do not share your details, and you can ask us to remove them at any time.
            </p>
            <p className="newsletter-social">
              <a className="link-arrow" href={site.instagram} target="_blank" rel="noopener noreferrer">Follow {INSTAGRAM_HANDLE}</a>
            </p>
          </Reveal>
          <Reveal className="newsletter-form"><SignupForm /></Reveal>
        </div>
        <InstagramPreview />
        {instagramPhotos.length > 0 && (
          <div className="wrap insta-grid" aria-label="From Instagram">
            {instagramPhotos.slice(0, 4).map((p) => <ResponsiveImage key={p.src} photo={p} sizes="(min-width: 56rem) 20vw, 45vw" />)}
          </div>
        )}
      </section>
    </>
  );
}

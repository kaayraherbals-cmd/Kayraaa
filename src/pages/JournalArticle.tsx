import { Link, useParams } from 'react-router-dom';
import { articles, getArticle } from '../content/journal';
import { ingredients } from '../content/ingredients';
import NotFound from './NotFound';

const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function JournalArticle() {
  const { slug = '' } = useParams();
  const a = getArticle(slug);
  if (!a) return <NotFound />;
  // Related reading: the article's own list when it has one, otherwise every other article (there are few).
  const related = (a.related?.length ? a.related.map((slug) => articles.find((x) => x.slug === slug)).filter((x): x is NonNullable<typeof x> => Boolean(x)) : articles.filter((x) => x.slug !== a.slug));
  // One string, so the server-rendered page holds the literal text "by Kaayra Herbals" (scripts/seo-check.mjs looks for it).
  const byline = `by ${a.author ? a.author.name : 'Kaayra Herbals'}`;
  const discussed = (a.ingredients ?? []).map((slug) => ingredients.find((i) => i.slug === slug)).filter((i): i is NonNullable<typeof i> => Boolean(i));
  return (
    <article className="article">
      <div className="wrap">
        <p><Link to="/journal">Back to the journal</Link></p>
        <h1>{a.title}</h1>
        <p className="muted">
          <time dateTime={a.date}>{fmt.format(new Date(a.date))}</time>, {a.readingMinutes} minute read, {byline}
          {a.updated && <>. Updated <time dateTime={a.updated}>{fmt.format(new Date(a.updated))}</time></>}
        </p>
        {a.practitionerReviewed && a.review && (
          <p className="muted">
            Reviewed by {a.review.reviewer.name}, {a.review.reviewer.credentials}, on <time dateTime={a.review.reviewedOn}>{fmt.format(new Date(a.review.reviewedOn))}</time>.
          </p>
        )}
        {!a.practitionerReviewed && (
          <p className="muted">This article has not been reviewed by a qualified practitioner. It is general information, not medical advice.</p>
        )}
        <div className="prose mt-25">
          {a.body.map((s, i) => (
            <section key={i}>
              {s.h && <h2>{s.h}</h2>}
              {s.p.map((t, j) => (
                <p key={j}>{t}</p>
              ))}
            </section>
          ))}
        </div>
        {a.author?.bio && (
          <aside className="prose" aria-labelledby="about-author">
            <h2 id="about-author">About the author</h2>
            <p><strong>{a.author.name}</strong>{a.author.role ? `, ${a.author.role}` : ''}. {a.author.bio}</p>
          </aside>
        )}
        {discussed.length > 0 && (
          <section className="prose" aria-labelledby="related-ingredients">
            <h2 id="related-ingredients">Related ingredient{discussed.length > 1 ? 's' : ''}</h2>
            <ul>
              {discussed.map((i) => (
                <li key={i.slug}><Link to={`/ingredients#${i.slug}`}>{i.name}</Link> (<i>{i.botanical}</i>)</li>
              ))}
            </ul>
          </section>
        )}
        {a.sources && a.sources.length > 0 && (
          <section className="prose" aria-labelledby="sources">
            <h2 id="sources">Sources</h2>
            <ul>
              {a.sources.map((src) => (
                <li key={src.url}>
                  <a href={src.url} rel="noopener noreferrer">{src.label}</a>
                </li>
              ))}
            </ul>
            <p className="muted">Sources last checked 22 October 2026. Their wording may change.</p>
          </section>
        )}
        <p className="notice">
          Educational information only. It is not medical advice, and it does not describe any Kaayra product, none of which is
          currently for sale.
        </p>
        <p className="muted">
          Published by <Link to="/">Kaayra Herbals</Link>, a new Ayurvedic wellness company in Varanasi. Read{' '}
          <Link to="/our-story">our story</Link> or browse the <Link to="/ingredients">ingredient library</Link>. See also how we handle{' '}
          <Link to="/quality-and-transparency">quality and transparency</Link> and where{' '}
          <Link to="/product-development">product development</Link> stands.
        </p>
        <nav className="prose" aria-labelledby="keep-reading">
          <h2 id="keep-reading">Keep reading</h2>
          <ul>
            {related.map((x) => (
              <li key={x.slug}><Link to={`/journal/${x.slug}`}>{x.title}</Link></li>
            ))}
          </ul>
        </nav>
        <p><Link className="link-arrow" to="/journal">More articles</Link></p>
        <p><Link className="btn" to="/#notify">Join the launch list</Link></p>
      </div>
    </article>
  );
}

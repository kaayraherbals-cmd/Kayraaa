import { Link, useParams } from 'react-router-dom';
import { articles, getArticle } from '../content/journal';
import NotFound from './NotFound';

const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function JournalArticle() {
  const { slug = '' } = useParams();
  const a = getArticle(slug);
  if (!a) return <NotFound />;
  return (
    <article className="article">
      <div className="wrap">
        <p><Link to="/journal">Back to the journal</Link></p>
        <h1>{a.title}</h1>
        <p className="muted">
          <time dateTime={a.date}>{fmt.format(new Date(a.date))}</time>, {a.readingMinutes} minute read, by Kaayra Herbals
        </p>
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
          <Link to="/our-story">our story</Link> or browse the <Link to="/ingredients">ingredient library</Link>.
        </p>
        <nav className="prose" aria-labelledby="keep-reading">
          <h2 id="keep-reading">Keep reading</h2>
          <ul>
            {articles.filter((x) => x.slug !== a.slug).map((x) => (
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

import { Link } from 'react-router-dom';
import { articles } from '../content/journal';

const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function Journal() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <h1>Reading, not selling.</h1>
          <p className="lede mt-15">
            Educational writing on Ayurveda, ingredients and responsible product development. General information only, not
            medical advice.
          </p>
        </div>
        <div className="journal-grid">
          {articles.map((a) => (
            <article className="post" key={a.slug}>
              <time dateTime={a.date}>{fmt.format(new Date(a.date))}, {a.readingMinutes} minute read</time>
              <h2 className="fs-17"><Link to={`/journal/${a.slug}`}>{a.title}</Link></h2>
              <p>{a.excerpt}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ingredients } from '../content/ingredients';
import { articles } from '../content/journal';

export default function Ingredients() {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ingredients;
    return ingredients.filter((i) =>
      [i.name, i.commonName, i.botanical, i.family, i.part, ...(i.synonyms ?? []), ...(i.sanskrit ?? [])].some((f) => f.toLowerCase().includes(needle)),
    );
  }, [q]);

  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <h1>Ingredient library.</h1>
          <p className="lede mt-15">
            A plain reference to botanicals used in Ayurveda: which plant, which part, and how to tell it from look-alikes. It
            describes identity only, with no health claims.
          </p>
        </div>
        <p className="notice">
          Listing a plant here does not mean it will be used in any Kaayra product. Entries are educational and are being reviewed. See <Link to="/quality-and-transparency">quality and transparency</Link> for how identity is confirmed and <Link to="/collection">the collection</Link> for products.
        </p>
        <section className="prose" aria-labelledby="how-to-read">
          <h2 id="how-to-read">How to read an entry</h2>
          <p>
            <strong>Traditional use</strong> describes how a plant has been used inside a system such as Ayurveda. <strong>Clinical evidence</strong> comes
            from studies of a specific preparation, dose and group of people. They answer different questions, and neither is a promise that a product
            is safe or will work for you. Where an entry has no safety or evidence note, that note has not been written yet. See{' '}
            <Link to="/journal/traditional-use-and-clinical-evidence">how to read a herbal claim</Link>. Kaayra does not give doses or medical advice.
          </p>
        </section>
        <div className="field ingredient-search">
          <label htmlFor="ing-q">Search by name, botanical name or plant part</label>
          <input id="ing-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          <p className="field-hint" role="status" aria-live="polite">
            {results.length === 0 ? 'No ingredients match. Try a shorter name or a plant part such as root or fruit.' : `${results.length} of ${ingredients.length} ingredients`}
          </p>
        </div>
        <ul className="ingredient-list">
          {results.map((i) => (
            <li key={i.slug} id={i.slug} tabIndex={-1} className="ingredient-entry">
              <h2>{i.name}</h2>
              <p className="ingredient-bot-line">
                <i>{i.botanical}</i>
              </p>
              <dl className="ingredient-facts">
                <div><dt>Common name</dt><dd>{i.commonName}</dd></div>
                <div><dt>Family</dt><dd>{i.family}</dd></div>
                <div><dt>Plant part</dt><dd>{i.part}</dd></div>
              </dl>
              {(i.synonyms?.length || i.sanskrit?.length) ? (
                <dl className="ingredient-facts">
                  {i.sanskrit?.length ? <div><dt>Sanskrit and classical names</dt><dd>{i.sanskrit.join(', ')}</dd></div> : null}
                  {i.synonyms?.length ? <div><dt>Other botanical names</dt><dd><i>{i.synonyms.join(', ')}</i></dd></div> : null}
                </dl>
              ) : null}
              <p>{i.note}</p>
              {i.identification && (<><h3>How to identify it</h3><p>{i.identification}</p></>)}
              {i.traditionalContext && (<><h3>Traditional use</h3><p>{i.traditionalContext}</p></>)}
              {i.evidence && (<><h3>What studies say</h3><p>{i.evidence}</p></>)}
              {i.safety ? (<><h3>Safety considerations</h3><p>{i.safety}</p></>) : (
                <p className="muted">Safety and evidence notes for this plant have not been written yet. Ask a qualified practitioner or doctor before using any herbal product.</p>
              )}
              {i.references?.length ? (
                <>
                  <h3>References</h3>
                  <ul>{i.references.map((r) => <li key={r.url}><a href={r.url} rel="noopener noreferrer">{r.label}</a></li>)}</ul>
                </>
              ) : null}
              {i.articles?.length ? (
                <>
                  <h3>Related reading</h3>
                  <ul>
                    {i.articles.map((slug) => articles.find((a) => a.slug === slug)).filter((a): a is NonNullable<typeof a> => Boolean(a)).map((a) => (
                      <li key={a.slug}><Link to={`/journal/${a.slug}`}>{a.title}</Link></li>
                    ))}
                  </ul>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

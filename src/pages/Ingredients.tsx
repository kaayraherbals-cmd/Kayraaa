import { useMemo, useState } from 'react';
import { ingredients } from '../content/ingredients';

export default function Ingredients() {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ingredients;
    return ingredients.filter((i) =>
      [i.name, i.commonName, i.botanical, i.family, i.part].some((f) => f.toLowerCase().includes(needle)),
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
          Listing a plant here does not mean it will be used in any Kaayra product. Entries are educational and are being reviewed.
        </p>
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
              <p>{i.note}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

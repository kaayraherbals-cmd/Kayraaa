import faq from '../../shared/faq.json';

/** Visible questions and answers. The same file feeds the FAQPage structured data (scripts/prerender.mjs), so they cannot drift apart. */
export default function Faq() {
  return (
    <div className="faq">
      {faq.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}
    </div>
  );
}

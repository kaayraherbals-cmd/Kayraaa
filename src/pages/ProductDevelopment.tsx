import { Link } from 'react-router-dom';
import Ledger from '../components/Ledger';
import Reveal from '../components/Reveal';
import { company } from '../config/site';
import { ingredients } from '../content/ingredients';
import { articles } from '../content/journal';

// Every figure below is read from the site's own data, so this page cannot drift from the library or the journal.
const reviewedCount = articles.filter((a) => a.practitionerReviewed).length;

const gates: [string, string][] = [
  ['Which plant, and which part?', 'Before a plant is considered, we need its botanical name and the part used. Common names are not enough.'],
  ['What does tradition say, and what does evidence say?', 'We write these down separately. A long history of use is real, but it is not the same as a demonstrated effect.'],
  ['In what form, and why?', 'A powder, a decoction and a syrup behave differently, so the form is a decision, not a convenience.'],
  ['Who should not use it?', 'Interactions, pregnancy, existing medication and other cautions have to be reviewed before a description is written.'],
  ['What are we allowed to say?', 'Labelling and claims must follow the law for that product category in India.'],
];

export default function ProductDevelopment() {
  return (
    <>
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h1>Product development status.</h1>
            <p className="lede mt-15">
              Kaayra is developing its first formulations. None is for sale, none has been approved, and none has been tested.
              This page records what has been done, what is under way and what has not started.
            </p>
          </div>
          <p className="notice">
            Formulations appear in the <Link to="/collection">collection</Link> only after they have been reviewed and approved
            for public preview. We make no claim about what any formulation does. Ingredients, dosage, packaging, pricing and
            availability are published only after they are confirmed, tested and legally cleared.
          </p>
        </div>
      </section>

      <section className="section section--sand" aria-labelledby="pd-done">
        <div className="wrap split">
          <Reveal>
            <h2 id="pd-done">Done so far.</h2>
            <p>Only work that already exists and can be checked on this website.</p>
          </Reveal>
          <Reveal>
            <ul className="checklist">
              <li>
                {company.displayName} was incorporated on <time dateTime={company.incorporatedOn}>{company.incorporatedDisplay}</time>.
                Incorporation registers a company. It is not a licence to make or sell anything.
              </li>
              <li>
                An <Link to="/ingredients">ingredient library</Link> of {ingredients.length} botanicals, each with its botanical name,
                family and plant part. Listing a plant there does not mean it will be used in a Kaayra formulation.
              </li>
              <li>
                {articles.length} <Link to="/journal">journal articles</Link>, with sources for statements about evidence and safety.{' '}
                {reviewedCount === 0
                  ? 'None has yet been reviewed by a qualified practitioner, and each says so.'
                  : `${reviewedCount} have been reviewed by a qualified practitioner, and each names the reviewer.`}
              </li>
              <li>
                A published set of rules for what we will and will not say, on <Link to="/quality-and-transparency">quality and transparency</Link>.
              </li>
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="section" aria-labelledby="pd-stages">
        <div className="wrap split">
          <Reveal>
            <h2 id="pd-stages">In progress, and what comes next.</h2>
            <p>
              Each stage must be finished before the next begins. Formulation development is the stage under way. The rest has not
              started, and there is no launch date.
            </p>
          </Reveal>
          <Reveal>
            <Ledger />
            <p className="mt-2"><Link className="btn" to="/#notify">Join the launch list</Link></p>
          </Reveal>
        </div>
      </section>

      <section className="section section--sand" aria-labelledby="pd-gates">
        <div className="wrap split">
          <Reveal>
            <h2 id="pd-gates">Questions a formulation must answer.</h2>
            <p>
              These are the questions we ask before a formulation moves on. They describe how we intend to decide, not decisions already
              made. The wider method is on <Link to="/our-approach">how we work</Link>.
            </p>
          </Reveal>
          <Reveal>
            <ul className="checklist">
              {gates.map(([q, a]) => (
                <li key={q}><strong>{q}</strong> {a}</li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="section" aria-labelledby="pd-unknown">
        <div className="wrap split">
          <Reveal>
            <h2 id="pd-unknown">What is not decided or not known.</h2>
          </Reveal>
          <Reveal>
            <ul className="checklist">
              <li>Which formulations will reach launch, and in what form.</li>
              <li>Suppliers, origin and test results. None exists yet, so none is shown.</li>
              <li>Dosage, packaging, pricing and any launch date.</li>
            </ul>
            <h3 className="mt-2">Read more</h3>
            <ul className="checklist">
              <li><Link to="/journal/from-classical-text-to-formulation">From classical text to formulation</Link></li>
              <li><Link to="/journal/how-botanical-ingredients-are-identified">How botanical ingredients are identified</Link></li>
              <li><Link to="/ingredients#ashwagandha">Ashwagandha in the ingredient library</Link>, an entry with its sources</li>
            </ul>
          </Reveal>
        </div>
      </section>
    </>
  );
}

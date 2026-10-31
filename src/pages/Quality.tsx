import { Link } from 'react-router-dom';
import Reveal from '../components/Reveal';
import { articles } from '../content/journal';

const reviewedCount = articles.filter((a) => a.practitionerReviewed).length;

// Only sources that were opened and read for the ashwagandha entry and the journal article (see src/content/ingredients.ts).
const references: { label: string; url: string }[] = [
  { label: 'National Center for Complementary and Integrative Health (NIH): Ashwagandha', url: 'https://nccih.nih.gov/health/ashwagandha' },
  { label: 'NIH Office of Dietary Supplements: Ashwagandha, is it helpful for stress, anxiety, or sleep?', url: 'https://ods.od.nih.gov/factsheets/Ashwagandha-Consumer/' },
];

export default function Quality() {
  return (
    <>
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h1>Quality and transparency.</h1>
            <p className="lede mt-15">
              How we intend to earn trust, what we can show today, and what this website does not yet show.
            </p>
          </div>
          <Reveal className="grid-2">
            {[
              ['Botanical names and plant parts', 'Every ingredient named precisely, so there is no doubt which plant is meant.'],
              ['Origin, where verifiable', 'Sourcing information only when we can substantiate it.'],
              ['Test results in full', 'If we publish quality or safety testing, we publish the real report, not a summary.'],
              ['Plain limits', 'We will say what traditional use suggests and what the evidence does or does not show.'],
            ].map(([t, d]) => (
              <div className="principle" key={t}>
                <h2 className="fs-16">{t}</h2>
                <p>{d}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="section section--sand" aria-labelledby="q-today">
        <div className="wrap split">
          <Reveal>
            <h2 id="q-today">What exists today, and what does not.</h2>
          </Reveal>
          <Reveal>
            <p className="lede">
              This website displays no certifications, laboratory results, approvals or customer reviews. Our products are in
              development.
            </p>
            <h3>What you can check now</h3>
            <ul className="checklist">
              <li>The company&rsquo;s registration details, on <Link to="/our-story">our story</Link>.</li>
              <li>Botanical names, families and plant parts for each plant in the <Link to="/ingredients">ingredient library</Link>.</li>
              <li>The sources behind statements about evidence and safety, listed at the end of each <Link to="/journal">journal article</Link> and below.</li>
            </ul>
            <h3>What does not exist yet</h3>
            <ul className="checklist">
              <li>Laboratory or safety test reports, for any raw material or formulation.</li>
              <li>Named suppliers or documented origin.</li>
              <li>Licences, certifications or regulatory approvals for any product.</li>
              <li>Review of our written material by a qualified practitioner: {reviewedCount === 0 ? 'none of the journal articles has had one, and each says so' : `${reviewedCount} of ${articles.length} journal articles have, and each names the reviewer`}.</li>
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="section" aria-labelledby="q-identity">
        <div className="wrap split">
          <Reveal>
            <h2 id="q-identity">How ingredients are identified.</h2>
          </Reveal>
          <Reveal>
            <p>
              A common name can refer to more than one plant, and different parts of one plant are different materials. So we name each
              ingredient by its botanical name and the part used, and we plan to confirm identity before any raw material is accepted. The
              identity entries in the ingredient library are educational and are still to be confirmed by a qualified botanist or
              practitioner.
            </p>
            <p>
              The checks that help confirm which plant is in a product are explained in{' '}
              <Link to="/journal/how-botanical-ingredients-are-identified">How botanical ingredients are identified</Link>.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="section section--sand" aria-labelledby="q-evidence">
        <div className="wrap split">
          <Reveal>
            <h2 id="q-evidence">Traditional use, evidence and safety.</h2>
          </Reveal>
          <Reveal>
            <p>
              We describe traditional use as traditional use. We describe a clinical finding only by saying who found it, how strong it
              is and where it stops. Where research is small, mixed or about a different preparation, we say so. The worked example is
              ashwagandha, in <Link to="/journal/traditional-use-and-clinical-evidence">Traditional use and clinical evidence</Link>.
            </p>
            <ul className="checklist">
              <li>Safety is uncertain wherever it has not been studied. We will say &ldquo;not known&rdquo; rather than imply safety.</li>
              <li>Some herbs interact with medicines or are unsuitable in pregnancy. Warnings will appear wherever a product is described.</li>
              <li>We make no claim to cure, treat or prevent any condition. Nothing here is medical advice; see the <Link to="/medical-disclaimer">medical disclaimer</Link>.</li>
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="section" aria-labelledby="q-launch">
        <div className="wrap split">
          <Reveal>
            <h2 id="q-launch">What we may publish when products launch.</h2>
            <p>These are intentions, not commitments, and none exists yet.</p>
          </Reveal>
          <Reveal>
            <ul className="checklist">
              <li>The full ingredient list, by botanical name and plant part.</li>
              <li>Real test reports, in full, with the product and batch they apply to.</li>
              <li>Origin and supplier information we can document.</li>
              <li>Warnings and the licences or approvals that actually apply.</li>
            </ul>
            <p>
              Progress is recorded on the <Link to="/product-development">product development status</Link> page. Questions about
              anything here can go through <Link to="/contact">contact</Link>.
            </p>
            <p className="mt-2"><Link className="btn" to="/#notify">Join the launch list</Link></p>
          </Reveal>
        </div>
      </section>

      <section className="section section--sand" aria-labelledby="q-refs">
        <div className="wrap split">
          <Reveal>
            <h2 id="q-refs">Sources.</h2>
            <p>Pages we opened and read, used for the ashwagandha example.</p>
          </Reveal>
          <Reveal>
            <ul className="checklist">
              {references.map((r) => (
                <li key={r.url}><a href={r.url} rel="noopener noreferrer" target="_blank">{r.label}</a></li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>
    </>
  );
}

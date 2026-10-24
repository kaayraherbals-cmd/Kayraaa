import { Link } from 'react-router-dom';
import Botanical from '../components/Botanical';
import Figure from '../components/Figure';
import Reveal from '../components/Reveal';
import { founders } from '../content/founders';
import { company } from '../config/site';
import { photos } from '../content/images';

export default function Story() {
  return (
    <>
      <section className="page-hero">
        <div className="wrap page-hero-grid">
          <div>
            <p className="eyebrow">
              <span className="eyebrow-rule" aria-hidden="true" />
              Rooted in Kashi. Created for a New Generation.
            </p>
            <h1>Rooted in Kashi.</h1>
            <p className="lede">
              Kaayra Herbals is a new Ayurvedic wellness company. This page tells you only what is true today.
            </p>
          </div>
          <Figure photo={photos.story} fallback={<Botanical variant="a" />} caption={photos.story ? undefined : 'Illustration, not a product image.'} />
        </div>
      </section>

      <section className="section section--sand">
        <div className="wrap prose">
          <Reveal>
            <h2>From an idea in Kashi to {company.displayName}.</h2>
            <p>
              Kaayra Herbals began in Varanasi, also known as Kashi, a city long associated with learning and with Ayurvedic
              tradition. The aim is to make Ayurveda more relevant to a new generation.
            </p>
            <p>
              On <time dateTime={company.incorporatedOn}>{company.incorporatedDisplay}</time>, {company.displayName} was
              incorporated in India. Incorporation registers the company. It is not a licence to manufacture or sell any product, and we do not present it as one.
            </p>
            <h2>Company details</h2>
            <p>
              The company behind this website is {company.displayName}, a {company.type.toLowerCase()} registered in {company.registeredLocation}.
              Its Corporate Identity Number is {company.cin}. You can read how we work on <Link to="/our-approach">our approach</Link> page,
              what we will and will not claim on <Link to="/quality-and-transparency">quality and transparency</Link>, and how to
              reach us on the <Link to="/contact">contact</Link> page.
            </p>
            <h2>Where we are</h2>
            <p>
              We are at an early stage. Our first formulations are in development, and we have not launched, approved or
              tested anything for sale. We built this website before the products so that you can see how
              we work before anything is offered.
            </p>
            <h2>Our mission</h2>
            <p>To build Ayurvedic wellness products that are developed carefully, explained plainly and made with respect for the tradition they come from.</p>
            <h2>Our vision</h2>
            <p>A new generation of Indian wellness that people trust because it shows its work.</p>
          </Reveal>
        </div>
      </section>

      {founders.length > 0 && (
        <section className="section" aria-labelledby="team">
          <div className="wrap prose">
            <h2 id="team">The founders</h2>
            <p>
              Kaayra Herbals was founded by {founders[0].name}, {founders[0].role.replace('&', 'and')}
              {founders.length > 1 && <>, with co-founders {founders.slice(1).map((f) => f.name).join(', ').replace(/, ([^,]*)$/, ' and $1')}</>}.{' '}
              <Link to="/founders">Meet the founders</Link>.
            </p>
          </div>
        </section>
      )}

      <section className="section">
        <div className="wrap prose">
          <h2>What we are not doing</h2>
          <p>
            We are not selling products, offering consultations or giving personalised recommendations. If you need advice about
            your health, please speak to a qualified practitioner or doctor.
          </p>
          <p>
            To see which plants we write about, browse the <Link to="/ingredients">ingredient library</Link>, or read the{' '}
            <Link to="/journal">journal</Link>. <Link to="/">Back to the Kaayra Herbals homepage</Link>.
          </p>
          <p><Link className="btn" to="/#notify">Join the launch list</Link></p>
        </div>
      </section>
    </>
  );
}

import { Link } from 'react-router-dom';
import FounderCards from '../components/FounderCards';
import Reveal from '../components/Reveal';
import { founders } from '../content/founders';

export default function Founders() {
  return (
    <>
      <section className="page-hero">
        <div className="wrap">
          <p className="eyebrow">
            <span className="eyebrow-rule" aria-hidden="true" />
            The people behind Kaayra
          </p>
          <h1>Meet the founders.</h1>
          <p className="lede">
            A founder and two co-founders, one company: Kaayra Herbals, a new Ayurvedic wellness company in Varanasi, built carefully before it sells anything.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="founders-intro">
        <div className="wrap prose">
          <h2 id="founders-intro">Who founded Kaayra Herbals?</h2>
          <p>
            Kaayra Herbals was founded by {founders.map((f) => `${f.name} (${f.role})`).join(', ')}. The company is based in Varanasi, India, and its first
            formulations are still in development.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="founders-list">
        <div className="wrap">
          <Reveal className="section-head">
            <h2 id="founders-list">The founding team.</h2>
          </Reveal>
          <Reveal>
            <FounderCards />
          </Reveal>
        </div>
      </section>

      <section className="section" aria-labelledby="founders-mission">
        <div className="wrap prose">
          <h2 id="founders-mission">What are the founders trying to build?</h2>
          <p>
            A new Indian Ayurvedic wellness company that builds carefully before it sells anything: one that says plainly what a plant is, which part is used,
            and what is and is not known about it.
          </p>
          <h2>How does Kaayra approach product development?</h2>
          <p>
            Ingredient identity comes first, then real test reports, and every limit is stated plainly. Kaayra does not claim any approval, licence or
            certification, and it makes no health claims about products that are still in development. The details are on{' '}
            <Link to="/our-approach">how we work</Link>, <Link to="/quality-and-transparency">quality and transparency</Link> and the{' '}
            <Link to="/product-development">development status</Link> page.
          </p>
        </div>
      </section>

      <section className="section section--sand">
        <div className="wrap prose">
          <h2>About these profiles</h2>
          <p>
            Education is shown as each founder supplied it. LinkedIn links appear for the founders who have a profile. Professional experience is added only when
            a founder supplies and confirms it; none is claimed here until then.
          </p>
          <p>
            Qualifications are listed as each founder supplied them. “Pursuing” means the course is still in progress. Kaayra does not
            currently sell products or offer consultations, and nothing here is medical advice.
          </p>
          <p>
            Read <Link to="/our-story">our story</Link> and <Link to="/our-approach">how we work</Link>, or{' '}
            <Link to="/#notify">join the launch list</Link>.
          </p>
        </div>
      </section>
    </>
  );
}

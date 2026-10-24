import { Link } from 'react-router-dom';
import FounderCards from '../components/FounderCards';
import Reveal from '../components/Reveal';

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

      <section className="section section--sand">
        <div className="wrap prose">
          <h2>About these profiles</h2>
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

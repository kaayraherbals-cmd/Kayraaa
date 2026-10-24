import { Link } from 'react-router-dom';
import Reveal from '../components/Reveal';

export default function Quality() {
  return (
    <>
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h1>Quality and transparency.</h1>
            <p className="lede mt-15">
              How we intend to earn trust, and what this website does not yet show.
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

      <section className="section section--sand">
        <div className="wrap split">
          <Reveal>
            <h2>What is not here yet.</h2>
          </Reveal>
          <Reveal>
            <p className="lede">
              This website displays no certifications, laboratory results, approvals or customer reviews. Our products are in
              development.
            </p>
            <p>
              When any of these exist, we will publish them in full, with the documents behind them, and say which product and
              batch they apply to.
            </p>
            <ul className="checklist">
              <li>We make no claim to cure, treat or prevent any condition.</li>
              <li>Traditional use is described as traditional use.</li>
              <li>Safety information and warnings will appear wherever a product is described.</li>
            </ul>
            <p className="mt-2"><Link className="btn" to="/#notify">Join the launch list</Link></p>
          </Reveal>
        </div>
      </section>
    </>
  );
}

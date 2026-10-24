import { Link } from 'react-router-dom';
import Ledger from '../components/Ledger';
import Reveal from '../components/Reveal';

export default function ProductDevelopment() {
  return (
    <>
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <h1>Development status.</h1>
            <p className="lede mt-15">
              Kaayra is developing its first formulations. None is for sale, none has been approved, and none has been tested.
              Each stage below must be finished before the next begins.
            </p>
          </div>
          <p className="notice">
            Formulations appear in <Link to="/collection">Products</Link> only after they have been reviewed and approved
            for public preview. We make no claim about what any formulation does. Ingredients, dosage, packaging, pricing and
            availability are published only after they are confirmed, tested and legally cleared.
          </p>
        </div>
      </section>

      <section className="section section--sand">
        <div className="wrap split">
          <Reveal>
            <h2>What still has to happen.</h2>
            <p>An honest view of where we are, updated as work actually happens.</p>
          </Reveal>
          <Reveal>
            <Ledger />
            <p className="mt-2"><Link className="btn" to="/#notify">Join the launch list</Link></p>
          </Reveal>
        </div>
      </section>
    </>
  );
}

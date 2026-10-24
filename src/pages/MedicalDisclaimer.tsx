import { Link } from 'react-router-dom';

export default function MedicalDisclaimer() {
  return (
    <section className="section">
      <div className="wrap prose">
        <h1>Medical disclaimer.</h1>
        <p className="lede">Kaayra Herbals shares information about Ayurveda, botanicals and product development. It is not medical advice.</p>
        <h2>Information only</h2>
        <p>
          Nothing on this website diagnoses, treats, cures or prevents any condition, and nothing here replaces advice from a
          qualified healthcare professional. Traditional use described on this website is traditional use, not evidence of effect.
        </p>
        <h2>Products in development</h2>
        <p>
          Formulations marked as in development on the Products page are previews and are not for sale. We make no
          claim that any formulation is approved, tested or effective. Details are published only once they have been confirmed
          and legally cleared.
        </p>
        <h2>Your health</h2>
        <p>
          Speak to a qualified healthcare professional before using any herbal or Ayurvedic product, especially if you are pregnant,
          nursing, taking medicines, preparing for surgery or living with a health condition. Do not delay or stop medical care
          because of something you read here. In an emergency, contact your local emergency services.
        </p>
        <h2>Ingredient information</h2>
        <p>
          The ingredient library is an educational reference. A plant appearing there does not mean it is used in any Kaayra
          product, and ingredient identity, quality and safety depend on the specific plant, plant part, source and preparation.
        </p>
        <p>
          See also our <Link to="/legal">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </div>
    </section>
  );
}

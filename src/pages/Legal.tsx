import { Link } from 'react-router-dom';
import BusinessDetails from '../components/BusinessDetails';

export default function Legal() {
  return (
    <section className="section">
      <div className="wrap">
        <h1 className="h1-fluid">Terms and Disclaimer</h1>
        <div className="prose mt-2">
          <p className="notice">
            These terms are a starting point and should be reviewed by a qualified legal professional before launch.
          </p>
          <h2>Product status</h2>
          <p>
            Kaayra Herbals does not currently sell any product. Product names and descriptions on this website are concepts under
            development. Nothing here is an offer for sale.
          </p>
          <BusinessDetails />
          <h2>Not medical advice</h2>
          <p>
            Content on this website is educational and general. It is not medical advice and is not intended to diagnose, treat,
            cure or prevent any condition. Speak to a qualified practitioner or doctor about your own health, especially if you are
            pregnant, take medication or have a medical condition.
          </p>
          <h2>No consultations</h2>
          <p>Kaayra does not currently offer consultations or personalised recommendations.</p>
          <h2>Accuracy</h2>
          <p>We try to keep this website accurate, but it describes a business at an early stage and may change without notice.</p>
          <h2>Intellectual property</h2>
          <p>The text, design and branding on this website belong to Kaayra Herbals unless stated otherwise. Please ask before reusing them.</p>
          <h2>Privacy</h2>
          <p>See our <Link to="/privacy">Privacy Policy</Link>.</p>
        </div>
      </div>
    </section>
  );
}

import ContactForm from '../components/ContactForm';
import EmailLink from '../components/EmailLink';
import { hasContactRoute, site } from '../config/site';

export default function Contact() {
  return (
    <section className="section">
      <div className="wrap split">
        <div>
          <h1>Contact</h1>
          {hasContactRoute && (
            <dl className="defs">
              {site.email && (
                <div>
                  <dt>Email</dt>
                  <dd><EmailLink email={site.email} /></dd>
                </div>
              )}
              {site.phone && (
                <div>
                  <dt>Phone</dt>
                  <dd><a href={`tel:${site.phone.replace(/\s+/g, '')}`}>{site.phone}</a></dd>
                </div>
              )}
              {site.address && (
                <div>
                  <dt>Address</dt>
                  <dd>{site.address}</dd>
                </div>
              )}
              {site.legalEntity && (
                <div>
                  <dt>Registered name</dt>
                  <dd>{site.legalEntity}</dd>
                </div>
              )}
            </dl>
          )}
          <p className="notice">
            For business enquiries and questions about Kaayra. We cannot give medical advice, diagnose conditions or recommend
            treatment, so please do not send health information.
          </p>
        </div>
        <div>
          <ContactForm />
        </div>
      </div>
    </section>
  );
}

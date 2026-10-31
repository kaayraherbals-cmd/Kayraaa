import { Link } from 'react-router-dom';
import { CONSENT_VERSION } from '../../shared/subscribe';
import EmailLink from '../components/EmailLink';
import { site } from '../config/site';

export default function Privacy() {
  const who = site.legalEntity || site.name;
  return (
    <section className="section">
      <div className="wrap">
        <h1 className="h1-fluid">Privacy Policy</h1>
        <p className="muted">Consent text version {CONSENT_VERSION}</p>
        <div className="prose mt-2">
          <p className="notice">
            This policy describes how this website works today. It should be reviewed by a qualified legal professional familiar
            with Indian data-protection law before launch.
          </p>
          <h2>Who we are</h2>
          <p>{who} operates this website.{site.email ? <> Contact us at <EmailLink email={site.email} />.</> : <> Contact details will be published on the <Link to="/contact">Contact page</Link>.</>}</p>
          <h2>What we collect</h2>
          <p>
            Only what you give us through our forms. The launch-list form collects your email address, and your name if you choose
            to add it, along with a record that you gave consent, when you did, and which version of the consent wording you saw.
            The contact form collects your name, email address and the message you write. If you report a problem, we keep what you write, the page you were on and your browser type, plus your email address only if you choose to give it. If you create an account, we keep your name and verified email address, either from the sign-in provider you choose (such as Google) or from what you enter. If you set a password, it is stored only as a secure hash by our authentication provider (Supabase); we cannot read it. We never see your Google password.
          </p>
          <h2>Why we use it</h2>
          <p>Launch-list details are used to tell you about Kaayra’s launch. Contact messages are used to reply to you. Problem reports are used to find and fix the problem, and to reply if you left an email. We will not use either for anything else without asking you first, and we do not sell them.</p>
          <h2>Who handles it</h2>
          <p>
            The website is hosted on Vercel, and launch-list details are stored in a Supabase database. These providers process
            data on our behalf. Their own policies apply to their systems. Messages and launch-list details are visible only to authorised Kaayra administrators.
          </p>
          <h2>How long we keep it</h2>
          <p>Launch-list details: until you ask us to remove them or the launch list is closed. If you unsubscribe, we keep your address marked as unsubscribed so that we never email you again, until you ask us to delete it. We also keep a record of when consent was given and withdrawn; it is stored without your email address. Contact messages: only as long as needed to deal with your enquiry. Account details: until you delete your account from the account page or ask us to.</p>
          <h2>Bag reminder emails</h2>
          <p>
            If you have a customer account you can choose, on your account page, to receive up to three reminder emails about items you left in your bag. This is off unless you switch it on, and entering your email at sign-up or checkout does not switch it on. The reminder uses your saved bag and your account email, and the link in it works only when you are signed in. Switch it off in your account or with the unsubscribe link in any reminder. We then keep only a one-way fingerprint of your address on a do-not-email list so that we do not write to you again. Reminder records are deleted after about six months.
          </p>
          <h2>Your choices</h2>
          <p>
            You can ask us to access, correct or delete your details, or withdraw your consent, at any time{site.email ? <> by emailing <EmailLink email={site.email} /></> : <> using the contact details on our Contact page once published</>}.
          </p>
          <h2>Cookies and analytics</h2>
          <p>This website does not set advertising or analytics cookies. If that changes, we will update this page and ask for consent where needed. The homepage can show our latest Instagram posts, but only if you tap “Show latest posts”. Until then nothing is requested from Instagram. Once you tap, Instagram loads the posts and may set its own cookies under its own policy.</p>
          <h2>Children</h2>
          <p>This website is not intended for children, and the launch list is for adults.</p>
        </div>
      </div>
    </section>
  );
}

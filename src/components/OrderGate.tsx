import { Link } from 'react-router-dom';
import OAuthPanel from './OAuthPanel';
import { firstName, useSession } from '../lib/session';

/**
 * Where "Add to bag" will go once commerce is approved. Ordering requires a signed-in account (shared/commerce.ts), so the
 * gate is built first. It sells nothing, shows no price and has no cart: COMMERCE_ENABLED is still false.
 */
export default function OrderGate({ productName }: { productName: string }) {
  const { user } = useSession();
  return (
    <aside className="order-gate" aria-label="Ordering">
      <h2>Ordering</h2>
      <p>
        {productName} is not for sale yet. When ordering opens, you will need a Kaayra account to place an order, so sign in now and be ready.
      </p>
      {user === undefined ? null : user ? (
        <p className="form-status form-status--ok" role="status">
          Signed in as {firstName(user)}. Join the launch list and we will tell you first.
          {' '}
          <Link to="/#notify">Join the launch list</Link>
        </p>
      ) : (
        <>
          <OAuthPanel intent="member" />
          <p className="auth-switch">
            Prefer email? <Link to="/signup">Create an account</Link> or <Link to="/login">sign in</Link>.
          </p>
        </>
      )}
    </aside>
  );
}

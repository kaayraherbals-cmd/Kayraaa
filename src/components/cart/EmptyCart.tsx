import { Link } from 'react-router-dom';

export default function EmptyCart({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="cart-empty">
      <h2 className="cart-empty-title">Your bag is empty</h2>
      <p>Whatever you choose will wait here for you. Browse the collection to find a formulation.</p>
      <Link className="btn" to="/collection" onClick={onNavigate}>Shop the collection</Link>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatRupees } from '../../shared/cart';
import type { PublicProduct } from '../../shared/products';
import { productThemeClass } from '../content/themes';
import { useCart } from '../lib/cart';
import { summarise, useVariants } from '../lib/variants';
import ProductVisual from './ProductVisual';

/**
 * A shop card: large image, category (dosage form), name, pack size, price, availability and one clear action.
 * Price and availability come from the server. Without them (bag closed, or still loading) the card shows the product's status instead.
 */
export default function ProductCard({ product, feature = false }: { product: PublicProduct; feature?: boolean }) {
  const { enabled, add, busy, openDrawer } = useCart();
  const v = useVariants(product.slug, enabled && product.purchasable);
  const [added, setAdded] = useState(false);
  const [failed, setFailed] = useState(false);
  const second = product.images?.[1];
  const sizes = product.packSizes?.length ? product.packSizes : [product.packSize];
  const href = `/collection/${product.slug}`;
  const sum = v.status === 'ready' ? summarise(v.options) : null;

  let availability: { tone: 'ok' | 'off' | 'neutral'; text: string };
  if (!product.purchasable) availability = { tone: 'neutral', text: `${product.statusLabel}. Not for sale` };
  else if (v.status === 'ready') availability = sum?.anyAvailable ? { tone: 'ok', text: 'In stock' } : { tone: 'off', text: 'Currently unavailable' };
  else availability = { tone: 'neutral', text: product.statusLabel };

  async function quickAdd() {
    if (!sum?.only || busy) return;
    setFailed(false);
    const ok = await add(sum.only.variantId, 1);
    setAdded(ok);
    setFailed(!ok);
    if (ok) openDrawer();
  }

  return (
    <article className={`pcard ${feature ? 'pcard--feature' : ''} ${productThemeClass(product.slug)}`.trim()}>
      <Link to={href} className="pcard-media" tabIndex={-1} aria-hidden="true">
        <ProductVisual product={product} />
        {second && <img className="pcard-alt" src={second.src} alt="" width={800} height={1000} loading="lazy" decoding="async" />}
      </Link>
      <div className="pcard-body">
        <p className="pcard-kicker">{product.form}</p>
        <h3><Link to={href}>{product.name}</Link></h3>
        <p className="pcard-pack">{sizes.join(' · ')}</p>
        {product.description && <p className="pcard-excerpt">{product.description}</p>}
        <div className="pcard-row">
          <p className="pcard-price">
            {sum?.fromPaise != null ? <>{sum.priceVaries && <span className="pcard-from">From </span>}{formatRupees(sum.fromPaise)}</> : <span className="pcard-noprice">{product.purchasable && v.status !== 'loading' ? 'Price on the product page' : '\u00a0'}</span>}
          </p>
          <p className="pcard-avail" data-tone={availability.tone}><span className="dot" aria-hidden="true" />{availability.text}</p>
        </div>
        {product.purchasable && sum?.anyAvailable ? (
          sum.only ? (
            <button type="button" className="btn btn--block" disabled={busy} onClick={() => void quickAdd()} aria-label={`Add ${product.name}, ${sum.only.packSize}, to bag`}>
              {busy ? 'Adding…' : 'Add to bag'}
            </button>
          ) : (
            <Link className="btn btn--block" to={href} aria-label={`Choose a pack size for ${product.name}`}>Choose size</Link>
          )
        ) : (
          <>
            <Link className="btn btn--ghost btn--block" to={href}>{product.purchasable ? 'View and shop' : 'View preview'}<span className="sr-only"> for {product.name}</span></Link>
            {!product.purchasable && <Link className="pcard-notify" to="/#notify">Notify me</Link>}
          </>
        )}
        <p className="sr-only" role="status" aria-live="polite">{added ? `${product.name} added to your bag.` : ''}</p>
        {failed && <p className="pcard-err" role="alert">We could not add that. Please try again.</p>}
      </div>
    </article>
  );
}

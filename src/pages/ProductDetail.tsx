import OrderGate from '../components/OrderGate';
import AddToBag from '../components/cart/AddToBag';
import WishlistButton from '../components/WishlistButton';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PublicProduct } from '../../shared/products';
import ProductCard from '../components/ProductCard';
import ProductGallery from '../components/ProductGallery';
import PinChecker from '../components/cart/PinChecker';
import ProductReviews from '../components/reviews/ProductReviews';
import Reveal from '../components/Reveal';
import { articles } from '../content/journal';
import { productThemeClass } from '../content/themes';
import { usePageMeta } from '../lib/meta';
import { loadProduct, useCollection } from '../lib/products';
import { useCart } from '../lib/cart';

type State = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ready'; product: PublicProduct };

const FAQS = (name: string, forSale: boolean) => [
  { q: `Is ${name} available to buy?`, a: forSale ? 'Use the pack size options above. A pack size shows as out of stock when we have none in date to send.' : 'No. It is a formulation in development and is not for sale. We will say so plainly on this page if that changes.' },
  { q: 'When will it launch?', a: 'There is no launch date. A product launches only after sourcing, quality, safety, labelling and regulatory requirements are complete.' },
  { q: 'Where is the ingredient list?', a: 'Ingredient lists are published only once the manufacturer-approved composition has been verified for public release.' },
  { q: 'Can I use this information to make health decisions?', a: 'No. This page is information about a product in development, not medical advice. Speak to a qualified healthcare professional about your health.' },
];

export default function ProductDetail() {
  const { slug = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    void loadProduct(slug).then((p) => {
      if (!live) return;
      setState(p === 'error' ? { status: 'error' } : p ? { status: 'ready', product: p } : { status: 'missing' });
    });
    return () => {
      live = false;
    };
  }, [slug]);

  const product = state.status === 'ready' ? state.product : null;
  usePageMeta({
    title: product ? `${product.name} | Products` : 'Products | Kaayra Herbals',
    description: product ? product.purchasable ? `${product.name}: ${product.form}, ${product.packSize}.` : `${product.name}: ${product.form}, ${product.packSize}. In development and not for sale.` : 'Formulations in development at Kaayra Herbals.',
    path: `/collection/${slug}`,
    noindex: !product,
  });

  if (state.status === 'loading') {
    return (
      <section className="section">
        <div className="wrap pdp-grid" aria-busy="true" role="status" aria-label="Loading product">
          <div className="pvisual skel-block" />
          <div className="pdp-info">
            <span className="skel skel--line skel--short" />
            <span className="skel skel--line" />
            <span className="skel skel--line" />
          </div>
        </div>
      </section>
    );
  }

  if (!product) {
    return (
      <section className="section">
        <div className="wrap prose">
          <h1>{state.status === 'error' ? 'Temporarily unavailable.' : 'This product is not available.'}</h1>
          <p>
            {state.status === 'error'
              ? 'We could not load this product right now. Please try again in a moment.'
              : 'It may not have been published yet. Products appear in the collection only once they have been approved for preview.'}
          </p>
          <p><Link className="btn" to="/collection">Back to the collection</Link></p>
        </div>
      </section>
    );
  }

  return <ProductView product={product} />;
}

/** The approved product page. */
export function ProductView({ product }: { product: PublicProduct }) {
  const { enabled } = useCart();
  const collection = useCollection();
  const related = collection.status === 'ready' ? collection.items.filter((p) => p.slug !== product.slug).slice(0, 3) : [];
  const sizes = product.packSizes?.length ? product.packSizes : [product.packSize];
  const forSale = product.purchasable;
  return (
    <div className={productThemeClass(product.slug) || undefined}>
      <section className="pdp">
        <div className="wrap">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to="/collection">Shop</Link> <span aria-hidden="true">/</span> <span aria-current="page">{product.name}</span>
          </nav>
          <div className="pdp-grid">
            <div className="pdp-media"><ProductGallery product={product} /></div>
            <div className="pdp-info">
              <p className="pdp-kicker">{product.form}{!forSale && <span className="badge">{product.statusLabel}</span>}</p>
              <h1>{product.name}</h1>
              <p className="pdp-pack">{sizes.join(' · ')}</p>
              <p className="lede pdp-lede">{product.description}</p>

              {forSale ? (
                <>
                  <AddToBag slug={product.slug} productName={product.name} />
                  <WishlistButton slug={product.slug} productName={product.name} />
                  {enabled && <PinChecker />}
                </>
              ) : (
                <div className="pdp-soon">
                  <p className="status-note">{product.statusLabel}. Not for sale. Nothing here is medical advice.</p>
                  <p><Link className="btn" to="/#notify">Join the launch list</Link></p>
                </div>
              )}

              <div className="pdp-details">
                <details className="expand" open={Boolean(product.ingredients && product.ingredients.length <= 12)}>
                  <summary>Ingredients</summary>
                  {product.ingredients ? (
                    <>
                      <p className="muted">Composition as approved for public release ({product.ingredients.length} listed).</p>
                      <ul className="ing-list">{product.ingredients.map((i) => <li key={i}>{i}</li>)}</ul>
                      {product.subCompositions && Object.entries(product.subCompositions).map(([group, parts]) => (
                        <div key={group}>
                          <h3>{group} composition</h3>
                          <ul className="ing-list">{parts.map((i) => <li key={i}>{i}</li>)}</ul>
                        </div>
                      ))}
                      {product.preservatives && (
                        <div>
                          <h3>{product.preservativeLabel}</h3>
                          <ul className="ing-list">{product.preservatives.map((i) => <li key={i}>{i}</li>)}</ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <p>The approved composition will be published once it has been verified for public release. We do not list ingredients before then.</p>
                  )}
                  <p><Link className="link-arrow" to="/ingredients">Browse the ingredient library</Link></p>
                </details>
                <details className="expand">
                  <summary>Directions for use</summary>
                  <p>Use as directed on the pack label. Usage and dosage will be provided on approved labelling. If a pack carries no directions, ask a qualified healthcare professional before using it.</p>
                </details>
                <details className="expand">
                  <summary>Warnings and safety</summary>
                  <p>
                    {forSale ? 'Read the label on the pack for usage, warnings and safety information.' : 'This product is in development and is not for sale. Complete usage, warnings and safety information will appear on approved labelling.'} If you are pregnant, nursing, taking medicines or living with a health condition, speak to a qualified healthcare professional before using any herbal product. Keep out of reach of children.
                  </p>
                  <p><Link className="link-arrow" to="/medical-disclaimer">Medical disclaimer</Link></p>
                </details>
                <details className="expand">
                  <summary>Shipping and delivery</summary>
                  <p>We deliver to the PIN codes we serve. Enter your PIN code above to see whether we deliver to you, the delivery charge, and any free-delivery threshold. The final delivery charge is shown at checkout before you pay.</p>
                  <p>Each order is dispatched with a tracking number once it ships. You can follow it under <Link to="/track-order">Orders and tracking</Link>.</p>
                </details>
                <details className="expand">
                  <summary>Product information</summary>
                  <dl className="pfacts">
                    <div><dt>Dosage form</dt><dd>{product.form}</dd></div>
                    <div><dt>Net quantity</dt><dd>{sizes.join(', ')}</dd></div>
                    <div><dt>Manufacturer and licence details</dt><dd>Will be shown when confirmed.</dd></div>
                  </dl>
                </details>
                <details className="expand">
                  <summary>Quality and transparency</summary>
                  <p>We claim no certification, test result or approval for this formulation. We will publish real documents when they exist. <Link className="link-arrow" to="/quality-and-transparency">How we approach quality</Link></p>
                </details>
              </div>
            </div>
          </div>
        </div>
      </section>

      {!forSale && (
        <section className="section section--sand">
          <div className="wrap"><OrderGate productName={product.name} /></div>
        </section>
      )}

      {related.length > 0 && (
        <section className="section section--cream" aria-labelledby="related-h">
          <div className="wrap">
            <Reveal className="section-head section-head--row">
              <div><p className="eyebrow">Continue exploring</p><h2 id="related-h">You may also like.</h2></div>
              <Link className="link-arrow" to="/collection">All products</Link>
            </Reveal>
            <div className="pgrid pgrid--shop">{related.map((p) => <ProductCard key={p.slug} product={p} />)}</div>
          </div>
        </section>
      )}

      {forSale && <ProductReviews slug={product.slug} />}

      <section className="section" aria-labelledby="faq-h">
        <div className="wrap faq-grid">
          <Reveal><p className="eyebrow">Questions</p><h2 id="faq-h">Good to know.</h2></Reveal>
          <Reveal className="faq">
            {FAQS(product.name, forSale).map((f) => (
              <details className="expand" key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
            <ul className="related">
              {articles.slice(0, 2).map((a) => (
                <li key={a.slug}><Link to={`/journal/${a.slug}`}>{a.title}</Link></li>
              ))}
              <li><Link to="/our-approach">Our approach to development</Link></li>
            </ul>
          </Reveal>
        </div>
      </section>
    </div>
  );
}

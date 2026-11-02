import { useId, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Reveal from '../components/Reveal';
import ProductCard from '../components/ProductCard';
import { PreLaunch, ProductSkeletons } from '../components/CollectionGrid';
import { useCart } from '../lib/cart';
import { useCollection } from '../lib/products';
import { summarise, useCatalogueVariants } from '../lib/variants';

type Sort = 'featured' | 'name' | 'price';

/** The shop: search, filter by dosage form and availability, sort. Filters live in the URL so a search from the header, or a shared link, lands on the same view. */
export default function Collection() {
  const uid = useId();
  const state = useCollection();
  const { enabled } = useCart();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const form = params.get('form') ?? '';
  const sort = (['name', 'price'].includes(params.get('sort') ?? '') ? params.get('sort') : 'featured') as Sort;
  const inStock = params.get('stock') === '1';

  const items = useMemo(() => (state.status === 'ready' ? state.items : []), [state]);
  const catalogue = useCatalogueVariants(items.map((p) => p.slug), enabled);
  const hasPrices = enabled && items.some((p) => p.purchasable);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const forms = useMemo(() => Array.from(new Set(items.map((p) => p.form))).sort(), [items]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = items.filter((p) => (!form || p.form === form) && (!term || `${p.name} ${p.form} ${p.description}`.toLowerCase().includes(term)));
    if (inStock) out = out.filter((p) => p.purchasable && summarise(catalogue.get(p.slug) ?? []).anyAvailable);
    if (sort === 'name') out = [...out].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'price') {
      const price = (s: string) => summarise(catalogue.get(s) ?? []).fromPaise ?? Number.MAX_SAFE_INTEGER;
      out = [...out].sort((a, b) => price(a.slug) - price(b.slug));
    }
    return out;
  }, [items, q, form, inStock, sort, catalogue]);

  const filtered = Boolean(q || form || inStock);

  return (
    <>
      <section className="shop-hero">
        <div className="wrap">
          <p className="eyebrow">The Kaayra collection</p>
          <h1>Formulated in <em>Kashi.</em></h1>
          <p className="lede">
            {hasPrices
              ? 'Each formulation appears here once it has been approved. Choose a pack size, check delivery to your PIN code, and add it to your bag.'
              : 'Formulations in development at Kaayra Herbals. Each appears here only once it has been approved for preview.'}
          </p>
        </div>
      </section>

      <section className="section shop-body" aria-label="Products">
        <div className="wrap">
          {state.status === 'loading' && <ProductSkeletons count={3} />}
          {state.status === 'error' && <p className="notice" role="status">Products are temporarily unavailable. Please try again in a moment.</p>}
          {state.status === 'ready' && items.length === 0 && <PreLaunch />}
          {state.status === 'ready' && items.length > 0 && (
            <>
              <form className="shop-tools" role="search" aria-label="Search and filter products" onSubmit={(e) => e.preventDefault()}>
                <div className="field shop-search">
                  <label htmlFor={`${uid}-q`}>Search</label>
                  <input id={`${uid}-q`} type="search" value={q} placeholder="Name or form" onChange={(e) => set({ q: e.target.value })} autoComplete="off" />
                </div>
                {forms.length > 1 && (
                  <div className="shop-chips" role="group" aria-label="Filter by form">
                    {['', ...forms].map((f) => (
                      <button key={f || 'all'} type="button" className="pchip" aria-pressed={form === f} onClick={() => set({ form: f || null })}>{f || 'All'}</button>
                    ))}
                  </div>
                )}
                <div className="shop-opts">
                  {hasPrices && (
                    <label className="shop-check">
                      <input type="checkbox" checked={inStock} onChange={(e) => set({ stock: e.target.checked ? '1' : null })} />
                      <span>In stock only</span>
                    </label>
                  )}
                  <div className="field shop-sort">
                    <label htmlFor={`${uid}-s`}>Sort</label>
                    <select id={`${uid}-s`} value={sort} onChange={(e) => set({ sort: e.target.value === 'featured' ? null : e.target.value })}>
                      <option value="featured">Featured</option>
                      <option value="name">Name, A to Z</option>
                      {hasPrices && <option value="price">Price, low to high</option>}
                    </select>
                  </div>
                </div>
              </form>
              <p className="shop-count" role="status" aria-live="polite">
                {shown.length} {shown.length === 1 ? 'product' : 'products'}
                {filtered && <> · <button type="button" className="text-btn" onClick={() => setParams({}, { replace: true })}>Clear filters</button></>}
              </p>
              {shown.length === 0 ? (
                <div className="prelaunch" role="status">
                  <h3>Nothing matches that.</h3>
                  <p>Try a different word, or clear the filters to see the whole collection.</p>
                  <p><button type="button" className="btn" onClick={() => setParams({}, { replace: true })}>Clear filters</button></p>
                </div>
              ) : (
                <div className="pgrid pgrid--shop">
                  {shown.map((p) => <ProductCard key={p.slug} product={p} />)}
                </div>
              )}
            </>
          )}
          <p className="notice">
            Nothing on this website is medical advice, and we make no claim about what any formulation does. Details are published only once they have been confirmed, approved and legally cleared.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="coll-about">
        <div className="wrap split">
          <Reveal>
            <h2 id="coll-about">What this collection is.</h2>
            <p>
              The collection is the one place where Kaayra Herbals will show a formulation to the public. At the moment it holds none, because
              no formulation has been approved for preview. This page is written so that you can understand what will appear here, and on
              what terms, before anything does.
            </p>
          </Reveal>
          <Reveal>
            <h3>What a preview will contain</h3>
            <p>
              A name, the form it takes and a plain description. The ingredient list follows only after the composition has been verified
              for release, and each ingredient is named by its botanical name and plant part. We have not announced which kinds of product
              we are developing, so we describe none here.
            </p>
            <h3>What it will not contain</h3>
            <ul className="checklist">
              <li>Claims that a formulation cures, treats or prevents any condition.</li>
              <li>Test results, certificates or approvals that do not yet exist.</li>
              <li>Customer reviews of products that have not been sold.</li>
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="section section--sand" aria-labelledby="coll-ingredients">
        <div className="wrap split">
          <Reveal>
            <h2 id="coll-ingredients">How ingredients are chosen.</h2>
          </Reveal>
          <Reveal>
            <p>
              Ingredient choice starts with identity: which plant, which part of it, and how that can be confirmed. The{' '}
              <Link to="/ingredients">ingredient library</Link> is our public reference for this. A plant listed there is not necessarily
              in any Kaayra formulation; the library is educational and describes identity only.
            </p>
            <p>
              Traditional use and clinical evidence are different things, and we keep them apart. The journal explains the difference with a
              worked example in{' '}
              <Link to="/journal/traditional-use-and-clinical-evidence">Traditional use and clinical evidence</Link>, and shows how a plant is
              told apart from look-alikes in{' '}
              <Link to="/journal/how-botanical-ingredients-are-identified">How botanical ingredients are identified</Link>.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="section" aria-labelledby="coll-read">
        <div className="wrap split">
          <Reveal>
            <h2 id="coll-read">While you wait.</h2>
            <p>These pages explain where we are and how we will decide what to show.</p>
          </Reveal>
          <Reveal>
            <ul className="checklist">
              <li><Link to="/product-development">Product development status</Link>: what is done, what is under way and what has not started.</li>
              <li><Link to="/quality-and-transparency">Quality and transparency</Link>: what we can and cannot show about quality today.</li>
              <li><Link to="/journal/from-classical-text-to-formulation">From classical text to formulation</Link>: how a traditional preparation becomes a product.</li>
              <li><Link to="/#notify">Join the launch list</Link> to hear when a formulation is first approved for preview.</li>
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="coll-cta section--midnight on-dark" aria-labelledby="coll-cta-h">
        <div className="wrap coll-cta-inner">
          <h2 id="coll-cta-h">Be the first to know.</h2>
          <p className="lede">Join the launch list and we will tell you when a formulation is approved and ready.</p>
          <Link className="btn btn--gold" to="/#notify">Join the launch list</Link>
        </div>
      </section>

      <section className="section section--sand">
        <div className="wrap split">
          <Reveal><h2>How a formulation reaches this page.</h2></Reveal>
          <Reveal>
            <p className="lede">
              Every product moves through internal development and review before anything about it is made public. Ingredient lists are published only after the composition has been verified for release.
            </p>
            <p><Link className="link-arrow" to="/product-development">See where development stands</Link></p>
            <p><Link className="link-arrow" to="/quality-and-transparency">Quality and transparency</Link></p>
          </Reveal>
        </div>
      </section>
    </>
  );
}

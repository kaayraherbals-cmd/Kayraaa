import { Link } from 'react-router-dom';
import { useCollection } from '../lib/products';
import ProductCard from './ProductCard';

export function ProductSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="pgrid" aria-busy="true" role="status" aria-label="Loading products">
      {Array.from({ length: count }, (_, i) => (
        <div className="pcard pcard--skeleton" key={i} aria-hidden="true">
          <div className="pvisual skel-block" />
          <div className="pcard-body"><span className="skel skel--line skel--short" /><span className="skel skel--line" /></div>
        </div>
      ))}
    </div>
  );
}

export function PreLaunch() {
  return (
    <div className="prelaunch" role="status">
      <h3>The first formulations are still taking shape.</h3>
      <p>
        We will show each one here once its details have been confirmed and approved for public preview. We would rather be late than careless.
      </p>
      <p><Link className="btn" to="/#notify">Join the launch list</Link></p>
    </div>
  );
}

/** A short run of approved products for the home page. The full, filterable shop is the Collection page. */
export default function CollectionGrid({ limit = 3 }: { limit?: number }) {
  const state = useCollection();
  if (state.status === 'loading') return <ProductSkeletons count={limit} />;
  if (state.status === 'error') return <p className="notice" role="status">Products are temporarily unavailable. Please try again in a moment.</p>;
  if (state.items.length === 0) return <PreLaunch />;
  return (
    <div className="pgrid pgrid--editorial">
      {state.items.slice(0, limit).map((p, i) => (
        <ProductCard key={p.slug} product={p} feature={i === 0} />
      ))}
    </div>
  );
}

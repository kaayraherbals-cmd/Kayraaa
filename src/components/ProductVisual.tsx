import type { PublicProduct } from '../../shared/products';
import { CONCEPT_PATH } from '../content/concept-renders';

export const ConceptTag = ({ src }: { src?: string }) => (src?.startsWith(CONCEPT_PATH) ? <span className="concept-tag">Concept render</span> : null);

/** Approved product image, or a quiet line illustration of the container when none has been approved yet. */
export default function ProductVisual({ product, priority = false }: { product: Pick<PublicProduct, 'image' | 'form' | 'name'>; priority?: boolean }) {
  if (product.image) {
    return (
      <div className="pvisual">
        <img src={product.image.src} alt={product.image.alt} width={800} height={1000} loading={priority ? 'eager' : 'lazy'} decoding="async" />
        <ConceptTag src={product.image.src} />
      </div>
    );
  }
  const capsule = /capsule/i.test(product.form);
  return (
    <div className="pvisual pvisual--placeholder" role="img" aria-label={`Illustration of a ${capsule ? 'capsule container' : 'syrup bottle'}. Product image to follow.`}>
      <svg viewBox="52 20 96 224" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {capsule ? (
          <>
            <rect x="62" y="40" width="76" height="26" rx="6" strokeWidth="1.6" />
            <path d="M66 66h68v22c0 6 8 10 8 20v100a12 12 0 0 1-12 12H70a12 12 0 0 1-12-12V108c0-10 8-14 8-20V66z" strokeWidth="1.6" />
            <rect x="72" y="128" width="56" height="54" rx="3" strokeWidth="1" className="pvisual-accent" />
            <path d="M82 148h36M82 160h24" strokeWidth="1" className="pvisual-accent" />
          </>
        ) : (
          <>
            <rect x="82" y="26" width="36" height="22" rx="4" strokeWidth="1.6" />
            <path d="M88 48v22c0 8-26 14-26 34v100a14 14 0 0 0 14 14h48a14 14 0 0 0 14-14V104c0-20-26-26-26-34V48" strokeWidth="1.6" />
            <rect x="74" y="122" width="52" height="58" rx="3" strokeWidth="1" className="pvisual-accent" />
            <path d="M84 142h32M84 154h22" strokeWidth="1" className="pvisual-accent" />
          </>
        )}
      </svg>
      <span className="pvisual-note">Image to follow</span>
    </div>
  );
}

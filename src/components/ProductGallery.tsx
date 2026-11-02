import { useState } from 'react';
import type { PublicProduct } from '../../shared/products';
import ProductVisual, { ConceptTag } from './ProductVisual';

/** Large photo with a thumbnail strip. Falls back to the quiet illustration when no photo has been approved. */
export default function ProductGallery({ product }: { product: PublicProduct }) {
  const images = product.images?.length ? product.images : product.image ? [product.image] : [];
  const [i, setI] = useState(0);
  if (images.length === 0) return <ProductVisual product={product} priority />;
  const at = Math.min(i, images.length - 1);
  const current = images[at];
  return (
    <div className="gallery-view" role="group" aria-roledescription="gallery" aria-label={`${product.name} photos`}>
      <div className="pvisual pvisual--main">
        <img key={current.src} src={current.src} alt={current.alt} width={800} height={1000} loading="eager" decoding="async" className="gallery-main" />
        <ConceptTag src={current.src} />
        {images.length > 1 && <p className="gallery-count" aria-hidden="true">{at + 1} / {images.length}</p>}
      </div>
      {images.length > 1 && (
        <ul className="gallery-thumbs" aria-label="Choose a photo">
          {images.map((im, k) => (
            <li key={im.src}>
              <button type="button" aria-label={`Show photo ${k + 1} of ${images.length}: ${im.alt}`} aria-pressed={k === at} onClick={() => setI(k)}>
                <img src={im.src} alt="" width={96} height={120} loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

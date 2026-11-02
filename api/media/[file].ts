import type { VercelRequest, VercelResponse } from '@vercel/node';
import { MEDIA_FILE_RE } from '../../shared/products.js';
import { clientIp, createLimiter } from '../../server/http.js';
import { mimeFor, readImage } from '../../server/media.js';
import { rest, supabaseConfig } from '../../server/supabase.js';

/**
 * Public product photos. A file is served only while a product that is publicly approved (the public_products view)
 * points at it, so drafts and unapproved photos are never reachable by guessing a link.
 */
const limited = createLimiter(60 * 1000, 240);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  if (limited(clientIp(req))) return res.status(429).end();
  const file = typeof req.query.file === 'string' ? req.query.file : '';
  const db = supabaseConfig();
  if (!db || !MEDIA_FILE_RE.test(file)) return res.status(404).end();
  try {
    // Served only while a publicly approved product points at the file: as its primary photo or in its gallery.
    const path = encodeURIComponent(`/api/media/${file}`);
    const ref = await rest(db, `public_products?select=slug&public_image=eq.${path}&limit=1`);
    if (!ref.ok) return res.status(404).end();
    let allowed = ((await ref.json()) as unknown[]).length > 0;
    if (!allowed) {
      const g = await rest(db, `public_product_images?select=slug&path=eq.${path}&limit=1`).catch(() => null);
      allowed = Boolean(g?.ok) && ((await g!.json()) as unknown[]).length > 0;
    }
    if (!allowed) return res.status(404).end();
    const bytes = await readImage(db, file);
    if (!bytes) return res.status(404).end();
    res.setHeader('Content-Type', mimeFor(file));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(bytes);
  } catch (e) {
    console.error('media error', e instanceof Error ? e.message : e);
    return res.status(502).end();
  }
}

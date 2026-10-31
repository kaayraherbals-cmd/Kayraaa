import type { VercelRequest, VercelResponse } from '@vercel/node';
import { toPublic } from '../shared/products.js';
import { clientIp, createLimiter } from '../server/http.js';
import { getPublic, listPublic, listPublicExtras } from '../server/products.js';
import { supabaseConfig } from '../server/supabase.js';
import { handleTranslate } from '../server/translate.js';

/**
 * Public, read-only product previews. Reads the public_products database view only, so unapproved products and
 * unverified formulations never reach this function, and maps rows through an explicit whitelist (toPublic).
 * With no database configured, or no approved products, the answer is an empty list and the site shows its pre-launch state.
 */
const limited = createLimiter(60 * 1000, 120);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('X-Robots-Tag', 'noindex');
  // Website translation shares this function (Vercel Hobby allows 12 functions in total, see SESSION_RULES.md).
  if (req.query.action === 'translate') return handleTranslate(req, res);
  if (req.method !== 'GET') return res.status(405).json({ status: 'error', message: 'Method not allowed.' });
  if (limited(clientIp(req))) return res.status(429).json({ status: 'error', message: 'Too many requests.' });

  const db = supabaseConfig();
  const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
  if (slug && (!SLUG_RE.test(slug) || slug.length > 90)) return res.status(404).json({ status: 'error', message: 'Not found.' });

  if (!db) {
    res.setHeader('Cache-Control', 'no-store');
    return slug ? res.status(404).json({ status: 'error', message: 'Not found.' }) : res.status(200).json({ status: 'ok', items: [] });
  }

  try {
    if (slug) {
      const row = await getPublic(db, slug);
      res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
      if (!row) return res.status(404).json({ status: 'error', message: 'Not found.' });
      const extras = await listPublicExtras(db, slug);
      return res.status(200).json({ status: 'ok', item: toPublic(row, { images: extras.images, packSizes: extras.packSizes[slug] }) });
    }
    const [rows, extras] = await Promise.all([listPublic(db), listPublicExtras(db)]);
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
    return res.status(200).json({ status: 'ok', items: rows.map((r) => toPublic(r, { images: extras.images, packSizes: extras.packSizes[r.slug] })) });
  } catch (e) {
    console.error('products api error', e instanceof Error ? e.message : e);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ status: 'error', message: 'Products are temporarily unavailable.', items: [] });
  }
}

import { randomUUID } from 'node:crypto';
import { MEDIA_FILE_RE, sniffImage } from '../shared/products.js';
import type { SupabaseConfig } from './supabase.js';

/** Product photos live in a PRIVATE Supabase Storage bucket and are served only through /api/media (public) or the admin API. */
export const BUCKET = 'product-images';

const MIME: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };
export const mimeFor = (file: string): string => MIME[file.split('.').pop() ?? ''] ?? 'application/octet-stream';

const headers = (db: SupabaseConfig, extra: Record<string, string> = {}) => ({ apikey: db.serviceKey, Authorization: `Bearer ${db.serviceKey}`, ...extra });

/** Validates by content, then stores under a random name. Returns the public path to save on the product. */
export async function storeImage(db: SupabaseConfig, bytes: Buffer): Promise<{ file: string; path: string } | { error: string }> {
  const kind = sniffImage(bytes);
  if (!kind) return { error: 'Use a JPEG, PNG or WebP image.' };
  const file = `${randomUUID()}.${kind}`;
  const r = await fetch(`${db.url}/storage/v1/object/${BUCKET}/${file}`, {
    method: 'POST',
    headers: headers(db, { 'Content-Type': MIME[kind], 'Cache-Control': 'max-age=3600', 'x-upsert': 'false' }),
    body: new Uint8Array(bytes),
  });
  if (!r.ok) throw new Error(`storage upload ${r.status}`);
  return { file, path: `/api/media/${file}` };
}

export async function readImage(db: SupabaseConfig, file: string): Promise<Buffer | null> {
  if (!MEDIA_FILE_RE.test(file)) return null;
  const r = await fetch(`${db.url}/storage/v1/object/${BUCKET}/${file}`, { headers: headers(db) });
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

/** Best effort: replacing or removing an image should not leave the old file behind. */
export async function deleteImage(db: SupabaseConfig, publicPath: string | null | undefined): Promise<void> {
  const file = publicPath?.startsWith('/api/media/') ? publicPath.slice('/api/media/'.length) : '';
  if (!MEDIA_FILE_RE.test(file)) return;
  try {
    await fetch(`${db.url}/storage/v1/object/${BUCKET}/${file}`, { method: 'DELETE', headers: headers(db) });
  } catch {
    /* ignore */
  }
}

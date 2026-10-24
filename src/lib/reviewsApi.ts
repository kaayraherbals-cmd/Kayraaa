import type { ReportReason } from '../../shared/reviews';

export interface PublicReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
  edited: boolean;
  name: string;
  verified: boolean;
  reply: { body: string; at: string } | null;
  images: string[];
}
export interface ReviewStats {
  count: number;
  average: number | null;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}
export interface OwnReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  status: 'PENDING' | 'PUBLISHED' | 'HIDDEN' | 'REJECTED' | 'WITHDRAWN';
  status_reason: string | null;
  edit_count: number;
  review_images: { id: string; file: string; status: string }[];
}
export type Res<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

async function call<T>(action: string, method: 'GET' | 'POST', query: Record<string, string> = {}, body?: unknown): Promise<Res<T>> {
  try {
    const qs = new URLSearchParams({ ...query }).toString();
    const res = await fetch(`/api/reviews/${action}${qs ? `?${qs}` : ''}`, {
      method,
      headers: method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Kaayra-CSRF': '1' },
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (res.ok && data) return { ok: true, data };
    return { ok: false, status: res.status, message: data?.message ?? 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, status: 0, message: 'You appear to be offline. Please try again.' };
  }
}

export const reviewsApi = {
  list: (product: string, rating: number | null, sort: string, page: number) =>
    call<{ stats: ReviewStats; items: PublicReview[]; page: number; pageSize: number }>('list', 'GET', { product, sort, page: String(page), ...(rating ? { rating: String(rating) } : {}) }),
  mine: (product: string) => call<{ eligible: boolean; review: OwnReview | null }>('mine', 'GET', { product }),
  submit: (product: string, rating: number, title: string, body: string) => call<{ id: string; held: boolean }>('submit', 'POST', {}, { product, rating, title, body }),
  update: (review: string, rating: number, title: string, body: string) => call<{ id: string; held: boolean }>('update', 'POST', {}, { review, rating, title, body }),
  withdraw: (review: string) => call<unknown>('withdraw', 'POST', {}, { review }),
  report: (review: string, reason: ReportReason, note: string) => call<{ message: string }>('report', 'POST', {}, { review, reason, note }),
  uploadImage: (review: string, data: string) => call<{ message: string }>('upload-image', 'POST', {}, { review, data }),
};

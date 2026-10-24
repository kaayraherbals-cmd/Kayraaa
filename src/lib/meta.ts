import { useEffect } from 'react';
import { site } from '../config/site';

/** Sets title, description, canonical and robots for pages that are rendered only in the browser (product pages). */
export function usePageMeta(meta: { title: string; description: string; path: string; noindex?: boolean }) {
  const { title, description, path, noindex } = meta;
  useEffect(() => {
    document.title = title;
    const upsert = (selector: string, make: () => HTMLElement, attr: string, value: string) => {
      let el = document.head.querySelector<HTMLElement>(selector);
      if (!el) {
        el = make();
        document.head.appendChild(el);
      }
      el.setAttribute(attr, value);
    };
    upsert('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' }), 'content', description);
    upsert('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', `${site.url}${path}`);
    upsert('meta[name="robots"]', () => Object.assign(document.createElement('meta'), { name: 'robots' }), 'content', noindex ? 'noindex, nofollow' : 'index, follow');
  }, [title, description, path, noindex]);
}

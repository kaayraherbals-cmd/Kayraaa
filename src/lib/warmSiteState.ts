import { aiEnabled } from './aiApi';
import { loadProducts } from './products';

/**
 * Starts the public requests the first screen needs before React has finished starting, so their answers are usually
 * there by the time the page renders. Both calls are shared and cached (20 s) by the code that asks again later, so
 * nothing is requested twice. Skipped on the admin, checkout and payment pages, which do not use them.
 */
export function warmSiteState(pathname: string): void {
  if (/^\/(admin|checkout|pay)(\/|$)/.test(pathname)) return;
  void aiEnabled();
  if (pathname === '/' || pathname.startsWith('/collection')) void loadProducts();
}

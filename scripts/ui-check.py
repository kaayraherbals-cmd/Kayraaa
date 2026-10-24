"""
Responsive UI check (Playwright + Chromium). Serves the built site (vite preview) and stubs /api/* with fixed data,
because no database exists in CI or in this sandbox. Stub catalogue: slugs, forms and pack sizes from supabase/products.seed.json;
display names, descriptions and prices below are placeholders for layout testing only, not real catalogue copy.
Run:  npm run build  then  python3 scripts/ui-check.py   (it serves dist/ itself, like vercel.json)
Writes screenshots and results.json to test-results/.
"""
import json, os, sys, threading, http.server, functools
from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(__file__), '..', 'dist')

class Prod(http.server.SimpleHTTPRequestHandler):
    """Serves dist/ the way vercel.json does: cleanUrls (/x -> x/index.html), /collection/:slug -> product-shell, /track-order/:id -> track-order."""
    def translate_path(self, path):
        p = path.split('?')[0].rstrip('/') or '/'
        parts = [x for x in p.split('/') if x]
        if len(parts) == 2 and parts[0] == 'collection': p = '/product-shell'
        elif len(parts) == 2 and parts[0] == 'track-order': p = '/track-order'
        full = os.path.join(DIST, p.lstrip('/'))
        if os.path.isdir(full): full = os.path.join(full, 'index.html')
        elif not os.path.exists(full) and os.path.exists(full + '.html'): full += '.html'
        elif not os.path.exists(full): full = os.path.join(DIST, '404.html')
        return full
    def log_message(self, *a): pass

def serve(port=4173):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), Prod)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

BASE = os.environ.get('BASE', 'http://127.0.0.1:4173')
OUT = os.path.join(os.path.dirname(__file__), '..', 'test-results')
os.makedirs(os.path.join(OUT, 'screenshots'), exist_ok=True)
WIDTHS = [360, 390, 768, 1024, 1440]
DESC = 'A Kaayra Herbals formulation in development. Details are published once they have been confirmed and approved.'
PRODUCTS = [
  dict(slug='liver-ds-xzyme-syp', name='Liver DS + Xzyme Syrup', form='Syrup', packSize='200 ml', packSizes=['200 ml'], sale=True),
  dict(slug='iron-syrup', name='Iron Syrup', form='Syrup', packSize='150 ml', packSizes=['150 ml', '300 ml'], sale=True),
  dict(slug='multi-vitamin-syrup', name='Multi-Vitamin Syrup', form='Syrup', packSize='200 ml', packSizes=['200 ml'], sale=False),
  dict(slug='pcos-cap', name='PCOS Capsules', form='Capsules', packSize='30 capsules', packSizes=['30 capsules'], sale=True),
]
def pub(p):
    return dict(slug=p['slug'], name=p['name'], form=p['form'], packSize=p['packSize'], packSizes=p['packSizes'],
        statusLabel='Approved for sale' if p['sale'] else 'In Development', description=DESC, image=None, images=[],
        ingredients=['Tulsi', 'Amla', 'Ginger'] if p['sale'] else None, subCompositions=None, preservatives=None,
        preservativeLabel='Preservatives', purchasable=p['sale'])
def variants(slug):
    p = next(x for x in PRODUCTS if x['slug'] == slug)
    return [dict(variantId=f"{slug}:{i}", packSize=s, productName=p['name'], unitPaise=24950 + i * 20000, available=not (slug == 'pcos-cap'), maxQty=10, message=None if slug != 'pcos-cap' else 'Out of stock') for i, s in enumerate(p['packSizes'])]
ORDERS = [
  dict(id='11111111-1111-4111-8111-111111111111', order_no='KH-2026-000124', status='shipped', created_at='2026-10-12T09:30:00Z', total_paise=54900, is_test=False, ship_address='12 Lanka Road, Near BHU Gate, Varanasi, Uttar Pradesh', ship_pincode='221005', customer_name='Asha Verma', order_refunds=[]),
  dict(id='22222222-2222-4222-8222-222222222222', order_no='KH-2026-000101', status='paid', created_at='2026-09-28T14:05:00Z', total_paise=24950, is_test=False, ship_address='B-4 Sector 21, Noida, Uttar Pradesh', ship_pincode='201301', customer_name='Asha Verma', order_refunds=[dict(status='requested', amount_paise=24950)]),
]
state = dict(lines=[])
def cart_view():
    lines = []
    for vid, q in state['lines']:
        slug, i = vid.split(':'); v = variants(slug)[int(i)]
        lines.append(dict(variantId=vid, productName=v['productName'], packSize=v['packSize'], requestedQty=q, qty=q, maxQty=10, unitPaise=v['unitPaise'], lineTotalPaise=v['unitPaise'] * q, state='ok', reason=None, message=None))
    sub = sum(l['lineTotalPaise'] for l in lines)
    return dict(lines=lines, totals=dict(itemCount=sum(l['qty'] for l in lines), subtotalPaise=sub, gstIncludedPaise=round(sub * 0.12 / 1.12)), checkoutOpen=True, pricesIncludeGst=True)

def install(ctx, signed_in):
    def handler(route):
        req = route.request; url = req.url; path = url.split('/api/', 1)[1].split('?')[0]
        def j(body, status=200): route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
        if path == 'products':
            if 'slug=' in url:
                hit = [x for x in PRODUCTS if x['slug'] == url.split('slug=')[1]]
                return j(dict(status='ok', item=pub(hit[0]))) if hit else j(dict(status='error'), 404)
            return j(dict(status='ok', items=[pub(p) for p in PRODUCTS]))
        if path == 'cart/config': return j(dict(status='ok', cartPreview=True))
        if path == 'cart/variants':
            slug = url.split('slug=')[1]; return j(dict(status='ok', options=variants(slug), maxPerLine=10))
        if path == 'cart/view': return j(cart_view())
        if path == 'cart/set':
            b = json.loads(req.post_data or '{}'); lines = [l for l in state['lines'] if l[0] != b['variantId']]
            if b['qty'] > 0: lines.append((b['variantId'], b['qty']))
            state['lines'] = lines; return j(cart_view())
        if path in ('cart/validate', 'cart/merge'):
            b = json.loads(req.post_data or '{}')
            if b.get('lines'): state['lines'] = [(l['variantId'], l['qty']) for l in b['lines']]
            return j(cart_view())
        if path == 'cart/clear': state['lines'] = []; return j(cart_view())
        if path == 'checkout/config': return j(dict(status='ok', checkoutOpen=True, paymentOpen=False))
        if path == 'checkout/pincode':
            pin = url.split('pin=')[1]
            return j(dict(status='ok', pincode=pin, serviceable=pin.startswith('22'), ratePaise=6000 if pin.startswith('22') else None, freeAbovePaise=150000 if pin.startswith('22') else None))
        if path == 'auth/session':
            return j(dict(status='ok', email='asha@example.com', name='Asha Verma', role='member'), 200) if signed_in else j(dict(status='error'), 401)
        if path == 'auth/status': return j(dict(status='ok', providers=[], signupOpen=True))
        if path == 'orders/list': return j(dict(status='ok', items=ORDERS, total=2, pageSize=10)) if signed_in else j({}, 401)
        if path == 'orders/detail':
            o = dict(ORDERS[0], subtotal_paise=48900, shipping_paise=6000)
            return j(dict(status='ok', order=o, items=[dict(product_name='Iron Syrup', pack_size='150 ml', qty=2, unit_price_paise=24450, line_total_paise=48900)], refunds=[]))
        if path == 'orders/track':
            return j(dict(status='ok', order=dict(order_no='KH-2026-000124', status='shipped'), shipments=[dict(shipmentNo=1, label='Shipped', courier='Delhivery', trackingNo='DL123456789', estimatedDelivery='2026-10-18', events=[dict(at='2026-10-13T08:00:00Z', label='Handed to courier', location='Varanasi', note=None)])]))
        return j(dict(status='ok'))
    ctx.route('**/api/**', handler)

CHECKS = """() => {
  const de = document.documentElement; const vw = de.clientWidth;
  const overflowX = de.scrollWidth > vw + 1;
  const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 2 && getComputedStyle(e).position !== 'fixed' && !e.closest('.gallery-thumbs, .admin-table-wrap, [hidden], .kashi, .hero, .site-footer'); }).slice(0, 5).map(e => e.tagName.toLowerCase() + '.' + (e.className && e.className.baseVal === undefined ? String(e.className).split(' ')[0] : ''));
  const small = [...document.querySelectorAll('a[href], button, input, select, summary')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && (r.height < 30 || r.width < 30) && !e.closest('.sr-only, [hidden]') && !e.classList.contains('skip-link') && e.type !== 'radio' && e.type !== 'checkbox' && !(e.tagName === 'A' && getComputedStyle(e).display === 'inline'); }).slice(0, 5).map(e => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30));
  const noAlt = [...document.querySelectorAll('img:not([alt])')].length;
  const h1 = document.querySelectorAll('h1').length;
  const fs = parseFloat(getComputedStyle(document.body).fontSize);
  return { overflowX, wide, smallTargets: small, imgsWithoutAlt: noAlt, h1Count: h1, bodyFontPx: fs };
}"""

def run():
    results = []
    PAGES = [('home', '/', False), ('collection', '/collection', False), ('product', '/collection/iron-syrup', False), ('product-unavailable', '/collection/pcos-cap', False),
             ('bag', '/bag', False), ('checkout', '/checkout', True), ('account', '/account', True), ('orders', '/track-order', True), ('order-detail', '/track-order/11111111-1111-4111-8111-111111111111', True), ('our-story', '/our-story', False), ('founders', '/founders', False), ('journal', '/journal', False), ('login', '/login', False)]
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w in WIDTHS:
            for name, path, signed in PAGES:
                ctx = b.new_context(viewport=dict(width=w, height=900), device_scale_factor=1, is_mobile=w < 700, has_touch=w < 700)
                state['lines'] = [('iron-syrup:0', 2), ('liver-ds-xzyme-syp:0', 1)] if name in ('bag', 'checkout') else []
                install(ctx, signed)
                pg = ctx.new_page(); errors = []
                pg.on('console', lambda m, errors=errors: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
                pg.on('pageerror', lambda e, errors=errors: errors.append(str(e)))
                pg.goto(BASE + path, wait_until='networkidle'); pg.wait_for_timeout(500)
                pg.evaluate("document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'))"); pg.wait_for_timeout(150)
                pg.evaluate("async () => { document.documentElement.style.scrollBehavior = 'auto'; const h = document.body.scrollHeight; for (let y = 0; y < h; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } window.scrollTo(0, 0); }"); pg.wait_for_timeout(500)
                r = pg.evaluate(CHECKS); r.update(page=name, width=w, consoleErrors=errors[:3])
                results.append(r)
                if name in ('home', 'collection', 'product', 'bag', 'checkout', 'account'):
                    pg.screenshot(path=os.path.join(OUT, 'screenshots', f'fold-{name}-{w}.png'))
                if w in (360, 768, 1440) or name in ('home', 'product', 'checkout'):
                    pg.screenshot(path=os.path.join(OUT, 'screenshots', f'{name}-{w}.png'), full_page=True)
                ctx.close()
        # interaction checks
        inter = []
        for w in (360, 1440):
            ctx = b.new_context(viewport=dict(width=w, height=900), is_mobile=w < 700, has_touch=w < 700); install(ctx, False); state['lines'] = []
            pg = ctx.new_page(); pg.goto(BASE + '/', wait_until='networkidle')
            if w == 360:
                pg.click('.menu-toggle'); pg.wait_for_timeout(400)
                inter.append(dict(w=w, check='mobile menu opens, aria-expanded', ok=pg.get_attribute('.menu-toggle', 'aria-expanded') == 'true' and pg.is_visible('.mobile-menu')))
                pg.screenshot(path=os.path.join(OUT, 'screenshots', 'mobile-menu-360.png'))
                pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
                inter.append(dict(w=w, check='Escape closes menu and refocuses toggle', ok=not pg.is_visible('.mobile-menu') and pg.evaluate("document.activeElement.classList.contains('menu-toggle')")))
            pg.click('button[aria-label="Search products"]'); pg.wait_for_timeout(300); pg.fill('.search-form input', 'iron'); pg.wait_for_timeout(400)
            inter.append(dict(w=w, check='search dialog shows a matching product', ok=pg.locator('.search-results li').count() >= 1 and pg.evaluate("document.activeElement === document.querySelector('.search-form input')")))
            pg.screenshot(path=os.path.join(OUT, 'screenshots', f'search-{w}.png'))
            pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
            inter.append(dict(w=w, check='Escape closes search', ok=pg.locator('.search-panel').count() == 0))
            pg.goto(BASE + '/collection', wait_until='networkidle'); pg.wait_for_timeout(500)
            n0 = pg.locator('.pcard').count(); pg.click('.pchip:has-text("Capsules")'); pg.wait_for_timeout(300)
            inter.append(dict(w=w, check='collection filter by form narrows list', ok=0 < pg.locator('.pcard').count() < n0))
            pg.goto(BASE + '/collection/iron-syrup', wait_until='networkidle'); pg.wait_for_timeout(500)
            pg.fill('.pin input', '221005'); pg.click('.pin button'); pg.wait_for_timeout(500)
            inter.append(dict(w=w, check='PIN check reports delivery + rate', ok='We deliver to 221005' in pg.inner_text('.pin-out')))
            pg.fill('.pin input', '560001'); pg.click('.pin button'); pg.wait_for_timeout(500)
            inter.append(dict(w=w, check='PIN check reports not serviceable', ok='cannot deliver' in pg.inner_text('.pin-out')))
            if w == 360:
                pg.evaluate('window.scrollTo(0, document.body.scrollHeight * 0.45)'); pg.wait_for_timeout(600)
                pg.wait_for_timeout(700)
                inter.append(dict(w=w, check='sticky mobile buy bar visible after scrolling past controls', ok=pg.get_attribute('.buy-bar', 'data-visible') == 'true'))
                pg.screenshot(path=os.path.join(OUT, 'screenshots', 'product-sticky-bar-360.png'))
                pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(500)
                inter.append(dict(w=w, check='sticky bar hidden while main controls visible', ok=pg.get_attribute('.buy-bar', 'data-visible') == 'false'))
            pg.click('.buy-add'); pg.wait_for_timeout(700)
            inter.append(dict(w=w, check='Add to bag opens bag drawer with the item', ok=pg.is_visible('.cart-drawer') and 'Iron Syrup' in pg.inner_text('.cart-drawer')))
            pg.screenshot(path=os.path.join(OUT, 'screenshots', f'bag-drawer-{w}.png'))
            ctx.close()
        # reduced motion: no running animations on the home hero
        ctx = b.new_context(viewport=dict(width=1440, height=900), reduced_motion='reduce'); install(ctx, False)
        pg = ctx.new_page(); pg.goto(BASE + '/', wait_until='networkidle'); pg.wait_for_timeout(300)
        running = pg.evaluate("document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().duration > 5).length")
        opaque = pg.evaluate("[...document.querySelectorAll('.reveal')].every(e => getComputedStyle(e).opacity === '1')")
        inter.append(dict(w=1440, check='reduced motion: no running animations > 5ms, reveal content visible', ok=running == 0 and opaque, detail=f'running={running}'))
        ctx.close(); b.close()
    json.dump(dict(pages=results, interactions=inter), open(os.path.join(OUT, 'results.json'), 'w'), indent=1)
    bad = [r for r in results if r['overflowX'] or r['wide'] or r['consoleErrors'] or r['h1Count'] != 1 or r['imgsWithoutAlt']]
    print('page checks:', len(results), 'with issues:', len(bad))
    for r in bad: print('  ISSUE', r['page'], r['width'], {k: r[k] for k in ('overflowX', 'wide', 'consoleErrors', 'h1Count', 'imgsWithoutAlt') if r[k] and not (k == 'h1Count' and r[k] == 1)})
    small = [r for r in results if r['smallTargets']]
    print('pages with small targets:', len(small))
    for r in small[:12]: print('  SMALL', r['page'], r['width'], r['smallTargets'])
    print('interaction checks:', len(inter), 'failed:', [i['check'] + f" @{i['w']}" for i in inter if not i['ok']])
if __name__ == '__main__':
    if 'BASE' not in os.environ: serve()
    run()

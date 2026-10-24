import json, os, sys, threading, http.server, time
sys.path.insert(0, 'scripts')
from playwright.sync_api import sync_playwright
DIST = os.path.abspath('dist')
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].rstrip('/') or '/'
        full = os.path.join(DIST, p.lstrip('/'))
        if os.path.isdir(full): full = os.path.join(full, 'index.html')
        elif not os.path.exists(full) and os.path.exists(full + '.html'): full += '.html'
        elif not os.path.exists(full): full = os.path.join(DIST, 'index.html')
        return full
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 4199), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
DESC = 'A Kaayra Herbals formulation in development. Details are published once they have been confirmed and approved.'
def pub(slug, name, form, pack):
    return dict(slug=slug, name=name, form=form, packSize=pack, packSizes=[pack], statusLabel='Approved for sale', description=DESC, image=None, images=[], ingredients=['Tulsi','Amla'], subCompositions=None, preservatives=None, preservativeLabel='Preservatives', purchasable=True)
PRODUCTS = [pub('iron-syrup','Iron Syrup','Syrup','150 ml'), pub('multi-vitamin-syrup','Multi-Vitamin Syrup','Syrup','200 ml')]
delay = {'s': 0}
def handler(route):
    url = route.request.url; path = url.split('/api/', 1)[1].split('?')[0]
    def j(b, s=200): route.fulfill(status=s, content_type='application/json', body=json.dumps(b))
    if path == 'auth/session': return j(dict(status='error'), 401)
    if path == 'auth/status': return j(dict(status='ok', providers=[], signupOpen=True))
    if path == 'cart/config': return j(dict(status='ok', cartPreview=True))
    if path == 'orders/ai-config': return j(dict(status='ok', enabled=True))
    if path == 'orders/ai-warm': return j(dict(status='ok'))
    if path == 'products': return j(dict(status='ok', items=PRODUCTS))
    if path == 'orders/ai-chat':
        time.sleep(delay['s'])
        return j(dict(status='ok', reply='Both are syrups. **Iron Syrup** is a 150 ml pack, and **Multi-Vitamin Syrup** is 200 ml.\n- Both list their ingredients on the product page\n- Ask me to compare them further', products=['iron-syrup','multi-vitamin-syrup'], handoff=False, followUps=['Do you deliver to my PIN code?','How do I track my order?']))
    if path.startswith('cart'): return j(dict(status='ok', cartPreview=True, lines=[], totals=dict(itemCount=0, subtotalPaise=0, gstIncludedPaise=0), checkoutOpen=True, pricesIncludeGst=True))
    return j(dict(status='ok'))
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, w, h in [('desktop', 1280, 860), ('mobile', 390, 780)]:
        ctx = b.new_context(viewport=dict(width=w, height=h), device_scale_factor=2 if w < 500 else 1)
        ctx.route('**/api/**', handler)
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4199/collection', wait_until='load')
        pg.wait_for_selector('.kai-launch', timeout=8000)
        pg.click('.kai-launch'); pg.wait_for_selector('.kai-panel')
        time.sleep(0.5); pg.screenshot(path=f'test-results/screenshots/ai-{name}-1-open.png')
        delay['s'] = 1.5
        pg.click('.kai-chip >> nth=0'); time.sleep(0.8)
        pg.screenshot(path=f'test-results/screenshots/ai-{name}-2-waiting.png')
        pg.wait_for_selector('.kai-card', timeout=8000); time.sleep(0.8)
        pg.screenshot(path=f'test-results/screenshots/ai-{name}-3-answer.png')
        sx = pg.evaluate('document.documentElement.scrollWidth > window.innerWidth')
        print(name, 'horizontal page scroll:', sx, 'errors:', errs)
        ctx.close()
    b.close()

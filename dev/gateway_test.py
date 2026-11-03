"""Gateway test: checks the real nginx + njs server (the Docker image) against a fake Firefly III.

The unit tests run app/session.js and app/ingest.js in Node, and the smoke test uses dev/mock_server.py, so nothing
else ever starts the server people actually run. This does: sign-in, the session cookie, what reaches Firefly (and
what must not), the security headers, the rate limit, the Apple Pay endpoint, and that every placeholder in the page
was filled in. A typo in app/default.conf.template, or JavaScript that njs can't run, fails here, not on a NAS.

    docker build -t money-test .
    docker run -d --name money-test --network host -e LISTEN_PORT=18080 -e FIREFLY_URL=http://127.0.0.1:9009 \
        -e FIREFLY_TOKEN=tok-test -e DASH_PASSWORD=pw-test --user 568:568 money-test
    python3 dev/gateway_test.py          # BASE, FF_PORT, DASH_PASSWORD and FIREFLY_TOKEN override the defaults below
"""
import http.client, json, os, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE = urlparse(os.environ.get('BASE', 'http://127.0.0.1:18080'))
FF_PORT = int(os.environ.get('FF_PORT', 9009))
PASSWORD = os.environ.get('DASH_PASSWORD', 'pw-test')
TOKEN = os.environ.get('FIREFLY_TOKEN', 'tok-test')

# ---------- a fake Firefly III: remembers what it was asked ----------
SEEN = []      # (method, path, Authorization, Cookie, body)


class Firefly(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def reply(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/vnd.api+json')
        self.send_header('Set-Cookie', 'firefly_session=secret; Path=/')      # must never reach the browser
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)

    def handle_any(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n).decode() if n else ''
        SEEN.append((self.command, self.path, self.headers.get('Authorization'), self.headers.get('Cookie'), body))
        p = urlparse(self.path).path
        if p == '/api/v1/about': return self.reply(200, {'data': {'version': '6.9.9', 'api_version': '2.9.9'}})
        if p == '/api/v1/accounts':
            if 'type=asset' not in self.path: return self.reply(200, {'data': []})      # (it asks for assets, then liabilities)
            return self.reply(200, {'data': [{'id': '7', 'attributes': {'name': 'Everyday Checking', 'account_number': '', 'currency_code': 'USD', 'active': True}}]})
        if p == '/api/v1/transactions' and self.command == 'POST': return self.reply(200, {'data': {'id': '99'}})
        if p.startswith('/api/v1/search/accounts'): return self.reply(200, {'data': []})
        if p.startswith('/api/v1/preferences/'): return self.reply(404, {'message': 'not found'})
        if p == '/api/v1/exchange-rates': return self.reply(200, {'data': []})
        return self.reply(404, {'message': 'nothing here'})

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = handle_any


def start_firefly():
    srv = ThreadingHTTPServer(('127.0.0.1', FF_PORT), Firefly)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---------- a tiny client ----------
def call(method, path, body=None, headers=None):
    c = http.client.HTTPConnection(BASE.hostname, BASE.port, timeout=15)
    h = dict(headers or {})
    data = None
    if body is not None:
        data = body if isinstance(body, str) else json.dumps(body)
        h.setdefault('Content-Type', 'application/json')
    c.request(method, path, data, h)
    r = c.getresponse()
    text = r.read().decode('utf-8', 'replace')
    hdrs = {k.lower(): v for k, v in r.getheaders()}
    cookies = [v for k, v in r.getheaders() if k.lower() == 'set-cookie']
    c.close()
    return r.status, hdrs, text, cookies


FAILS = []


def check(ok, what):
    print(('  ok   ' if ok else '  FAIL ') + what)
    if not ok: FAILS.append(what)


def main():
    start_firefly()
    for _ in range(60):      # wait for the server to come up
        try:
            if call('GET', '/')[0] == 200: break
        except OSError: time.sleep(1)
    else:
        sys.exit('the server did not start: ' + BASE.geturl())

    print('The page and its files')
    st, h, body, _ = call('GET', '/')
    check(st == 200 and '<title>Money</title>' in body, 'the page is served')
    check(not re.search(r'\$\{[A-Z_]+\}', body), 'every ${PLACEHOLDER} in the page was filled in')
    csp = h.get('content-security-policy', '')
    check("script-src 'self'" in csp and "frame-ancestors 'none'" in csp and "object-src 'none'" in csp, 'the Content-Security-Policy is sent')
    check(h.get('x-frame-options') == 'DENY' and h.get('x-content-type-options') == 'nosniff' and h.get('referrer-policy') == 'no-referrer', 'framing, sniffing and referrer headers are sent')
    check('no-cache' in h.get('cache-control', ''), 'the page itself is never cached')
    for path in ('/assets/money.css', '/assets/js/boot.js', '/assets/js/app.js'):
        st, h, _, _ = call('GET', path)
        check(st == 200 and h.get('cache-control') == 'no-cache', f'{path} is served (checked every time without a version)')
    st, h, _, _ = call('GET', '/assets/js/app.js?v=abc')
    check('immutable' in h.get('cache-control', ''), 'a versioned script may be kept for a year')
    st, h, body, _ = call('GET', '/sw.js')
    check(st == 200 and 'javascript' in h.get('content-type', '') and 'no-cache' in h.get('cache-control', ''), 'the service worker is served and always re-checked')
    check('"/api/"' in body or '/api/' in body and 'startsWith("/api/")' in body, 'the service worker removes saved /api/ answers')
    st, h, body, _ = call('GET', '/manifest.webmanifest')
    check(st == 200 and json.loads(body)['short_name'] == 'Money', 'the web manifest is valid JSON')
    st, h, _, _ = call('HEAD', '/api/money-alive')
    check(st == 204 and h.get('x-money-server') == '1', 'Money answers "is it there?" with its own header')

    print('Signing in')
    st, h, _, _ = call('GET', '/api/v1/about', headers={'X-Money': '1'})
    check(st == 401 and h.get('x-dash-auth') == 'required', 'no session: 401 with the sign-in header')
    st, h, _, ck = call('POST', '/api/money-session', {'password': 'wrong'})
    check(st == 401 and not ck, 'wrong password: 401 and no cookie')
    st, h, _, ck = call('POST', '/api/money-session', {'password': PASSWORD, 'remember': True})
    cookie = ck[0].split(';')[0] if ck else ''
    check(st == 204 and 'HttpOnly' in ck[0] and 'SameSite=Strict' in ck[0] and 'Max-Age=' in ck[0], 'right password: 204 with an HttpOnly, SameSite=Strict cookie')
    st, h, _, ck2 = call('POST', '/api/money-session', {'password': PASSWORD})
    check(st == 204 and 'Max-Age' not in ck2[0], 'without "keep me signed in" the cookie ends with the browser')
    st, _, _, _ = call('GET', '/api/v1/about', headers={'X-Money': '1', 'Cookie': 'money_session=1.1.' + 'a' * 43})
    check(st == 401, 'a forged cookie is refused')
    st, _, _, _ = call('GET', '/api/v1/about', headers={'X-Money': '1', 'Cookie': cookie.replace(cookie[-3:], 'AAA')})
    check(st == 401, 'a cookie with a changed signature is refused')

    print('What reaches Firefly')
    ok = {'Cookie': cookie, 'X-Money': '1'}
    st, _, _, _ = call('GET', '/api/v1/about', headers={'Cookie': cookie})
    check(st == 403, 'a request without the X-Money header is refused')
    SEEN.clear()
    st, h, body, ck = call('GET', '/api/v1/about', headers={**ok, 'Accept': 'application/json'})
    check(st == 200 and json.loads(body)['data']['version'] == '6.9.9', 'a signed-in request is passed to Firefly')
    seen = SEEN[-1] if SEEN else (None,) * 5
    check(seen[2] == 'Bearer ' + TOKEN, 'Firefly gets the access token')
    check(not seen[3], 'the browser cookie is not passed on to Firefly')
    check(TOKEN not in body and not any(TOKEN in v for v in h.values()), 'the token is never sent to the browser')
    check('set-cookie' not in h or 'firefly_session' not in h['set-cookie'], "Firefly's own cookies are not passed to the browser")
    st, _, _, _ = call('PATCH', '/api/v1/about', {}, ok)
    check(st in (403, 405), 'PATCH is refused')
    st, _, _, _ = call('GET', '/__firefly/api/v1/about', headers=ok)
    check(st in (403, 404), 'the internal Firefly location is closed to browsers')
    st, h, _, _ = call('HEAD', '/api/v1/about', headers=ok)
    check(st == 200, 'HEAD (the connection check) is passed to Firefly')

    print('Apple Pay endpoint')
    st, h, body, _ = call('GET', '/api/money-ingest', headers={'X-Money': '1'})
    check(st == 401, 'the key is not given without a session')
    st, h, body, _ = call('GET', '/api/money-ingest', headers=ok)
    key = json.loads(body)['key'] if st == 200 else ''
    check(st == 200 and len(key) >= 20 and 'no-store' in h.get('cache-control', ''), 'the key is given to a signed-in app')
    pay = {'amount': '$4.50', 'merchant': 'Test Cafe', 'card': 'Everyday Checking'}
    st, _, body, _ = call('POST', '/api/money-ingest', pay, {'Authorization': 'Bearer nope'})
    check(st == 401, 'a wrong key is refused')
    st, _, body, _ = call('POST', '/api/money-ingest', pay)
    check(st == 401, 'no key is refused')
    SEEN.clear()
    st, _, body, _ = call('POST', '/api/money-ingest', pay, {'Authorization': 'Bearer ' + key})
    posts = [s for s in SEEN if s[0] == 'POST' and s[1] == '/api/v1/transactions']
    check(st == 200 and body.startswith('Logged 4.50 at Test Cafe'), 'a payment is logged: ' + body.strip()[:80])
    sent = json.loads(posts[0][4])['transactions'][0] if posts else {}
    check(sent.get('amount') == '4.50' and sent.get('source_id') == '7' and sent.get('destination_name') == 'Test Cafe' and 'Apple Pay' in sent.get('tags', []),
          'Firefly is sent a withdrawal from the matching account, tagged Apple Pay')
    check(posts and posts[0][2] == 'Bearer ' + TOKEN, 'the payment is sent with the Firefly token, not the key')
    st, _, body, _ = call('POST', '/api/money-ingest', {'amount': 'abc', 'merchant': 'x', 'card': 'y'}, {'Authorization': 'Bearer ' + key})
    check(st == 400, 'a payment with no amount is refused')

    print('Rate limit')
    codes = [call('POST', '/api/money-session', {'password': 'guess%d' % i})[0] for i in range(25)]
    check(429 in codes and codes[0] == 401, 'guessing the password gets 429 after a few tries')

    print()
    if FAILS:
        print(f'{len(FAILS)} failed:'); [print('  - ' + f) for f in FAILS]; sys.exit(1)
    print('All gateway checks passed')


if __name__ == '__main__':
    main()

/* interop/sources.mjs, attacked and exercised against a local fixture server.
     node interop/sources-test.mjs                                            */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { LIMITS, isBlockedIp, fetchPage, readableText, readSource, readSources, braveSearch, stillSays, recheck } from './sources.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✕ ' + m); } };
const refuses = async (p, re, m) => { try { await p; ok(false, m + ' (it did not refuse)'); } catch (e) { ok(re.test(e.message), m + ' — ' + e.message); } };
const sha = b => createHash('sha256').update(b).digest('hex');

const ARTICLE = `<!doctype html><html><head><title>Tide tables &amp; the harbour</title>
<script>window.secret = "SCRIPT TEXT MUST NOT APPEAR"</script><style>.x{color:red}</style></head>
<body><nav>NAVIGATION MUST NOT APPEAR</nav><header>HEADER MUST NOT APPEAR</header>
<article><h1>The harbour</h1><p>The harbour master publishes the tide tables every Monday morning, and the ferries follow them to the minute.</p>
<p>Spring tides this month peak at 4.2 metres on the twelfth, the highest reading since records began in 1911.</p>
<p>Small craft are asked to keep clear of the north channel during dredging, which runs until the end of the month.</p></article>
<footer>FOOTER MUST NOT APPEAR</footer></body></html>`;
let changing = ARTICLE;
const big = '<html><body><article>' + 'x '.repeat(2_000_000) + '</article></body></html>';

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/article') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(ARTICLE); }
  if (u.pathname === '/changing') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(changing); }
  if (u.pathname === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"a":1}'); }
  if (u.pathname === '/thin') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body><p>hi</p></body></html>'); }
  if (u.pathname === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(big); }
  if (u.pathname === '/missing') { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('no'); }
  if (u.pathname === '/hop') { res.writeHead(302, { location: '/article' }); return res.end(); }
  if (u.pathname === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
  if (u.pathname === '/to-file') { res.writeHead(302, { location: 'file:///etc/passwd' }); return res.end(); }
  if (u.pathname === '/drip') { res.writeHead(200, { 'content-type': 'text/html' }); const t = setInterval(() => res.write('<p>.</p>'), 150); req.on('close', () => clearInterval(t)); return; }
  if (u.pathname === '/res/v1/web/search') {
    if (req.headers['x-subscription-token'] !== 'good-key') { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ web: { results: [
      { url: 'https://a.example/1' }, { url: 'https://a.example/1' }, { url: 'javascript:alert(1)' }, { url: 'http://b.example/2' }, {} ] } }));
  }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const local = `http://localhost:${server.address().port}`;

console.log('-- where a fetch may not go');
for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', 'not-an-ip'])
  ok(isBlockedIp(a), `${a} is blocked`);
for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) ok(!isBlockedIp(a), `${a} is allowed`);

delete process.env.BYLINE_HELPER_FETCH_PRIVATE;
await refuses(fetchPage(base + '/article'), /private or reserved/, 'a loopback IP literal is refused');
await refuses(fetchPage(local + '/article'), /private or reserved/, 'a name that resolves to loopback is refused at connect time');
await refuses(fetchPage(`http://[::1]:${server.address().port}/article`), /private or reserved/, 'an IPv6 loopback literal is refused');
await refuses(fetchPage('http://169.254.169.254/latest/meta-data/'), /private or reserved/, 'the cloud metadata address is refused');
await refuses(fetchPage('file:///etc/passwd'), /only http and https/, 'a file: URL is refused');
await refuses(fetchPage('ftp://example.com/x'), /only http and https/, 'an ftp: URL is refused');
await refuses(fetchPage('http://user:pw@example.com/'), /credentials/, 'a URL with credentials is refused');
await refuses(fetchPage('not a url'), /not a URL/, 'something that is not a URL is refused');

console.log('-- reading a page (fixture server, private fetching on for these only)');
process.env.BYLINE_HELPER_FETCH_PRIVATE = '1';
const s = await readSource(base + '/article');
ok(s.title === 'Tide tables & the harbour', 'the title is read and its entities decoded: ' + s.title);
ok(/tide tables every Monday/.test(s.excerpt) && /4\.2 metres/.test(s.excerpt), 'the article text is in the excerpt');
ok(!/MUST NOT APPEAR/.test(s.excerpt), 'scripts, styles, navigation, header and footer are not');
ok(s.sha256 === sha(Buffer.from(ARTICLE)), 'the receipt hashes the exact bytes that were served');
ok(/^\d{4}-\d\d-\d\dT/.test(s.at) && s.finalUrl === base + '/article', 'it records when, and where it ended up');
const hopped = await readSource(base + '/hop');
ok(hopped.finalUrl === base + '/article' && hopped.url === base + '/hop', 'a redirect is followed, and both addresses are kept');
await refuses(fetchPage(base + '/loop'), /redirects/, 'a redirect loop gives up');
await refuses(fetchPage(base + '/to-file'), /only http and https/, 'a redirect to file: is refused');
await refuses(fetchPage(base + '/json'), /not a web page/, 'JSON is not read as a page');
await refuses(readSource(base + '/thin'), /no readable text/, 'a page with almost nothing on it gives no receipt');
await refuses(fetchPage(base + '/missing'), /HTTP 404/, 'a 404 is an error, not a source');
await refuses(fetchPage(base + '/big'), /larger than/, 'a page past the byte ceiling is abandoned');
const keepMs = LIMITS.pageMs; LIMITS.pageMs = 900;
const t0 = Date.now();
await refuses(fetchPage(base + '/drip'), /within/, 'a page that drips forever is abandoned');
ok(Date.now() - t0 < 2500, 'and on time: ' + (Date.now() - t0) + 'ms');
LIMITS.pageMs = keepMs;

const many = await readSources([base + '/article', base + '/json', base + '/hop', base + '/article', base + '/missing']);
ok(many.sources.map(x => x.n).join() === '1,2', 'survivors are numbered 1..k, duplicates once: ' + many.sources.map(x => x.n + ':' + x.url.split('/').pop()).join(' '));
ok(many.dropped.length === 2 && many.dropped.every(d => d.why), 'and every page left out says why: ' + many.dropped.map(d => d.why).join('; '));

const bare = readableText('<html><body><nav>NAV</nav><p>Words a reader sees.</p><script>var SCRIPT = 1</script><form>FORM</form><style>.STYLE{}</style><footer>FOOT</footer></body></html>');
ok(bare.text === 'Words a reader sees.', 'a page with no <article> or <main> is still stripped of its furniture: ' + JSON.stringify(bare.text));
const inside = readableText('<html><body><article><p>Kept.</p><script>INLINE_SCRIPT()</script><iframe>FRAME</iframe></article></body></html>');
ok(inside.text === 'Kept.', 'and so is a script inside the article itself: ' + JSON.stringify(inside.text));
const rt = readableText('<html><body><main><p>caf&eacute; &#233; &#x263A; &bogus; &#0;</p></main></body></html>');
ok(rt.text === 'caf&eacute; é ☺ &bogus;', 'entities: known ones decoded, unknown left as written, invalid code points dropped: ' + JSON.stringify(rt.text));

console.log('-- is the receipt still good');
const r1 = await recheck({ url: base + '/changing', sha256: sha(Buffer.from(changing)), excerpt: s.excerpt });
ok(r1.status === 'unchanged', 'same bytes: unchanged');
changing = ARTICLE.replace('<article>', '<article><p>ADVERT: buy a boat today, the finest boats on the coast at prices you will love.</p>');
const r2 = await recheck({ url: base + '/changing', sha256: s.sha256, excerpt: s.excerpt });
ok(r2.status === 'changed-still-says' && r2.found === r2.of, `an advert added: changed, still says it (${r2.found}/${r2.of})`);
changing = ARTICLE.replace('4.2 metres on the twelfth, the highest reading since records began in 1911', '3.1 metres, an ordinary month');
const r3 = await recheck({ url: base + '/changing', sha256: s.sha256, excerpt: s.excerpt });
ok(r3.status === 'changed-no-longer-says', `the cited fact rewritten: no longer says it (${r3.found}/${r3.of})`);
const r4 = await recheck({ url: base + '/missing', sha256: s.sha256, excerpt: s.excerpt });
ok(r4.status === 'unreachable' && /404/.test(r4.why), 'gone: unreachable, with the reason');
ok(stillSays('short.', 'anything').of === 0, 'an excerpt with no full sentence claims nothing either way');

console.log('-- search');
const found = await braveSearch('tides', 'good-key', base);
ok(found.join() === 'https://a.example/1,http://b.example/2', 'results: http(s) only, each once: ' + found.join(' '));
await refuses(braveSearch('tides', 'bad-key', base), /refused the key/, 'a bad key says so');

server.close();
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

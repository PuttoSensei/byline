/* Sources for a correspondent that cites: search, fetch, and a receipt for
   each page it read. Used by byline-helper.mjs; no dependencies.

   Ported from ~/Heya/sourced (src/fetcher.js, src/search.js), which wraps
   Brave Search and fetches the top results. What is new here is the receipt:
   for every page, the hash of the exact bytes fetched and the excerpt the
   model was shown, so a line that cites [2] carries what [2] said when it
   was read, and anyone can later ask whether the page still says it.

   Search results are attacker-influenced URLs, and so is anything pasted on a
   desk. They must never reach this machine's network:
     - only http and https, on their default ports or an explicit one;
     - an IP literal is checked before connecting, a hostname at connect time
       for every hop (so DNS rebinding cannot swap in a private address after
       a check), and every redirect is a new hop;
     - HTML only, a byte ceiling, a deadline per page.
   BYLINE_HELPER_FETCH_PRIVATE=1 lifts the address check, for tests against a
   local fixture server only; the helper prints that it is on. */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { createHash } from 'node:crypto';

export const LIMITS = { pages: 6, pageBytes: 1_500_000, pageMs: 10_000, excerpt: 1500, minText: 200, redirects: 5 };

/* ---------- where a fetch may not go ---------- */
const blocked = new net.BlockList();
for (const [a, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(a, bits, 'ipv4');
for (const [a, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2002::', 16],
]) blocked.addSubnet(a, bits, 'ipv6');

export function isBlockedIp(addr) {
  const fam = net.isIP(addr);
  if (!fam) return true;                                  // unparseable: refuse
  return blocked.check(addr, fam === 6 ? 'ipv6' : 'ipv4');
}

const allowPrivate = () => process.env.BYLINE_HELPER_FETCH_PRIVATE === '1';

function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = allowPrivate() ? addrs : addrs.filter(a => !isBlockedIp(a.address));
    if (!ok.length) return cb(new Error('refused: that name points at a private or reserved address'));
    if (options && options.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

/* ---------- one page ---------- */
function getOnce(url) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET', lookup: guardedLookup, timeout: LIMITS.pageMs,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Byline correspondent; +https://puttosensei.github.io/byline/)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity' },
    }, res => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) { res.resume(); return resolve({ redirect: res.headers.location || null }); }
      if (status < 200 || status >= 300) { res.resume(); return reject(new Error('it answered HTTP ' + status)); }
      const ct = String(res.headers['content-type'] || '');
      if (!/html|xhtml/i.test(ct)) { res.resume(); return reject(new Error('not a web page (' + (ct || 'no content type') + ')')); }
      const chunks = []; let n = 0;
      res.on('data', d => {
        n += d.length;
        if (n > LIMITS.pageBytes) { req.destroy(new Error('larger than ' + Math.round(LIMITS.pageBytes / 1e6 * 10) / 10 + 'MB')); return; }
        chunks.push(d);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks), contentType: ct }));
      res.on('error', reject);
    });
    // `timeout` above is idle time only: a server dripping one byte at a time
    // would never trip it. This is the whole page's deadline.
    const whole = setTimeout(() => req.destroy(new Error('no complete answer within ' + LIMITS.pageMs / 1000 + 's')), LIMITS.pageMs);
    req.on('close', () => clearTimeout(whole));
    req.on('timeout', () => req.destroy(new Error('no answer within ' + LIMITS.pageMs / 1000 + 's')));
    req.on('error', reject);
    req.end();
  });
}

export async function fetchPage(raw) {
  let url;
  try { url = new URL(String(raw)); } catch (e) { throw new Error('not a URL'); }
  for (let hop = 0; hop <= LIMITS.redirects; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new Error('only http and https pages can be read');
    if (url.username || url.password) throw new Error('a URL carrying credentials is refused');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate() && net.isIP(host) && isBlockedIp(host)) throw new Error('refused: a private or reserved address');
    const r = await getOnce(url);
    if ('redirect' in r) {
      if (!r.redirect) throw new Error('a redirect that names nowhere');
      url = new URL(r.redirect, url);
      continue;
    }
    return { finalUrl: url.href, body: r.body, contentType: r.contentType };
  }
  throw new Error('more than ' + LIMITS.redirects + ' redirects');
}

/* ---------- readable text, without a DOM ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•' };
const decodeEntities = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
  }
  const v = ENT[e.toLowerCase()]; return v == null ? m : v;
});

export function decodeBody(buf, contentType) {
  const label = (/charset=["']?([\w-]+)/i.exec(contentType || '') || [])[1] || 'utf-8';
  try { return new TextDecoder(label).decode(buf); } catch (e) { return new TextDecoder('utf-8').decode(buf); }
}

/* The page's words in reading order, with the furniture (scripts, styles,
   navigation, headers, footers, forms) taken out. Prefers <article>, then
   <main>, then <body>. Cruder than Readability, and deterministic: the same
   bytes always give the same text, which is what a recheck compares. */
export function readableText(html) {
  const title = decodeEntities(((/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html) || [])[1])
    || ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'select'])
    h = h.replace(new RegExp('<' + tag + '\\b[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi'), ' ');
  const pick = tag => (new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'i').exec(h) || [])[1];
  const part = pick('article') || pick('main') || pick('body') || h;
  const text = decodeEntities(part
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote|\/section)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text };
}

export function excerptOf(text, max = LIMITS.excerpt) {
  if (text.length <= max) return text;
  let e = text.slice(0, max);
  const cut = e.lastIndexOf(' ');
  if (cut > max * 0.8) e = e.slice(0, cut);
  return e + ' …';
}

const sha256 = b => createHash('sha256').update(b).digest('hex');

/* A receipt for one page, or the reason there is none. */
export async function readSource(url) {
  const page = await fetchPage(url);
  const { title, text } = readableText(decodeBody(page.body, page.contentType));
  if (text.length < LIMITS.minText) throw new Error('no readable text on the page');
  return { url: String(url), finalUrl: page.finalUrl, title: title || new URL(page.finalUrl).hostname,
    at: new Date().toISOString(), sha256: sha256(page.body), excerpt: excerptOf(text) };
}

/* Several pages at once; failures are reported, survivors numbered 1..k in
   the order given. Only a page that ends up here can be cited. */
export async function readSources(urls) {
  const uniq = [...new Set(urls.map(String))].slice(0, LIMITS.pages);
  const settled = await Promise.all(uniq.map(u => readSource(u).then(s => ({ s }), e => ({ dropped: { url: u, why: String(e.message || e).slice(0, 160) } }))));
  const sources = [], dropped = [];
  for (const r of settled) if (r.s) sources.push({ n: sources.length + 1, ...r.s }); else dropped.push(r.dropped);
  return { sources, dropped };
}

/* ---------- search ---------- */
export async function braveSearch(query, key, base = 'https://api.search.brave.com') {
  const url = new URL('/res/v1/web/search', base);
  url.searchParams.set('q', String(query).slice(0, 400));
  url.searchParams.set('count', String(LIMITS.pages));
  url.searchParams.set('text_decorations', 'false');
  const res = await fetch(url, { headers: { accept: 'application/json', 'x-subscription-token': key }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) throw new Error('Brave Search refused the key (BYLINE_HELPER_BRAVE_KEY)');
  if (res.status === 429) throw new Error('Brave Search rate limit: wait a moment');
  if (!res.ok) throw new Error('Brave Search failed (HTTP ' + res.status + ')');
  const body = await res.json();
  const seen = new Set(), out = [];
  for (const r of (body && body.web && body.web.results) || []) {
    if (!r || !r.url || !/^https?:\/\//i.test(r.url) || seen.has(r.url)) continue;
    seen.add(r.url); out.push(r.url);
  }
  return out.slice(0, LIMITS.pages);
}

/* ---------- is the receipt still good? ---------- */
const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
/* The excerpt's sentences that are still on the page. Whole-excerpt matching
   would call a page "changed" over one new advert; sentences that are still
   there, in any order, are what a reader means by "it still says that". */
export function stillSays(excerpt, text) {
  const page = norm(text);
  const sentences = norm(String(excerpt).replace(/ …$/, '')).split(/(?<=[.!?])\s+/).filter(x => x.length >= 40);
  if (!sentences.length) return { found: 0, of: 0 };
  return { found: sentences.filter(x => page.includes(x)).length, of: sentences.length };
}

export async function recheck({ url, sha256: was, excerpt }) {
  let page;
  try { page = await fetchPage(url); } catch (e) { return { status: 'unreachable', why: String(e.message || e).slice(0, 160) }; }
  const now = sha256(page.body);
  if (now === was) return { status: 'unchanged', sha256: now };
  const { text } = readableText(decodeBody(page.body, page.contentType));
  const s = stillSays(excerpt || '', text);
  return { status: s.of && s.found / s.of >= 0.8 ? 'changed-still-says' : 'changed-no-longer-says', sha256: now, found: s.found, of: s.of };
}

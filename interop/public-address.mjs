/* Is this IP address one the public internet can route to?

   An allowlist of hostnames is a check on a *name*. DNS decides the
   destination, and it can answer with anything — 127.0.0.1, a LAN address,
   or 169.254.169.254, which on most cloud hosts serves credentials to
   whatever asks. So the relay resolves a name itself, refuses every answer
   outside globally routable space, and then connects to the address it
   validated rather than to the name.

   The classification below is deliberately fail-closed: an address family
   or a range this does not recognise is treated as non-public. It is easier
   to add a range that turns out to be reachable than to explain one that
   turned out not to be.

   The shape of this file follows Control Center's lib/server/public-address.ts
   (github.com/mreflow/control-center), read on 2026-09-10. The reasoning is
   theirs; the code is written out here because the relay has no dependencies
   and is not going to acquire any.
*/
import { isIP } from 'node:net';

function parseIpv4(address) {
  if (isIP(address) !== 4) return null;
  const octets = address.split('.').map(Number);
  return octets.length === 4 ? octets : null;
}

function parseIpv6(address) {
  const withoutZone = address.split('%', 1)[0].toLowerCase();
  if (isIP(withoutZone) !== 6) return null;
  let normalized = withoutZone;
  /* ::ffff:192.0.2.1 and friends: fold the dotted tail into two words */
  if (normalized.includes('.')) {
    const at = normalized.lastIndexOf(':');
    const v4 = parseIpv4(normalized.slice(at + 1));
    if (!v4) return null;
    normalized = normalized.slice(0, at) + ':' +
      (((v4[0] << 8) | v4[1]).toString(16)) + ':' + (((v4[2] << 8) | v4[3]).toString(16));
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = left
    .concat(halves.length === 2 ? Array.from({ length: missing }, () => '0') : [])
    .concat(right)
    .map(w => Number.parseInt(w || '0', 16));
  return words.length === 8 && words.every(w => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? words : null;
}

function isNonPublicIpv4(o) {
  const [a, b, c, d] = o;
  if (
    a === 0 ||                                  // "this network"
    a === 10 ||                                 // private
    a === 127 ||                                // loopback
    (a === 100 && b >= 64 && b <= 127) ||       // carrier-grade NAT
    (a === 169 && b === 254) ||                 // link-local, and cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||        // private
    (a === 192 && b === 168) ||                 // private
    (a === 192 && b === 0 && c === 2) ||        // documentation
    (a === 192 && b === 88 && c === 99) ||      // deprecated 6to4 relay anycast
    (a === 198 && (b === 18 || b === 19)) ||    // benchmarking
    (a === 198 && b === 51 && c === 100) ||     // documentation
    (a === 203 && b === 0 && c === 113) ||      // documentation
    a >= 224                                    // multicast and reserved
  ) return true;
  /* 192.0.0.0/24 is special-purpose except for two anycast addresses */
  return a === 192 && b === 0 && c === 0 && d !== 9 && d !== 10;
}

const embeddedIpv4 = (w, i) => [w[i] >> 8, w[i] & 0xff, w[i + 1] >> 8, w[i + 1] & 0xff];

export function isNonPublicIpAddress(address) {
  const normalized = String(address).replace(/^\[|\]$/g, '');
  const v4 = parseIpv4(normalized);
  if (v4) return isNonPublicIpv4(v4);
  const w = parseIpv6(normalized);
  if (!w) return true;                                        // unparseable: fail closed
  if (w.slice(0, 5).every(x => x === 0) && w[5] === 0xffff) return isNonPublicIpv4(embeddedIpv4(w, 6));
  if (w[0] === 0x0064 && w[1] === 0xff9b && w.slice(2, 6).every(x => x === 0)) return isNonPublicIpv4(embeddedIpv4(w, 6));
  /* globally routable unicast is 2000::/3; everything else fails closed */
  if ((w[0] & 0xe000) !== 0x2000) return true;
  return (
    (w[0] === 0x2001 && (w[1] & 0xfe00) === 0) ||             // IETF special-purpose
    (w[0] === 0x2001 && w[1] === 0x0db8) ||                   // documentation
    (w[0] === 0x3fff && (w[1] & 0xf000) === 0) ||             // documentation
    w[0] === 0x2002                                           // deprecated 6to4
  );
}

/* Names that never belong to a public host, refused before DNS is asked. */
export function isLocalHostname(hostname) {
  const h = String(hostname).replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') ||
    h === 'local' || h.endsWith('.local') ||
    h === 'home.arpa' || h.endsWith('.home.arpa');
}

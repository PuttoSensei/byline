// Make a throwaway code-signing certificate, for proving the signing pipeline
// and nothing else. It is self-signed, lives only in desktop/.signing/ (which
// git ignores), and is never put into any Windows certificate store, so
// nothing on this machine or any other trusts it. An installer signed with it
// is still "Unknown publisher" to Windows.
//
// Prints the certificate's SHA-1 thumbprint on the last line.
import { spawnSync } from 'node:child_process';
import { randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dir = path.resolve(here, '..', '.signing');
export const PFX = path.join(dir, 'test-signing.pfx');
export const PASSWORD_FILE = PFX + '.password';
const CER = path.join(dir, 'test-signing.cer');

function openssl() {
  for (const p of ['C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'])
    if (existsSync(p)) return p;
  return 'openssl';
}

export function thumbprint() {
  return new X509Certificate(readFileSync(CER)).fingerprint.replace(/:/g, '');
}

export function ensureTestCert() {
  if (existsSync(PFX) && existsSync(PASSWORD_FILE) && existsSync(CER)) return { pfx: PFX, password: readFileSync(PASSWORD_FILE, 'utf8'), thumbprint: thumbprint() };
  mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'test-signing.key');
  const run = args => {
    const r = spawnSync(openssl(), args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`openssl ${args[0]} failed:\n${r.stderr}`);
  };
  run(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-keyout', key, '-out', CER, '-days', '30',
    '-subj', '/CN=Byline TEST signing - not trusted',
    '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=codeSigning',
    '-addext', 'basicConstraints=critical,CA:FALSE']);
  const password = randomBytes(18).toString('base64url');
  // SHA-1/3DES wrapping: the PFX format every signtool version reads. The key is a throwaway.
  run(['pkcs12', '-export', '-inkey', key, '-in', CER, '-out', PFX, '-passout', 'pass:' + password,
    '-certpbe', 'PBE-SHA1-3DES', '-keypbe', 'PBE-SHA1-3DES', '-macalg', 'sha1']);
  writeFileSync(PASSWORD_FILE, password);
  rmSync(key);  // the PFX holds it now
  return { pfx: PFX, password, thumbprint: thumbprint() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here, 'test-cert.mjs')) {
  const c = ensureTestCert();
  console.log(`test certificate: ${c.pfx}\n${c.thumbprint}`);
}

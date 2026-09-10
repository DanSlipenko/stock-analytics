export const SESSION_COOKIE = 'sp_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Token is `<expiresAtMs>.<hmac>`; Web Crypto keeps it usable from the proxy and route handlers alike. */
export async function createSessionToken(secret: string) {
  const expiresAt = String(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(expiresAt));
  return `${expiresAt}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(secret: string, token: string | undefined) {
  if (!token) return false;

  const [expiresAt, signature] = token.split('.');
  if (!expiresAt || !signature || !(Number(expiresAt) > Date.now())) return false;

  try {
    // subtle.verify compares in constant time.
    return await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(signature), encoder.encode(expiresAt));
  } catch {
    return false;
  }
}

// Optional: makes a VAPID key pair for Web Push (daily reminders). The Worker
// makes and stores its own keys, so this is only needed to override them.
//
//   node scripts/vapid-keys.mjs
//
// Add both values to the Worker as secrets (see the README). Keep the private
// key secret and don't commit it. If you ever change the keys, everyone has
// to turn reminders off and on again.
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
const b64url = (u8) => Buffer.from(u8).toString('base64url');
console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);

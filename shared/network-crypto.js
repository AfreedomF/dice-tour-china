// Browser WebCrypto only: never Math.random for identities, room secrets or IVs.
const enc = new TextEncoder(), dec = new TextDecoder();
export const MAX_PACKET_BYTES = 192 * 1024;
export function randomHex(bytes = 32) { const b = new Uint8Array(bytes); crypto.getRandomValues(b); return hex(b); }
export function hex(bytes) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''); }
export function unhex(s) { if (typeof s !== 'string' || s.length % 2 || !/^[a-f0-9]+$/i.test(s)) throw Error('Invalid hex'); return Uint8Array.from(s.match(/../g), x => parseInt(x, 16)); }
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(typeof value === 'string' ? value : canonical(value)))); }
function publicJwk(k) { return {kty:k.kty, crv:k.crv, x:k.x, y:k.y}; }
export async function createIdentity() {
  const sign = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, true, ['sign','verify']);
  const dh = await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, true, ['deriveKey']);
  const signPublic = publicJwk(await crypto.subtle.exportKey('jwk', sign.publicKey));
  const dhPublic = publicJwk(await crypto.subtle.exportKey('jwk', dh.publicKey));
  return {id:await digest(signPublic), signPublic, dhPublic, signPrivate:await crypto.subtle.exportKey('jwk',sign.privateKey), dhPrivate:await crypto.subtle.exportKey('jwk',dh.privateKey)};
}
export async function sharedKey(secret) { return crypto.subtle.importKey('raw', unhex(await digest('dice-tour/aes/v1/' + secret)), 'AES-GCM', false, ['encrypt','decrypt']); }
export async function privateKey(identity, peer) {
  const own = await crypto.subtle.importKey('jwk',identity.dhPrivate,{name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);
  const pub = await crypto.subtle.importKey('jwk',peer,{name:'ECDH',namedCurve:'P-256'},false,[]);
  return crypto.subtle.deriveKey({name:'ECDH',public:pub},own,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encrypt(key, value, aad = '') { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},key,enc.encode(canonical(value))); return {iv:hex(iv),ct:hex(ct)}; }
export async function decrypt(key, packet, aad = '') {
  if (!packet || typeof packet.ct !== 'string' || packet.ct.length > MAX_PACKET_BYTES * 2 || !/^[a-f0-9]{24}$/.test(packet.iv)) throw Error('Invalid encrypted packet');
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(packet.iv),additionalData:enc.encode(aad)},key,unhex(packet.ct))));
}
export async function sign(identity, message) { const key = await crypto.subtle.importKey('jwk',identity.signPrivate,{name:'ECDSA',namedCurve:'P-256'},false,['sign']); return hex(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(canonical(message)))); }
export async function verify(pub, message, signature) { try { const key = await crypto.subtle.importKey('jwk',pub,{name:'ECDSA',namedCurve:'P-256'},false,['verify']); return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unhex(signature),enc.encode(canonical(message))); } catch { return false; } }
export async function seal(key, identity, message, topic) { const data = {...message,from:identity.id,signKey:identity.signPublic,dhKey:identity.dhPublic}; return JSON.stringify(await encrypt(key,{data,signature:await sign(identity,data)},topic)); }
export async function open(key, raw, topic) { if (typeof raw !== 'string' || enc.encode(raw).length > MAX_PACKET_BYTES) throw Error('Packet too large'); const packet = await decrypt(key,JSON.parse(raw),topic); if (!packet.data || await digest(packet.data.signKey) !== packet.data.from || !await verify(packet.data.signKey,packet.data,packet.signature)) throw Error('Invalid signature'); return packet.data; }

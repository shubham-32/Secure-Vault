// crypto.js - PBKDF2 + AES-GCM helpers using WebCrypto
// Exports: deriveKey(masterPassword, saltB64, iterations=310000, extractable=false),
// encryptJson, decryptJson, exportRawKey, importRawKey, toB64, fromB64

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function deriveKey(masterPassword, saltB64 = null, iterations = 310000, extractable = false) {
  // masterPassword: string
  // saltB64: optional base64 salt (string)
  // iterations: PBKDF2 iterations (number)
  // extractable: whether derived CryptoKey should be exportable (for session export)
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16)).buffer;

  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    Boolean(extractable), // exportable only if explicitly requested
    ["encrypt", "decrypt"]
  );

  return {
    key,
    saltB64: saltB64 || toB64(salt)
  };
}

export async function encryptJson(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV recommended for AES-GCM
  const data = textEncoder.encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { ivB64: toB64(iv.buffer), cipherB64: toB64(cipher) };
}

export async function decryptJson(payload, key) {
  const { ivB64, cipherB64 } = payload;
  if (!ivB64 || !cipherB64) throw new Error("invalid payload");
  const iv = fromB64(ivB64);
  const cipher = fromB64(cipherB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return JSON.parse(textDecoder.decode(plain));
}

/**
 * Export raw AES key to base64 string
 * Accepts a CryptoKey (AES-GCM) and returns base64 of raw key bytes.
 */
export async function exportRawKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key); // ArrayBuffer
  return toB64(raw);
}

/**
 * Import raw base64 key back to CryptoKey
 * Accepts base64 string produced by exportRawKey
 */
export async function importRawKey(b64) {
  const raw = fromB64(b64);
  return await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/* Base64 helpers */
export function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let str = "";
  // build binary string (fast enough for small buffers)
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

export function fromB64(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

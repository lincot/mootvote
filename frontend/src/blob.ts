import { jsonReplacer, jsonReviver } from "../../helpers/utils";

export type EncryptedBlob = {
  v: 1;
  saltB64: string;
  ivB64: string;
  ctB64: string;
};

export async function encryptToBlob<T>(
  pass: string,
  obj: T,
): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pbkdf2(pass, salt);
  const pt = new TextEncoder().encode(JSON.stringify(obj, jsonReplacer));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt),
  );
  return {
    v: 1,
    saltB64: btoa(String.fromCharCode(...salt)),
    ivB64: btoa(String.fromCharCode(...iv)),
    ctB64: btoa(String.fromCharCode(...ct)),
  };
}

export async function decryptFromBlob<T>(
  pass: string,
  blob: EncryptedBlob,
): Promise<T> {
  const salt = Uint8Array.from(atob(blob.saltB64), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(blob.ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(blob.ctB64), (c) => c.charCodeAt(0));
  const key = await pbkdf2(pass, salt);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct),
  );
  return JSON.parse(new TextDecoder().decode(pt), jsonReviver);
}

async function pbkdf2(pass: string, salt: Uint8Array) {
  const te = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    te.encode(pass),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: Buffer.from(salt),
      iterations: 250_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return key;
}

/**
 * A Google refresh token is a key to the person's calendar: it is sealed with AES-GCM before it is
 * stored, so the database alone never gives it away. "v1.<iv>.<sealed>", base64url.
 */
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const keyOf = (keyB64: string) =>
  crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );

export async function encryptToken(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await keyOf(keyB64),
    new TextEncoder().encode(plain),
  );
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(sealed))}`;
}

/** Throws when it was not sealed with this key, or has been changed. */
export async function decryptToken(sealed: string, keyB64: string): Promise<string> {
  const [version, iv, body] = sealed.split(".");
  if (version !== "v1" || !iv || !body) throw new Error("not a sealed token");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(iv) },
    await keyOf(keyB64),
    fromB64url(body),
  );
  return new TextDecoder().decode(plain);
}

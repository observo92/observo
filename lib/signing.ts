import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "crypto";

// Off-chain Ed25519 attestation. Every AI verdict gets a canonical JSON
// payload hashed (sha256) and signed with Observo's private key before
// being stored. Anyone can independently verify a verdict wasn't tampered
// with using the public key published on the About page — no blockchain
// or gas fees required, at the cost of trusting Observo not to rotate
// keys silently (documented tradeoff vs on-chain EAS attestation).

function loadPrivateKey() {
  const b64 = process.env.OBSERVO_SIGNING_PRIVATE_KEY;
  if (!b64) throw new Error("OBSERVO_SIGNING_PRIVATE_KEY is not set");
  return createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
}

function loadPublicKey(publicKeyB64: string) {
  return createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
}

// Canonical stringify: sorts object keys recursively so the same logical
// payload always hashes to the same bytes regardless of key insertion order.
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`
    );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

export function signPayload(payload: unknown): { hash: string; signature: string } {
  const hash = hashPayload(payload);
  const privateKey = loadPrivateKey();
  const signature = edSign(null, Buffer.from(hash, "hex"), privateKey).toString("base64");
  return { hash, signature };
}

// Used both server-side (sanity check after signing) and can be ported to
// any client (browser/CLI) given the public key + hash + signature — that's
// the whole point of the "verify" feature on the site.
export function verifySignature(hash: string, signature: string, publicKeyB64: string): boolean {
  const publicKey = loadPublicKey(publicKeyB64);
  try {
    return edVerify(null, Buffer.from(hash, "hex"), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

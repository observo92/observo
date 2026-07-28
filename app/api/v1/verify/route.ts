// Verifies a verdict's signature using Observo's published public key.
// This is a real Ed25519 verification (lib/signing.ts), not a UI-only
// simulation — the same check anyone could run independently offline
// given the payload, signature, and public key.

import { NextRequest, NextResponse } from "next/server";
import { verifySignature } from "@/lib/signing";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { hash, signature } = body;

  if (typeof hash !== "string" || typeof signature !== "string") {
    return NextResponse.json({ error: "hash and signature are required" }, { status: 400 });
  }

  const publicKey = process.env.NEXT_PUBLIC_OBSERVO_SIGNING_PUBLIC_KEY!;
  const valid = verifySignature(hash, signature, publicKey);

  return NextResponse.json({ valid });
}

import { createHmac, timingSafeEqual } from "crypto";

export function verifyRazorpaySignature(
  rawBody: Buffer,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createHmac("sha256", secret).update(rawBody).digest("hex");

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

export function generateRazorpaySignature(rawBody: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
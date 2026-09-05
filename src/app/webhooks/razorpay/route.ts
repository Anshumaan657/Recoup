import { NextRequest } from "next/server";
import { ingestRazorpayWebhook } from "@/lib/razorpay/webhook-handler";

export async function POST(request: NextRequest) {
  return ingestRazorpayWebhook(request);
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@/lib/validation/env";
import {
  buildPaymentLinkParams,
  createPaymentLink,
} from "@/lib/razorpay/payment-links";
import { RazorpayProviderError } from "@/lib/razorpay/client";

const originalEnv = { ...process.env };
const expiresAt = new Date("2030-01-01T00:00:00.000Z");

function request() {
  return buildPaymentLinkParams({
    caseId: "case_123",
    amount: 50_000,
    currency: "INR",
    customerName: "Test Customer",
    customerEmail: "customer@example.com",
    customerContact: "+919999999999",
    description: "Recover order order_123",
    expiresAt,
  });
}

function enableProvider() {
  process.env.ENABLE_RAZORPAY_LINKS = "true";
  process.env.DEMO_MODE = "true";
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "test_secret";
  resetServerEnvCache();
}

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  resetServerEnvCache();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetServerEnvCache();
});

describe("Razorpay Payment Links", () => {
  it("builds the exact bounded standard Payment Link request", () => {
    expect(request()).toEqual({
      amount: 50_000,
      currency: "INR",
      reference_id: "recovery_case_123",
      description: "Recover order order_123",
      customer: {
        name: "Test Customer",
        email: "customer@example.com",
        contact: "+919999999999",
      },
      expire_by: 1_893_456_000,
      reminder_enable: false,
      notify: { email: false, sms: false },
      notes: { recovery_case_id: "case_123" },
    });
  });

  it("creates a deterministic simulated link without credentials", async () => {
    process.env.ENABLE_RAZORPAY_LINKS = "false";
    process.env.DEMO_MODE = "true";
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    resetServerEnvCache();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const first = await createPaymentLink(request());
    const second = await createPaymentLink(request());

    expect(first.id).toBe(second.id);
    expect(first.short_url).toBe(second.short_url);
    expect(first.simulated).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends Basic Auth and the exact request body to Razorpay", async () => {
    enableProvider();
    const response = {
      ...request(),
      id: "plink_test_123",
      entity: "payment_link",
      status: "created",
      short_url: "https://rzp.io/i/test123",
      created_at: 1_700_000_000,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await createPaymentLink(request());

    expect(result.id).toBe("plink_test_123");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.razorpay.com/v1/payment_links");
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toEqual(request());
    expect(new Headers(options?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("rzp_test_key:test_secret").toString("base64")}`
    );
  });

  it.each([400, 500])("returns a typed redacted provider error for HTTP %s", async (status) => {
    enableProvider();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "BAD_REQUEST_ERROR",
            reason: "invalid_request",
            description: "secret provider detail",
          },
          key_secret: "must-not-escape",
        }),
        { status }
      )
    );

    const error = await createPaymentLink(request()).catch((value) => value);
    expect(error).toBeInstanceOf(RazorpayProviderError);
    expect(error.status).toBe(status);
    expect(error.code).toBe("BAD_REQUEST_ERROR");
    expect(JSON.stringify(error.safeDetails)).not.toContain("must-not-escape");
    expect(JSON.stringify(error.safeDetails)).not.toContain("secret provider detail");
  });

  it("aborts timed-out provider requests", async () => {
    enableProvider();
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        );
      })
    );

    const error = await createPaymentLink(request(), 5).catch((value) => value);
    expect(error).toBeInstanceOf(RazorpayProviderError);
    expect(error.category).toBe("timeout");
    expect(error.code).toBe("TIMEOUT");
  });

  it("reconciles a matching provider reference conflict", async () => {
    enableProvider();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "BAD_REQUEST_ERROR",
            payment_link: {
              id: "plink_existing_123",
              amount: 50_000,
              currency: "INR",
              reference_id: "recovery_case_123",
              short_url: "https://rzp.io/i/existing",
              expire_by: 1_893_456_000,
            },
          },
        }),
        { status: 400 }
      )
    );

    const result = await createPaymentLink(request());
    expect(result.id).toBe("plink_existing_123");
    expect(result.reference_id).toBe("recovery_case_123");
  });

  it("rejects missing credentials outside demo mode", async () => {
    process.env.ENABLE_RAZORPAY_LINKS = "true";
    process.env.DEMO_MODE = "false";
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    resetServerEnvCache();

    const error = await createPaymentLink(request()).catch((value) => value);
    expect(error).toBeInstanceOf(RazorpayProviderError);
    expect(error.code).toBe("CONFIG_MISSING");
  });
});

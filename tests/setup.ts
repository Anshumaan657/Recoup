import "@testing-library/jest-dom";
import { vi } from "vitest";
import { TEST_DATABASE_URL } from "./test-database";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.RAZORPAY_WEBHOOK_SECRET = "recoverai-test-only-webhook-secret";
process.env.ENABLE_RAZORPAY_LINKS = "false";
process.env.DEMO_MODE = "true";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(window, "localStorage", {
  writable: true,
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
});

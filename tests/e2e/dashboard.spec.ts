import { expect, test } from "@playwright/test";

test("replays, filters, and inspects a recovery audit", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Recovery command center" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Replay 60-case demo" }).click();
  await page.getByRole("button", { name: "Confirm replay" }).click();
  await expect(page.getByRole("button", { name: /Demo refreshed/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/₹1,24,840/).first()).toBeVisible();
  await expect(page.getByText("30.7%")).toBeVisible();

  await page.getByLabel("Filter by status").selectOption("recovered");
  await expect(page.getByText(/cases shown · newest first/)).toBeVisible();
  await page.getByRole("button", { name: /Inspect decision|Open recovery case/ }).first().click();

  const dialog = page.getByRole("dialog", { name: "Case detail" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Audit timeline" })).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Chronological audit timeline" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("has no horizontal overflow across supported viewport boundaries", async ({ page }) => {
  for (const width of [320, 375, 414, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Recovery command center" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content, `overflow at ${width}px`).toBeLessThanOrEqual(
      dimensions.viewport
    );
  }
});

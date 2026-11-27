import { expect, test, type Page } from "@playwright/test";

async function section(page: Page, title: string) {
  return page.locator("section.report-section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

test("report chart hover does not resize sections and donut legends stay close", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/reports");
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("pennyats-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();

  for (const title of ["By job", "Interviewers"]) {
    const chart = await section(page, title);
    const row = chart.locator("ul").last().locator("li").first();
    const before = await chart.evaluate((el) => el.getBoundingClientRect().height);
    await row.hover();
    expect(await chart.evaluate((el) => el.getBoundingClientRect().height)).toBe(before);
  }

  const trend = await section(page, "Applications and hires over time");
  const next = await section(page, "Time in stage");
  const top = await next.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await trend.locator("svg[role='img']").first().hover({ position: { x: 100, y: 80 } });
  expect(await next.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)).toBe(top);

  for (const title of ["Sources", "Rejection reasons"]) {
    const chart = await section(page, title);
    const svg = await chart.locator("svg[role='img']").boundingBox();
    const legend = await chart.locator("ul[aria-label='Legend']").boundingBox();
    expect(svg && legend).toBeTruthy();
    expect(legend!.x - (svg!.x + svg!.width)).toBeLessThanOrEqual(24);
  }
});

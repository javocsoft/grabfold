import { expect, test, type Page } from "@playwright/test";

/** The book's box on screen. */
async function bookBox(page: Page) {
  const box = await page.locator(".grabfold").first().boundingBox();
  if (!box) throw new Error("no book on the page");
  return box;
}

/** Waits for whatever turn is running to land. */
async function settled(page: Page) {
  await page.waitForFunction(() => !(window as unknown as { book: { isTurning: boolean } }).book.isTurning);
}

const position = (page: Page) =>
  page.evaluate(() => (window as unknown as { book: { position: number } }).book.position);

/** Presses at a point, moves in steps, lets go. `hold` waits between steps. */
async function drag(page: Page, from: [number, number], to: [number, number], steps = 12, hold = 16) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    await page.mouse.move(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
    if (hold) await page.waitForTimeout(hold);
  }
  await page.mouse.up();
}

test.describe("turning by hand", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/examples/vanilla/");
    await page.waitForFunction(() => "book" in window);
  });

  test("a hard cover is opened by pulling it across", async ({ page }) => {
    expect(await position(page)).toBe(-2);
    const box = await bookBox(page);
    // Closed, the cover sits in the middle of the space.
    await drag(page, [box.x + box.width * 0.7, box.y + box.height / 2], [box.x + box.width * 0.1, box.y + box.height / 2], 16, 20);
    await settled(page);
    expect(await position(page)).toBe(-1);
  });

  test("a page pulled only a little drops back", async ({ page }) => {
    await page.evaluate(() => (window as unknown as { book: { jumpTo(p: number): void } }).book.jumpTo(1));
    const box = await bookBox(page);
    const y = box.y + box.height / 2;
    // Slowly, so it is a drag and not a flick.
    await drag(page, [box.x + box.width * 0.9, y], [box.x + box.width * 0.8, y], 10, 60);
    await settled(page);
    expect(await position(page)).toBe(1);
  });

  test("a page pulled past the middle turns", async ({ page }) => {
    await page.evaluate(() => (window as unknown as { book: { jumpTo(p: number): void } }).book.jumpTo(1));
    const box = await bookBox(page);
    const y = box.y + box.height * 0.7;
    await drag(page, [box.x + box.width * 0.9, y], [box.x + box.width * 0.3, y - 40], 16, 20);
    await settled(page);
    expect(await position(page)).toBe(2);
  });

  test("a quick flick turns the page however short it was", async ({ page }) => {
    await page.evaluate(() => (window as unknown as { book: { jumpTo(p: number): void } }).book.jumpTo(1));
    const box = await bookBox(page);
    const y = box.y + box.height / 2;
    await drag(page, [box.x + box.width * 0.9, y], [box.x + box.width * 0.78, y], 4, 8);
    await settled(page);
    expect(await position(page)).toBe(2);
  });

  test("the left page is pulled back the other way", async ({ page }) => {
    await page.evaluate(() => (window as unknown as { book: { jumpTo(p: number): void } }).book.jumpTo(3));
    const box = await bookBox(page);
    const y = box.y + box.height / 2;
    await drag(page, [box.x + box.width * 0.1, y], [box.x + box.width * 0.8, y], 16, 20);
    await settled(page);
    expect(await position(page)).toBe(2);
  });

  test("the arrow keys turn the book while it has focus", async ({ page }) => {
    await page.locator(".grabfold").focus();
    await page.keyboard.press("ArrowRight");
    await settled(page);
    await page.keyboard.press("ArrowRight");
    await settled(page);
    expect(await position(page)).toBe(0);
    await page.keyboard.press("ArrowLeft");
    await settled(page);
    expect(await position(page)).toBe(-1);
  });

  test("the click a drag ends on does not reach the page", async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as { book: { jumpTo(p: number): void }; clicks: number };
      w.book.jumpTo(1);
      w.clicks = 0;
      document.querySelector(".grabfold")!.addEventListener("click", () => (w.clicks += 1));
    });
    const box = await bookBox(page);
    const y = box.y + box.height / 2;
    await drag(page, [box.x + box.width * 0.9, y], [box.x + box.width * 0.2, y]);
    await settled(page);
    expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(0);
  });

  test("the address bar follows the page, and opens the book there", async ({ page }) => {
    await page.evaluate(() => (window as unknown as { book: { turnTo(p: number): Promise<boolean> } }).book.turnTo(3));
    await settled(page);
    await expect(page).toHaveURL(/#position=3$/);
    await page.reload();
    await page.waitForFunction(() => "book" in window);
    expect(await position(page)).toBe(3);
  });

  test("a mouse near the free edge lifts the page's corner", async ({ page }) => {
    await page.evaluate(() => (window as unknown as { book: { jumpTo(p: number): void } }).book.jumpTo(1));
    // The page itself, not the book's box, which has room for the stacks.
    const box = (await page.locator('.grabfold-page[data-side="right"]').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width - 3, box.y + box.height - 10, { steps: 4 });
    await expect(page.locator(".grabfold-sheet").first()).toBeVisible();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 4 });
    await expect(page.locator(".grabfold-sheet").first()).toBeHidden();
    expect(await position(page)).toBe(1);
  });
});

test.describe("bindings", () => {
  test("bound on the right, a page is pulled from left to right to go on", async ({ page }) => {
    await page.goto("/e2e/fixtures/visual.html?binding=right&position=1");
    await page.waitForFunction(() => "book" in window);
    const box = await bookBox(page);
    const y = box.y + box.height / 2;
    await drag(page, [box.x + box.width * 0.1, y], [box.x + box.width * 0.8, y], 16, 20);
    await settled(page);
    expect(await position(page)).toBe(2);
    await page.locator(".grabfold").focus();
    await page.keyboard.press("ArrowLeft");
    await settled(page);
    expect(await position(page)).toBe(3);
  });

  test("bound at the top, a page is pulled upwards to go on", async ({ page }) => {
    // Two pages one above the other: taller than the default window.
    await page.setViewportSize({ width: 1000, height: 1200 });
    await page.goto("/examples/calendar/");
    await page.waitForFunction(() => "book" in window);
    const box = await bookBox(page);
    const x = box.x + box.width / 2;
    await drag(page, [x, box.y + box.height * 0.92], [x, box.y + box.height * 0.2], 16, 20);
    await settled(page);
    expect(await position(page)).toBe(0);
    await page.locator(".grabfold").focus();
    await page.keyboard.press("ArrowDown");
    await settled(page);
    expect(await position(page)).toBe(1);
  });
});

test.describe("a big book", () => {
  test("only the pages on show are in the DOM", async ({ page }) => {
    await page.goto("/examples/big/");
    await page.waitForFunction(() => "book" in window);
    await page.evaluate(() => (window as unknown as { book: { turnTo(p: number): Promise<boolean> } }).book.turnTo(500));
    await settled(page);
    expect(await page.locator(".grabfold-content").count()).toBe(2);
  });

  test("a block of pages is taken from the edge of the stack", async ({ page }) => {
    await page.goto("/examples/big/");
    await page.waitForFunction(() => "book" in window);
    const handle = await page.locator(".grabfold-block-handle[data-side=right]").boundingBox();
    if (!handle) throw new Error("no handle");
    const y = handle.y + handle.height / 2;
    const box = await bookBox(page);
    // From the outside of the stack: a thick block.
    await drag(page, [handle.x + handle.width - 2, y], [box.x + box.width * 0.2, y], 16, 20);
    await settled(page);
    expect(await position(page)).toBeGreaterThan(20);
  });
});

test.describe("adapters keep a page's own state through a turn", () => {
  for (const name of ["react", "vue", "svelte"]) {
    test(name, async ({ page }) => {
      await page.goto(`/examples/${name}/`);
      const next = page.getByRole("button", { name: /Next/ });
      const prev = page.getByRole("button", { name: /Previous/ });
      await next.click();
      await page.waitForTimeout(900);
      await next.click();
      await page.waitForTimeout(900);
      const like = page.locator(".grabfold .like").first();
      await like.click();
      await like.click();
      await next.click();
      await page.waitForTimeout(900);
      await prev.click();
      await page.waitForTimeout(900);
      await expect(page.locator(".grabfold .like").first()).toHaveText(/2/);
    });
  }

  test("web component", async ({ page }) => {
    await page.goto("/examples/element/");
    // The form is on page 3: the front of the second sheet, open at 0.
    await page.evaluate(() => (document.getElementById("book") as unknown as { turnTo(p: number): Promise<boolean> }).turnTo(0));
    await page.locator("grab-fold input").fill("grabfold");
    await page.evaluate(async () => {
      const book = document.getElementById("book") as unknown as { turnTo(p: number): Promise<boolean> };
      await book.turnTo(2);
      await book.turnTo(0);
    });
    await expect(page.locator("grab-fold input")).toHaveValue("grabfold");
  });
});

test("a PDF is read and turned", async ({ page }) => {
  await page.goto("/examples/pdf/");
  await page.waitForFunction(() => "book" in window, undefined, { timeout: 15_000 });
  await expect(page.locator(".grabfold canvas.pdf").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Next/ }).click();
  await settled(page);
  await expect(page.locator("#where")).toHaveText(/Page 2–3 of 18/);
});

test.describe("how it looks", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "pixels are compared in Chromium only");

  for (const [name, query, grab, to] of [
    ["mid-turn", "position=1", [0.95, 0.85], [0.55, 0.6]],
    ["mid-turn, right to left", "position=1&binding=right", [0.05, 0.85], [0.45, 0.6]],
    ["hard cover", "position=-2&covers=hard", [0.7, 0.5], [0.45, 0.5]],
  ] as const) {
    test(name, async ({ page }) => {
      await page.goto(`/e2e/fixtures/visual.html?${query}`);
      await page.waitForFunction(() => "book" in window);
      const box = await bookBox(page);
      await page.mouse.move(box.x + box.width * grab[0], box.y + box.height * grab[1]);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 12 });
      await page.waitForTimeout(100);
      await expect(page).toHaveScreenshot(`${name}.png`);
      await page.mouse.up();
    });
  }
});

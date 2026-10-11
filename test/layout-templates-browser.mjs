import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../artifacts/playground/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  try {
    const target = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) { res.writeHead(403).end(); return; }
    const body = await readFile(target);
    res.writeHead(200, { "Content-Type": types[path.extname(target)] ?? "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator("#preview svg").waitFor({ timeout: 60000 });
  await page.getByRole("tab", { name: "Design" }).click();
  await page.locator("#custom-layout").click();
  const grid = page.locator("dialog.opf-grid-dialog[open]");
  await grid.getByLabel("Layout ID").fill("review-grid");
  await grid.getByLabel("Name", { exact: true }).fill("Review grid");
  await grid.getByLabel("Summary").fill("Recommendation with notes");
  await grid.getByLabel("Paint area").fill("notes");
  await grid.locator(".opf-grid-cell").nth(5).click();
  await grid.locator(".opf-grid-cell").nth(8).click();
  await grid.getByRole("button", { name: "Save layout" }).click();
  await page.waitForFunction(() => !document.querySelector("dialog.opf-grid-dialog"));
  const readDoc = async () => JSON.parse(await page.locator("#json").inputValue());
  let document = await readDoc();
  assert.deepEqual(document.catalogs.custom.layouts["review-grid"].areas, ["title title title", "content content notes", "content content notes"]);
  await page.locator("#choose-layout").click();
  const picker = page.locator("dialog.opf-layout-dialog[open]");
  await picker.getByPlaceholder("Filter layouts").fill("review-grid");
  assert.equal(await picker.locator("optgroup[label='Custom layouts'] option").count(), 1);
  assert.ok(await picker.locator(".opf-layout-diagram span").count() >= 3, "template diagram is shown");
  assert.ok(await picker.locator(".opf-layout-current svg").count() === 1, "current content is previewed");
  await picker.getByRole("button", { name: "Use layout" }).click();
  document = await readDoc();
  assert.equal(document.slides[0].layout, "review-grid");
  await page.locator("#arrange").click();
  const target = page.locator(".opf-region-drop[data-opf-region='notes']");
  await target.waitFor();
  assert.match(await target.textContent(), /Drop content here/);
  await target.press("Enter");
  await target.getByRole("button", { name: "Block 1" }).click();
  await page.waitForFunction(() => JSON.parse(document.querySelector("#json").value).slides[0].blocks[0].region === "notes");
  document = await readDoc();
  assert.equal(document.slides[0].blocks[0].region, "notes");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(() => !JSON.parse(document.querySelector("#json").value).slides[0].blocks[0].region);
  assert.deepEqual(errors, []);
  console.log("0.19 layout browser: custom grid, grouped picker, live preview, region placement and undo passed");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

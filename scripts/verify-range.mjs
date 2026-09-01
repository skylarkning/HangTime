// Smoke test for the chart range controls: preset windows, drag-to-zoom, and
// the Fx release-cycle overlay toggle, on both the overview volume chart and a
// hang's history chart. Drives system Chrome via puppeteer-core.
import puppeteer from "puppeteer-core";

// Both routes are exercised, so take the origin and pick the hash per section.
const BASE = (process.env.VERIFY_URL ?? "http://localhost:4173/").split("#")[0];
const CHROME =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Drag horizontally across the middle of an element, from `from` to `to` (0-1). */
async function drag(page, selector, from, to) {
  const box = await (await page.$(selector)).boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, y, { steps: 12 });
  await page.mouse.up();
}

const canvasHash = (page, selector) =>
  page.$eval(selector, (c) => c.toDataURL().length + ":" + c.toDataURL().slice(-64));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  // -- Overview volume chart ------------------------------------------------
  await page.goto(`${BASE}#/`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector(".ov-chart canvas", { timeout: 60000 });

  const presets = await page.$$eval(".ov-card .ts-toggle.range button", (bs) =>
    bs.map((b) => b.textContent.trim()),
  );
  check(
    "overview presets rendered",
    presets.includes("7d") && presets.includes("30d") && presets.length >= 3,
    presets.join(" "),
  );

  // The infotip names the visible span, so it doubles as a readout.
  const readSpan = async () => {
    await page.click(".ov-card-head .infotip-btn");
    const text = await page.$eval(".infotip-pop", (e) => e.textContent);
    await page.keyboard.press("Escape");
    return text.match(/over (\d+) days \(([^)]+)\)/);
  };

  const before = await readSpan();
  check("full window shown by default", !!before && +before[1] > 30, before?.[0]);

  const beforePixels = await canvasHash(page, ".ov-chart canvas");
  await page.$$eval(".ov-card .ts-toggle.range button", (bs) =>
    bs.find((b) => b.textContent.trim() === "30d").click(),
  );
  await new Promise((r) => setTimeout(r, 1200));
  const after = await readSpan();
  check("30d preset narrows the window", after?.[1] === "30", after?.[0]);
  check(
    "chart redrew for the new range",
    beforePixels !== (await canvasHash(page, ".ov-chart canvas")),
  );

  await drag(page, ".ov-chart", 0.25, 0.7);
  await new Promise((r) => setTimeout(r, 1200));
  const dragged = await readSpan();
  const hasReset = await page.$$eval(".ov-card .ts-toggle.range button", (bs) =>
    bs.some((b) => b.textContent.trim() === "reset"),
  );
  check(
    "drag zooms into the selection",
    dragged && +dragged[1] < 30 && +dragged[1] > 1,
    `${dragged?.[1]} days`,
  );
  check("reset offered once zoomed off a preset", hasReset);

  await page.$$eval(".ov-card .ts-toggle.range button", (bs) =>
    bs.find((b) => b.textContent.trim() === "reset").click(),
  );
  await new Promise((r) => setTimeout(r, 1200));
  const restored = await readSpan();
  check("reset restores the full window", restored?.[1] === before?.[1], restored?.[0]);

  // -- Hang history chart ---------------------------------------------------
  await page.goto(`${BASE}#/top-hangs`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("table.hangs tbody tr", { timeout: 60000 });
  await page.click("table.hangs tbody tr");
  await page.waitForSelector(".ts-chart canvas", { timeout: 20000 });

  const historyDays = () =>
    page.$eval(".ts-header h3", (h) => +h.textContent.match(/\((\d+) days\)/)[1]);

  const fullDays = await historyDays();
  check("history shows the full window", fullDays === +before[1], `${fullDays} days`);

  await page.$$eval(".ts-header .ts-toggle.range button", (bs) =>
    bs.find((b) => b.textContent.trim() === "30d").click(),
  );
  await new Promise((r) => setTimeout(r, 1200));
  check("history 30d preset applies", (await historyDays()) === 30);

  const boxDefault = await page.$eval(".chart-check input", (i) => i.checked);
  check("Fx release overlay off by default", boxDefault === false);

  const noMarkers = await canvasHash(page, ".ts-chart canvas");
  await page.click(".chart-check input");
  await new Promise((r) => setTimeout(r, 1200));
  const withMarkers = await canvasHash(page, ".ts-chart canvas");
  check("Fx release overlay draws when ticked", noMarkers !== withMarkers);
  await page.click(".chart-check input");
  await new Promise((r) => setTimeout(r, 1200));
  check("unticking removes it again", (await canvasHash(page, ".ts-chart canvas")) === noMarkers);

  await drag(page, ".ts-chart", 0.3, 0.75);
  await new Promise((r) => setTimeout(r, 1200));
  const zoomedDays = await historyDays();
  check("history drag zooms", zoomedDays < 30 && zoomedDays > 1, `${zoomedDays} days`);

  console.log(errors.length ? `CONSOLE_ERRORS:\n  ${errors.join("\n  ")}` : "CONSOLE_ERRORS: none");
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exitCode = failed === 0 && errors.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}

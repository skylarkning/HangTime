// Smoke test for the timeseries chart: load the dashboard, select the first
// hang, and confirm the History section + a chart canvas render with no console
// errors. Drives system Chrome via puppeteer-core.
import puppeteer from "puppeteer-core";

const URL = process.env.VERIFY_URL ?? "http://localhost:4173/";
const CHROME =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("table.hangs tbody tr", { timeout: 20000 });
  await page.click("table.hangs tbody tr");

  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".detail-section h3")].some((h) =>
        h.textContent.includes("History"),
      ),
    { timeout: 10000 },
  );
  const hasCanvas = await page.$(".ts-chart canvas");
  const result = await page.evaluate(() => {
    const headers = [...document.querySelectorAll(".detail-section h3")].map(
      (h) => h.textContent.trim(),
    );
    const muted = document.querySelector(".ts-chart")
      ? null
      : document.querySelector(".detail-section .muted")?.textContent ?? null;
    return { headers, muted };
  });

  console.log("HISTORY_HEADERS:", JSON.stringify(result.headers));
  console.log("CANVAS_PRESENT:", !!hasCanvas);
  console.log("FALLBACK_MSG:", result.muted);
  if (errors.length) {
    console.log("CONSOLE_ERRORS:");
    for (const e of errors) console.log("  -", e);
  } else {
    console.log("CONSOLE_ERRORS: none");
  }
  process.exitCode = hasCanvas && errors.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}

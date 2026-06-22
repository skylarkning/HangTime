// Real-browser smoke test: loads the dashboard, waits for the hang table to
// render (proving fetch -> worker -> React all work), and reports console
// errors + a few extracted rows. Drives the system Chrome via puppeteer-core.
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

  let result = "timeout";
  try {
    await page.waitForSelector("table.hangs tbody tr", { timeout: 20000 });
    result = "rendered";
  } catch {
    result = "no-rows";
  }

  const summary = await page.evaluate(() => {
    const summaryEl = document.querySelector(".filter-bar .summary");
    const rows = [...document.querySelectorAll("table.hangs tbody tr")]
      .slice(0, 3)
      .map((tr) =>
        [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()),
      );
    const stateMsg = document.querySelector(".state-msg")?.textContent ?? null;
    return { summary: summaryEl?.textContent ?? null, rows, stateMsg };
  });

  console.log("RESULT:", result);
  console.log("SUMMARY:", summary.summary);
  console.log("STATE_MSG:", summary.stateMsg);
  console.log("FIRST_ROWS:", JSON.stringify(summary.rows, null, 2));
  if (errors.length) {
    console.log("CONSOLE_ERRORS:");
    for (const e of errors) console.log("  -", e);
  } else {
    console.log("CONSOLE_ERRORS: none");
  }
  process.exitCode = result === "rendered" ? 0 : 1;
} finally {
  await browser.close();
}

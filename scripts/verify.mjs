// Real-browser smoke test: loads the dashboard, waits for the hang table to
// render (proving fetch -> worker -> React all work), and reports console
// errors + a few extracted rows. Drives the system Chrome via puppeteer-core.
import puppeteer from "puppeteer-core";

const URL = process.env.VERIFY_URL ?? "http://localhost:4173/#/top-hangs";
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

  // Row paging: 50 up front, +50 per "show more" click.
  const dataRows = () =>
    page.$$eval("table.hangs tbody tr:not(.footer)", (rs) => rs.length);
  const showMore = async () => {
    await page.click("table.hangs tr.footer .more");
    await new Promise((r) => setTimeout(r, 300));
  };
  const paging = [await dataRows()];
  if (paging[0] === 50) {
    await showMore();
    paging.push(await dataRows());
    await showMore();
    paging.push(await dataRows());
  }
  const pagingOk = String(paging) === "50,100,150";

  // The overview's two-column grid has to fit the viewport at any width.
  const overflow = [];
  for (const width of [1100, 1280, 1440]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${URL.split("#")[0]}#/`, { waitUntil: "networkidle2" });
    await page.waitForSelector(".ov-chart canvas", { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 400));
    const fits = await page.evaluate(() => {
      const ov = document.querySelector(".overview");
      const cards = [...document.querySelectorAll(".ov-grid > *")];
      return (
        ov.scrollWidth <= ov.clientWidth &&
        cards.every((c) => c.getBoundingClientRect().right <= window.innerWidth)
      );
    });
    overflow.push(`${width}:${fits ? "fits" : "OVERFLOWS"}`);
  }
  const layoutOk = overflow.every((o) => o.endsWith("fits"));

  console.log("RESULT:", result);
  console.log("PAGING:", paging.join(" -> "), pagingOk ? "(ok)" : "(FAILED)");
  console.log("OVERVIEW_FITS:", overflow.join(" "), layoutOk ? "(ok)" : "(FAILED)");
  console.log("SUMMARY:", summary.summary);
  console.log("STATE_MSG:", summary.stateMsg);
  console.log("FIRST_ROWS:", JSON.stringify(summary.rows, null, 2));
  if (errors.length) {
    console.log("CONSOLE_ERRORS:");
    for (const e of errors) console.log("  -", e);
  } else {
    console.log("CONSOLE_ERRORS: none");
  }
  process.exitCode = result === "rendered" && pagingOk && layoutOk ? 0 : 1;
} finally {
  await browser.close();
}

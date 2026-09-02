// Smoke test for one-click bug filing: the component picker is populated from
// Bugzilla, preselected with the classifier's suggestion, overridable, and the
// file button links straight at that product/component with the bug prefilled.
// Drives system Chrome via puppeteer-core.
import puppeteer from "puppeteer-core";

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
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}#/top-hangs`, { waitUntil: "networkidle2", timeout: 90000 });
  await page.waitForSelector("table.hangs tbody tr", { timeout: 90000 });

  // Walk the first rows until one isn't already tracked by a bug (those show a
  // "already tracked" note instead of the picker).
  let found = false;
  for (let row = 1; row <= 6 && !found; row++) {
    await page.click(`table.hangs tbody tr:nth-child(${row})`);
    await new Promise((r) => setTimeout(r, 600));
    found = !!(await page.$(".component-picker"));
  }
  check("picker renders for an untracked hang", found);
  if (!found) {
    throw new Error("no untracked hang in the first rows");
  }

  await page.waitForFunction(
    () => document.querySelectorAll(".component-picker optgroup").length > 0,
    { timeout: 15000 },
  );
  const list = await page.evaluate(() => {
    const sel = document.querySelector(".component-picker");
    return {
      products: [...sel.querySelectorAll("optgroup")].map((g) => g.label),
      options: sel.querySelectorAll("option").length,
      selected: sel.value,
      productLabel: document.querySelector(".component-product")?.textContent ?? "",
      why: document.querySelector(".bug-why")?.textContent ?? "",
      prompt: document.querySelector(".detail-section p.muted")?.textContent ?? "",
    };
  });
  check(
    "component list came from Bugzilla",
    list.products.length === 5 && list.options > 200,
    `${list.products.join(", ")} · ${list.options} options`,
  );
  check("a component is preselected", /.+\|.+/.test(list.selected), list.selected);
  check(
    "product shown next to the picker",
    list.productLabel.startsWith(list.selected.split("|")[0]),
    list.productLabel,
  );
  check(
    "suggestion is explained",
    /confidence/.test(list.why) && /matched/.test(list.why),
    list.why.replace(/\s+/g, " ").trim().slice(0, 90),
  );
  check(
    "prompt wording present",
    list.prompt.includes("HangTime has suggested the following component"),
  );

  // The file button must carry product + component and the prefilled fields.
  const href = await page.$eval(".report-actions a.btn", (a) => a.href);
  const url = new URL(href);
  const [wantProduct, wantComponent] = list.selected.split("|");
  check(
    "file link targets the selected component",
    url.searchParams.get("product") === wantProduct &&
      url.searchParams.get("component") === wantComponent,
    `${url.searchParams.get("product")} :: ${url.searchParams.get("component")}`,
  );
  check(
    "bug is prefilled",
    !!url.searchParams.get("short_desc") &&
      !!url.searchParams.get("comment") &&
      /^\[bhr:.+\]$/.test(url.searchParams.get("status_whiteboard") ?? ""),
    url.searchParams.get("status_whiteboard") ?? "",
  );
  check(
    "button names the destination",
    (await page.$eval(".report-actions a.btn", (a) => a.textContent)).includes(
      wantComponent,
    ),
  );

  // Overriding the suggestion must retarget the link.
  const other = await page.$eval(".component-picker", (sel) => {
    const opt = [...sel.querySelectorAll("option")].find(
      (o) => o.value && o.value !== sel.value,
    );
    return opt.value;
  });
  await page.select(".component-picker", other);
  await new Promise((r) => setTimeout(r, 300));
  const href2 = await page.$eval(".report-actions a.btn", (a) => a.href);
  const url2 = new URL(href2);
  check(
    "override retargets the link",
    `${url2.searchParams.get("product")}|${url2.searchParams.get("component")}` === other,
    other,
  );

  // Bugzilla has to accept that component and echo the prefill back: a real
  // entry form, not the product chooser that drops every prefilled field.
  // Fetched from node -- Bugzilla's HTML pages send no CORS headers.
  const res = await fetch(href);
  const html = await res.text();
  check(
    "Bugzilla renders the prefilled entry form",
    res.ok &&
      html.includes(url.searchParams.get("short_desc")) &&
      html.includes(url.searchParams.get("status_whiteboard")) &&
      html.includes(wantComponent),
    `HTTP ${res.status}, ${html.length} bytes`,
  );

  console.log(errors.length ? `CONSOLE_ERRORS:\n  ${errors.join("\n  ")}` : "CONSOLE_ERRORS: none");
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exitCode = failed === 0 && errors.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}

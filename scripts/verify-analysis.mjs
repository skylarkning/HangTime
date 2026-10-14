import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const uri = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
function compile(path, transform = (source) => source) {
  return ts.transpileModule(transform(readFileSync(new URL(path, import.meta.url), "utf8")), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

try {
  const format = uri(compile("../src/format.ts"));
  const keys = uri(compile("../src/processing/signatureKey.ts"));
  const { computeTrend } = await import(uri(compile("../src/data/trend.ts").replace('"@/format"', JSON.stringify(format))));
  const { TimeseriesIndex } = await import(uri(compile("../src/data/timeseries.ts", (source) =>
    source.replace('const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? "data";', 'const DATA_BASE = "data";'),
  ).replace('"@/processing/signatureKey"', JSON.stringify(keys))));

  const make = (count, dayHasData) => ({
    dates: Array.from({ length: 14 }, (_, i) => `202610${String(i + 1).padStart(2, "0")}`),
    total: { count, ms: count.map((value) => value === null ? null : value * 1000) },
    dayHasData, members: [],
  });
  assert.equal(computeTrend(make([...Array(7).fill(100), ...Array(7).fill(null)], Array(14).fill(true)), "count").state, "below-cut");
  assert.equal(computeTrend(make([...Array(7).fill(null), ...Array(7).fill(100)], [...Array(7).fill(false), ...Array(7).fill(true)]), "count").state, "baseline-unavailable");
  assert.equal(computeTrend(make([...Array(7).fill(100), 200, ...Array(6).fill(null)], Array(14).fill(true)), "count").state, "incomplete");

  // A bug with one tracked member must contribute that member's time, not all its time.
  const signature = {
    stackKey: "0,1", memberStackKeys: ["0,1", "2,1"], memberStackMs: [70, 30],
    memberStackCounts: [7, 3], duration: 100, count: 10,
  };
  const index = new TimeseriesIndex({
    dates: ["20261010"], signatures: [{ frames: [["read Foo.js:20", ""], ["root", ""]], ms: [70], count: [7], totalMs: 70, totalCount: 7 }],
  });
  index.bind({ date: "20261010", funcNames: ["read Foo.js:10", "root", "other"], libNames: ["", "", ""], signatures: [signature] });
  assert.equal(index.coverageForSignature(signature).share, 0.7);
  assert.equal(index.resolveSignature(signature).coverage.share, 0.7);
  assert.equal(index.coverageForSignature({ stackKey: "2,1", duration: 30, count: 3 }).share, 0);
  console.log("Analysis checks: missing-data states and weighted history coverage passed (6 assertions).");
} catch (error) {
  // Avoid dumping data-URL module source into diagnostics.
  console.error(error.message);
  process.exitCode = 1;
}

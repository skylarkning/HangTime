import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/popoverPosition.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { placePopover } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

// Check containment at every corner, with short and viewport-taller explanations.
for (const viewport of [{ width: 320, height: 480 }, { width: 1440, height: 900 }, { width: 240, height: 150 }]) {
  for (const left of [0, viewport.width - 17]) {
    for (const top of [0, viewport.height - 17]) {
      for (const contentHeight of [90, 260, 1200]) {
        const result = placePopover({ left, top, bottom: top + 17 }, viewport, contentHeight);
        const height = Math.min(contentHeight, result.maxHeight);
        assert.ok(result.left >= 12 && result.left + result.width <= viewport.width - 12);
        assert.ok(result.top >= 12 && result.top + height <= viewport.height - 12);
      }
    }
  }
}
const viewport = { width: 1200, height: 900 };
assert.equal(placePopover({ left: 20, top: 20, bottom: 37 }, viewport, 100).top, 45, "use room below the trigger");
assert.equal(placePopover({ left: 20, top: 800, bottom: 817 }, viewport, 100).top, 692, "flip above a bottom-edge trigger");
console.log("Popover placement: all 38 containment and placement cases passed.");

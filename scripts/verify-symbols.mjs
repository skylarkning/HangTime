import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(readFileSync(new URL("../src/frames.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { shortSymbol, representativeFrameDepth } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
assert.equal(shortSymbol("CThreadInputMgr::PeekMessageW(tagMSG*, HWND__*, unsigned int)"), "CThreadInputMgr::PeekMessageW");
assert.equal(shortSymbol("mozilla::Task<void(int)>::Run(bool) const"), "mozilla::Task<void(int)>::Run");
assert.equal(shortSymbol("Task::operator()(int) const"), "Task::operator()");
assert.equal(shortSymbol("Stream::operator<<(int)"), "Stream::operator<<");
assert.equal(shortSymbol("(anonymous namespace)::Task::Run(int)"), "(anonymous namespace)::Task::Run");
assert.equal(shortSymbol("write SessionWriter.sys.mjs:167:4"), "write");
assert.equal(shortSymbol("memcpy"), "memcpy");
const frames = ["WaitOnAddress", "FutexImpl::wait()", "mozilla::scache::StartupCache::GetBuffer(char*)"].map(funcName => ({ funcName }));
const kind = { mechanism: "lock-wait", mechanismFrame: 0, callerFrame: 2 };
assert.equal(representativeFrameDepth(kind, frames), 2, "prefer the actual caller over a generic wait");
assert.equal(representativeFrameDepth({ ...kind, callerFrame: -1 }, frames), 0, "retain the observed wait when no caller is known");
assert.equal(representativeFrameDepth({ ...kind, mechanism: "event-loop" }, frames), 0, "retain a meaningful native event-loop symbol");
assert.equal(representativeFrameDepth({ ...kind, mechanism: "serialization", mechanismFrame: 1 }, frames), 1, "retain substantive work rather than the primitive at frame zero");
assert.equal(representativeFrameDepth(kind, []), -1);
console.log("Symbol display: argument shortening, native landmarks and primitive caller selection passed (12 assertions).");

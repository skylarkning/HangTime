import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(readFileSync(new URL("../src/frames.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { shortSymbol, leafFrameDepth } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
assert.equal(shortSymbol("CThreadInputMgr::PeekMessageW(tagMSG*, HWND__*, unsigned int)"), "CThreadInputMgr::PeekMessageW");
assert.equal(shortSymbol("mozilla::Task<void(int)>::Run(bool) const"), "mozilla::Task<void(int)>::Run");
assert.equal(shortSymbol("Task::operator()(int) const"), "Task::operator()");
assert.equal(shortSymbol("Stream::operator<<(int)"), "Stream::operator<<");
assert.equal(shortSymbol("(anonymous namespace)::Task::Run(int)"), "(anonymous namespace)::Task::Run");
assert.equal(shortSymbol("write SessionWriter.sys.mjs:167:4"), "write");
assert.equal(shortSymbol("memcpy"), "memcpy");
const frames = ["WaitOnAddress", "FutexImpl::wait()", "mozilla::scache::StartupCache::GetBuffer(char*)"].map(funcName => ({ funcName }));
assert.equal(leafFrameDepth(frames), 0, "use the recorded wait rather than choosing its caller");
assert.equal(leafFrameDepth([{funcName: "NtCreateFile"}, {funcName: "OpenFile"}]), 0, "CreateFile is not renamed to its OpenFile caller");
assert.equal(leafFrameDepth([]), -1);
console.log("Symbol display: shortening utilities and original leaf selection passed.");

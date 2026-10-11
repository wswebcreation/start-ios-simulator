import assert from "node:assert/strict";
import { test } from "node:test";
import { run, runFile, runFileAsync } from "../src/shell.ts";

test("run returns the trimmed output, or null when the command fails", () => {
  assert.equal(run(`"${process.execPath}" -p "1+1"`), "2");
  assert.equal(run("this-command-does-not-exist-123"), null);
});

test("runFile returns output and exit code", () => {
  assert.deepEqual(runFile(process.execPath, ["-p", "'hi'"]), { output: "hi", exitCode: 0 });
  assert.equal(runFile(process.execPath, ["-e", "process.exit(3)"]).exitCode, 3);
});

test("runFile reports a missing executable as a failure", () => {
  assert.equal(runFile("/does/not/exist").exitCode, 1);
});

test("runFileAsync does the same without blocking, and stops a program that takes too long", async () => {
  assert.deepEqual(await runFileAsync(process.execPath, ["-p", "'hi'"]), { output: "hi", exitCode: 0 });
  assert.equal((await runFileAsync(process.execPath, ["-e", "console.error('oops'); process.exit(4)"])).exitCode, 4);
  const slow = await runFileAsync(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { timeout: 100 });
  assert.notEqual(slow.exitCode, 0);
  await assert.rejects(runFileAsync("/does/not/exist"));
});

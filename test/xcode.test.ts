import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, mock, test } from "node:test";

const result = (output = "", exitCode = 0) => ({ output, exitCode });
const run = mock.fn((_cmd: string): string | null => null);
const runFile = mock.fn((_file: string, _args?: string[], _options?: unknown) => result());
mock.module("../src/shell.ts", { namedExports: { IS_MAC: true, run, runFile, runFileAsync: async () => result() } });
const xcode = await import("../src/ios/xcode.ts");

const root = mkdtempSync(join(tmpdir(), "start-ios-simulator-xcode-"));
after(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  run.mock.resetCalls();
  runFile.mock.resetCalls();
  runFile.mock.mockImplementation(() => result());
});

test("Xcode is found by its version, and the selected folder", () => {
  run.mock.mockImplementation((cmd) => (cmd === "xcodebuild -version" ? "Xcode 27.0\nBuild version 27A266a" : "/Applications/Xcode.app/Contents/Developer"));
  assert.deepEqual(xcode.detectXcode(), { version: "27.0", path: "/Applications/Xcode.app/Contents/Developer" });
});

test("without Xcode (only the command line tools) there is nothing", () => {
  run.mock.mockImplementation(() => null);
  assert.equal(xcode.detectXcode(), null);
  run.mock.mockImplementation(() => "xcode-select: error");
  assert.equal(xcode.detectXcode(), null);
});

test("the iOS version of Xcode is the version of its simulator SDK", () => {
  run.mock.mockImplementation(() => "27.0");
  assert.equal(xcode.simulatorSdkVersion(), "27.0");
  assert.equal(run.mock.calls[0]!.arguments[0], "xcodebuild -version -sdk iphonesimulator ProductVersion");
  run.mock.mockImplementation(() => null);
  assert.equal(xcode.simulatorSdkVersion(), null);
});

test("the licence and the first launch are checked with xcodebuild", () => {
  assert.equal(xcode.licenseAccepted(), true);
  assert.equal(xcode.firstLaunchDone(), true);
  runFile.mock.mockImplementation(() => result("", 69));
  assert.equal(xcode.licenseAccepted(), false);
  assert.equal(xcode.firstLaunchDone(), false);
});

test("Xcode apps are found in the applications folder, also betas", () => {
  for (const name of ["Xcode.app", "Xcode-beta.app", "Safari.app", "Xcode.txt"]) mkdirSync(join(root, name));
  assert.deepEqual(xcode.findXcodeApps(root).map((p) => p.slice(root.length + 1)).sort(), ["Xcode-beta.app", "Xcode.app"]);
  assert.deepEqual(xcode.findXcodeApps(join(root, "missing")), []);
});

test("accepting the licence and selecting Xcode run with sudo in the terminal of the user", () => {
  assert.equal(xcode.acceptLicenseAndInstallComponents(), true);
  assert.deepEqual(runFile.mock.calls.map((c) => c.arguments), [
    ["sudo", ["xcodebuild", "-license", "accept"], { inherit: true }],
    ["sudo", ["xcodebuild", "-runFirstLaunch"], { inherit: true }],
  ]);

  runFile.mock.resetCalls();
  runFile.mock.mockImplementation(() => result("", 1));
  assert.equal(xcode.acceptLicenseAndInstallComponents(), false);
  assert.equal(runFile.mock.callCount(), 1, "the second command does not run after the first one failed");

  runFile.mock.resetCalls();
  xcode.selectXcode("/Applications/Xcode.app");
  assert.deepEqual(runFile.mock.calls[0]!.arguments[1], ["xcode-select", "-s", "/Applications/Xcode.app/Contents/Developer"]);
});

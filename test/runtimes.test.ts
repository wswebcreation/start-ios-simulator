import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, mock, test } from "node:test";

const result = (output = "", exitCode = 0) => ({ output, exitCode });
const runFile = mock.fn((_file: string, _args?: string[], _options?: unknown) => result());
mock.module("../src/shell.ts", { namedExports: { IS_MAC: true, run: () => null, runFile, runFileAsync: async () => result() } });
const runtimes = await import("../src/ios/runtimes.ts");

const root = mkdtempSync(join(tmpdir(), "start-ios-simulator-runtimes-"));
after(() => rmSync(root, { recursive: true, force: true }));

const runtime = (version: string, extra = {}) => ({
  platform: "iOS",
  version,
  identifier: `com.apple.CoreSimulator.SimRuntime.iOS-${version.replace(".", "-")}`,
  isAvailable: true,
  supportedDeviceTypes: [{ name: "iPhone 17 Pro", identifier: "id-17-pro", productFamily: "iPhone" }],
  ...extra,
});

beforeEach(() => {
  runFile.mock.resetCalls();
  runFile.mock.mockImplementation(() => result());
});

test("only available iOS runtimes are listed, the newest first, with the devices they can run", () => {
  const list = runtimes.parseRuntimes({ runtimes: [runtime("9.5"), runtime("27.0"), runtime("26.4"), { ...runtime("26.0"), isAvailable: false }, { ...runtime("12.0"), platform: "tvOS" }] });
  assert.deepEqual(list.map((r) => r.version), ["27.0", "26.4", "9.5"]);
  assert.deepEqual(list[0]!.deviceTypes, [{ name: "iPhone 17 Pro", identifier: "id-17-pro", family: "iPhone" }]);
  assert.deepEqual(runtimes.parseRuntimes(null), []);
});

test("the identifier of a runtime is built from its version", () => {
  assert.equal(runtimes.runtimeId("27.0"), "com.apple.CoreSimulator.SimRuntime.iOS-27-0");
  assert.equal(runtimes.runtimeId("18.6.1"), "com.apple.CoreSimulator.SimRuntime.iOS-18-6-1");
});

test("listRuntimes is null when simctl does not work, and hasRuntime then says no", () => {
  runFile.mock.mockImplementation(() => result(JSON.stringify({ runtimes: [runtime("27.0")] })));
  assert.equal(runtimes.listRuntimes()!.length, 1);
  assert.equal(runtimes.hasRuntime("27.0"), true);
  assert.equal(runtimes.hasRuntime("26.0"), false);
  runFile.mock.mockImplementation(() => result("not json"));
  assert.equal(runtimes.listRuntimes(), null);
  assert.equal(runtimes.hasRuntime("27.0"), false);
});

test("the download asks for the matching architecture, and for a version only when one is wanted", () => {
  assert.equal(runtimes.downloadRuntime(null), true);
  const [file, args, options] = runFile.mock.calls[0]!.arguments;
  assert.equal(file, "xcodebuild");
  assert.deepEqual(args!.slice(0, 2), ["-downloadPlatform", "iOS"]);
  assert.ok(args!.includes("-architectureVariant"));
  assert.ok(!args!.includes("-buildVersion"));
  assert.deepEqual(options, { inherit: true });

  runtimes.downloadRuntime("26.4");
  assert.deepEqual(runFile.mock.calls[1]!.arguments[1]!.slice(-2), ["-buildVersion", "26.4"]);
  runFile.mock.mockImplementation(() => result("", 1));
  assert.equal(runtimes.downloadRuntime(null), false);
});

test("a runtime that was downloaded but not registered is added from its disk image", () => {
  const stuck = join(root, "runtime");
  mkdirSync(join(stuck, "Restore"), { recursive: true });
  writeFileSync(join(stuck, "Restore", "iOS.dmg"), "");
  const image = { runtimeIdentifier: runtimes.runtimeId("27.0"), state: "Ready", signatureState: "Invalid", path: stuck };
  let registered = false;
  runFile.mock.mockImplementation((_file, args = []) => {
    if (args[1] === "runtime" && args[2] === "list") return result(JSON.stringify({ A: image }));
    if (args[2] === "add") {
      registered = true;
      return result();
    }
    if (args[1] === "list") return result(JSON.stringify({ runtimes: registered ? [runtime("27.0")] : [] }));
    return result();
  });
  assert.equal(runtimes.registerDownloadedRuntime("27.0"), true);
  assert.ok(runFile.mock.calls.some((c) => c.arguments[1]!.join(" ") === `simctl runtime add ${join(stuck, "Restore", "iOS.dmg")}`));
});

test("there is nothing to register when no runtime is stuck, or the disk image is missing", () => {
  runFile.mock.mockImplementation(() => result(JSON.stringify({})));
  assert.equal(runtimes.registerDownloadedRuntime("27.0"), false);

  const image = { runtimeIdentifier: runtimes.runtimeId("27.0"), state: "Ready", signatureState: "Invalid", path: join(root, "nothing-here") };
  runFile.mock.mockImplementation(() => result(JSON.stringify({ A: image })));
  assert.equal(runtimes.registerDownloadedRuntime("27.0"), false);
  const verified = { ...image, signatureState: "Verified" };
  runFile.mock.mockImplementation(() => result(JSON.stringify({ A: verified })));
  assert.equal(runtimes.registerDownloadedRuntime("27.0"), false);
});

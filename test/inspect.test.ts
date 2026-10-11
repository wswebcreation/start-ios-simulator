import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

const result = (output = "", exitCode = 0) => ({ output, exitCode });
const runtime = {
  platform: "iOS",
  version: "27.0",
  identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0",
  isAvailable: true,
  supportedDeviceTypes: [{ name: "iPhone 18 Pro", identifier: "id", productFamily: "iPhone" }],
};
const devices = { devices: { "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [{ udid: "U", name: "iPhone 18 Pro", state: "Shutdown", isAvailable: true }] } };

let commands: Record<string, string | null>;
let files: Record<string, { output: string; exitCode: number }>;
const runAsync = mock.fn(async (cmd: string) => commands[cmd] ?? null);
const runFileAsync = mock.fn(async (file: string, args: string[] = []) => files[`${file} ${args.join(" ")}`] ?? result("", 1));
mock.module("../src/shell.ts", { namedExports: { IS_MAC: true, run: () => null, runAsync, runFileAsync, runFile: () => result() } });
const { inspect } = await import("../src/ios/inspect.ts");

beforeEach(() => {
  runAsync.mock.resetCalls();
  runFileAsync.mock.resetCalls();
  commands = {
    "xcodebuild -version": "Xcode 27.0\nBuild version 27A266a",
    "xcode-select -p": "/Applications/Xcode.app/Contents/Developer",
    "xcodebuild -version -sdk iphonesimulator ProductVersion": "27.0",
  };
  files = {
    "xcodebuild -license check": result(),
    "xcodebuild -checkFirstLaunchStatus": result(),
    "xcrun simctl list runtimes -j": result(JSON.stringify({ runtimes: [runtime] })),
    "xcrun simctl list devices -j": result(JSON.stringify(devices)),
  };
});

test("a complete machine is reported as it is", async () => {
  assert.deepEqual(await inspect(), {
    xcode: { version: "27.0", path: "/Applications/Xcode.app/Contents/Developer" },
    xcodeApps: [],
    licenseReady: true,
    sdkVersion: "27.0",
    runtimes: [{ version: "27.0", identifier: runtime.identifier, deviceTypes: [{ name: "iPhone 18 Pro", identifier: "id", family: "iPhone" }] }],
    simulators: [{ udid: "U", name: "iPhone 18 Pro", version: "27.0", booted: false }],
    deviceTypes: [{ name: "iPhone 18 Pro", identifier: "id", family: "iPhone" }],
  });
});

test("without Xcode (only the command line tools) nothing else is asked", async () => {
  commands["xcodebuild -version"] = null;
  const state = await inspect();
  assert.equal(state.xcode, null);
  assert.equal(state.licenseReady, false);
  assert.equal(state.sdkVersion, null);
  assert.deepEqual([state.runtimes, state.simulators, state.deviceTypes], [[], [], []]);
  assert.equal(runFileAsync.mock.callCount(), 0);
  commands["xcodebuild -version"] = "xcode-select: error: tool 'xcodebuild' requires Xcode";
  assert.equal((await inspect()).xcode, null);
});

test("the licence is only ready when the components are installed too", async () => {
  files["xcodebuild -checkFirstLaunchStatus"] = result("", 69);
  assert.equal((await inspect()).licenseReady, false);
  files["xcodebuild -checkFirstLaunchStatus"] = result();
  files["xcodebuild -license check"] = result("", 69);
  assert.equal((await inspect()).licenseReady, false);
});

test("when simctl does not answer there are no runtimes and no simulators", async () => {
  files["xcrun simctl list runtimes -j"] = result("error", 1);
  files["xcrun simctl list devices -j"] = result("not json");
  const state = await inspect();
  assert.deepEqual([state.runtimes, state.simulators, state.deviceTypes], [[], [], []]);
});


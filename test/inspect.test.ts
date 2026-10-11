import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

const deviceTypes = [{ name: "iPhone 18 Pro", identifier: "id", family: "iPhone" }];
const runtimes = [{ version: "27.0", identifier: "x", deviceTypes }];
const simulators = [{ udid: "U", name: "iPhone 18 Pro", version: "27.0", booted: false }];
const detectXcode = mock.fn((): { version: string; path: string | null } | null => ({ version: "27.0", path: "/Xcode/Developer" }));
const findXcodeApps = mock.fn((): string[] => []);
const licenseAccepted = mock.fn(() => true);
const firstLaunchDone = mock.fn(() => true);
const simulatorSdkVersion = mock.fn((): string | null => "27.0");
const listRuntimes = mock.fn((): typeof runtimes | null => runtimes);
const listSimulators = mock.fn((): typeof simulators | null => simulators);

mock.module("../src/ios/xcode.ts", { namedExports: { detectXcode, findXcodeApps, licenseAccepted, firstLaunchDone, simulatorSdkVersion } });
mock.module("../src/ios/runtimes.ts", { namedExports: { listRuntimes } });
mock.module("../src/ios/simulators.ts", { namedExports: { listSimulators } });
const { inspect } = await import("../src/ios/inspect.ts");

beforeEach(() => {
  detectXcode.mock.mockImplementation(() => ({ version: "27.0", path: "/Xcode/Developer" }));
  findXcodeApps.mock.mockImplementation(() => []);
  licenseAccepted.mock.mockImplementation(() => true);
  firstLaunchDone.mock.mockImplementation(() => true);
  simulatorSdkVersion.mock.mockImplementation(() => "27.0");
  listRuntimes.mock.mockImplementation(() => runtimes);
  listSimulators.mock.mockImplementation(() => simulators);
});

test("a complete machine is reported as it is", () => {
  assert.deepEqual(inspect(), {
    xcode: { version: "27.0", path: "/Xcode/Developer" },
    xcodeApps: [],
    licenseReady: true,
    sdkVersion: "27.0",
    runtimes,
    simulators,
    deviceTypes,
  });
});

test("without Xcode nothing else is asked, except where an Xcode app might be", () => {
  detectXcode.mock.mockImplementation(() => null);
  findXcodeApps.mock.mockImplementation(() => ["/Applications/Xcode.app"]);
  listRuntimes.mock.resetCalls();
  const state = inspect();
  assert.equal(state.xcode, null);
  assert.deepEqual(state.xcodeApps, ["/Applications/Xcode.app"]);
  assert.equal(state.licenseReady, false);
  assert.equal(state.sdkVersion, null);
  assert.deepEqual([state.runtimes, state.simulators, state.deviceTypes], [[], [], []]);
  assert.equal(listRuntimes.mock.callCount(), 0);
});

test("the licence is only ready when the components are installed too", () => {
  firstLaunchDone.mock.mockImplementation(() => false);
  assert.equal(inspect().licenseReady, false);
  firstLaunchDone.mock.mockImplementation(() => true);
  licenseAccepted.mock.mockImplementation(() => false);
  assert.equal(inspect().licenseReady, false);
});

test("when simctl does not answer there are no runtimes and no simulators", () => {
  listRuntimes.mock.mockImplementation(() => null);
  listSimulators.mock.mockImplementation(() => null);
  const state = inspect();
  assert.deepEqual([state.runtimes, state.simulators, state.deviceTypes], [[], [], []]);
});

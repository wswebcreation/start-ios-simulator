import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { Inspection } from "../src/ios/inspect.ts";

const realRuntimes = await import("../src/ios/runtimes.ts");
const realSimulators = await import("../src/ios/simulators.ts");
const realXcode = await import("../src/ios/xcode.ts");

const pro = { name: "iPhone 18 Pro", identifier: "id-18-pro", family: "iPhone" };
const runtime27 = { version: "27.0", identifier: realRuntimes.runtimeId("27.0"), deviceTypes: [pro] };

const downloadRuntime = mock.fn((_version: string | null) => true);
const registerDownloadedRuntime = mock.fn((_version: string) => false);
const hasRuntime = mock.fn((_version: string) => false);
const listRuntimes = mock.fn((): (typeof runtime27)[] | null => [runtime27]);
const createSimulator = mock.fn((_name: string, _device: string, _version: string) => ({ output: "", exitCode: 0 }));
const acceptLicenseAndInstallComponents = mock.fn(() => true);
const selectXcode = mock.fn((_app: string) => true);
const inspect = mock.fn((): Pick<Inspection, "xcode"> => ({ xcode: { version: "27.0", path: "/x" } }));

mock.module("../src/ios/runtimes.ts", { namedExports: { ...realRuntimes, downloadRuntime, registerDownloadedRuntime, hasRuntime, listRuntimes } });
mock.module("../src/ios/simulators.ts", { namedExports: { ...realSimulators, createSimulator } });
mock.module("../src/ios/xcode.ts", { namedExports: { ...realXcode, acceptLicenseAndInstallComponents, selectXcode } });
mock.module("../src/ios/inspect.ts", { namedExports: { inspect } });
const { defaultTarget, namedTarget, planIos } = await import("../src/ios/setup.ts");
const { blocking } = await import("../src/plan.ts");
const { settings } = await import("../src/ui.ts");

const sim = (name: string) => ({ udid: `U-${name}`, name, version: "27.0", booted: false });
const complete: Inspection = {
  xcode: { version: "27.0", path: "/Xcode/Developer" },
  xcodeApps: [],
  licenseReady: true,
  sdkVersion: "27.0",
  runtimes: [runtime27],
  simulators: [sim("iPhone 18 Pro")],
  deviceTypes: [pro],
};
const bare: Inspection = { ...complete, xcode: null, licenseReady: false, sdkVersion: null, runtimes: [], simulators: [], deviceTypes: [] };

const plan = (state: Inspection, target = defaultTarget(state, state.sdkVersion)) => planIos(state, target);
const step = (steps: ReturnType<typeof plan>, id: string) => steps.find((s) => s.id === id)!;
let output: string[];

beforeEach(() => {
  for (const fn of [downloadRuntime, registerDownloadedRuntime, hasRuntime, listRuntimes, createSimulator, acceptLicenseAndInstallComponents, selectXcode, inspect]) fn.mock.resetCalls();
  hasRuntime.mock.mockImplementation(() => false);
  listRuntimes.mock.mockImplementation(() => [runtime27]);
  downloadRuntime.mock.mockImplementation(() => true);
  registerDownloadedRuntime.mock.mockImplementation(() => false);
  createSimulator.mock.mockImplementation(() => ({ output: "", exitCode: 0 }));
  inspect.mock.mockImplementation(() => ({ xcode: { version: "27.0", path: "/x" } }));
  settings.yes = true;
  settings.dryRun = false;
  output = [];
  mock.method(console, "log", (...args: unknown[]) => output.push(args.join(" ").replace(/\x1b\[[0-9;]*m/g, "")));
});
afterEach(() => mock.restoreAll());

test("a complete machine has nothing to do", () => {
  const steps = plan(complete);
  assert.deepEqual(steps.map((s) => s.id), ["xcode", "license", "runtime", "simulators"]);
  assert.ok(steps.every((s) => s.done));
  assert.equal(blocking(steps).length, 0);
});

test("a bare machine needs every step", () => {
  const steps = plan(bare, defaultTarget(bare, "27.0"));
  assert.ok(steps.every((s) => !s.done && s.required !== false));
  assert.match(step(steps, "simulators").description, /iPhone_17_Pro_iOS_27_0 \(iPhone 17 Pro\)/, "a known device when we cannot ask the runtime");
  assert.equal(step(steps, "runtime").title, "iOS 27.0 simulator runtime");
  assert.match(step(steps, "xcode").description, /App Store/);
});

test("with simulators there is nothing to create, so the steps before it are not required", () => {
  const state = { ...complete, licenseReady: false, runtimes: [] };
  const steps = plan(state);
  assert.equal(blocking(steps).length, 0);
  assert.equal(step(steps, "license").done, false, "but it is still shown as missing");
});

test("Xcode that is installed but not selected is pointed to, instead of asking for a download", () => {
  const steps = plan({ ...bare, xcodeApps: ["/Applications/Xcode.app"] });
  assert.match(step(steps, "xcode").description, /your terminal does not use it/);
});

test("without a version the runtime step has no version in its name", () => {
  assert.equal(step(plan(bare, defaultTarget(bare, null)), "runtime").title, "iOS simulator runtime");
});

test("named simulators are created when they do not exist yet, the other ones are left alone", () => {
  const state = { ...complete, simulators: [sim("Test_1_iOS_27_0")] };
  const target = namedTarget(state, "27.0", ["Test_1_iOS_{ios}", "Test_2_iOS_{ios}"]);
  assert.deepEqual(target.simulators.map((s) => s.name), ["Test_1_iOS_27_0", "Test_2_iOS_27_0"]);
  const steps = plan(state, target);
  assert.match(step(steps, "simulators").description, /^We create Test_2_iOS_27_0 \(iPhone 18 Pro\)\.$/);
  assert.equal(step(steps, "simulators").done, false);
  assert.equal(step(plan({ ...state, simulators: [sim("Test_1_iOS_27_0"), sim("Test_2_iOS_27_0")] }, target), "simulators").done, true);
});

test("a device can be asked for", () => {
  assert.equal(defaultTarget(complete, "27.0", "iPad Air").simulators[0]!.name, "iPad_Air_iOS_27_0");
  assert.equal(namedTarget(complete, "27.0", ["A"], "iPad Air").simulators[0]!.device, "iPad Air");
});

// ─── the steps themselves ───────────────────────────────────────────────────

test("Xcode cannot be installed for the user, only selected", async () => {
  assert.equal(await step(plan(bare), "xcode").apply(), false);
  assert.match(output.join("\n"), /Xcode is not installed/);
  assert.equal(selectXcode.mock.callCount(), 0);

  const steps = plan({ ...bare, xcodeApps: ["/Applications/Xcode.app"] });
  assert.equal(await step(steps, "xcode").apply(), true);
  assert.deepEqual(selectXcode.mock.calls[0]!.arguments, ["/Applications/Xcode.app"]);

  selectXcode.mock.mockImplementation(() => false);
  assert.equal(await step(steps, "xcode").apply(), false);
  assert.match(output.join("\n"), /sudo xcode-select -s \/Applications\/Xcode\.app\/Contents\/Developer/);
});

test("the licence step needs Xcode, and tells how to do it by hand when it fails", async () => {
  const steps = plan(bare);
  inspect.mock.mockImplementation(() => ({ xcode: null }));
  assert.equal(await step(steps, "license").apply(), false);
  assert.equal(acceptLicenseAndInstallComponents.mock.callCount(), 0);

  inspect.mock.mockImplementation(() => ({ xcode: { version: "27.0", path: "/x" } }));
  assert.equal(await step(steps, "license").apply(), true);
  acceptLicenseAndInstallComponents.mock.mockImplementation(() => false);
  assert.equal(await step(steps, "license").apply(), false);
  assert.match(output.join("\n"), /sudo xcodebuild -license accept[\s\S]*sudo xcodebuild -runFirstLaunch/);
});

test("the runtime is downloaded, and registered by hand when Xcode does not", async () => {
  const steps = plan(bare, defaultTarget(bare, "27.0"));
  hasRuntime.mock.mockImplementation(() => false);
  registerDownloadedRuntime.mock.mockImplementation(() => true);
  assert.equal(await step(steps, "runtime").apply(), true);
  assert.deepEqual(downloadRuntime.mock.calls[0]!.arguments, ["27.0"]);
  assert.equal(registerDownloadedRuntime.mock.callCount(), 1);

  downloadRuntime.mock.resetCalls();
  hasRuntime.mock.mockImplementation(() => true);
  assert.equal(await step(steps, "runtime").apply(), true);
  assert.equal(downloadRuntime.mock.callCount(), 0, "no download for a runtime that is there");
});

test("a runtime that cannot be had stops the setup with a way out", async () => {
  const steps = plan(bare, defaultTarget(bare, "27.0"));
  assert.equal(await step(steps, "runtime").apply(), false);
  assert.match(output.join("\n"), /iOS 27\.0 runtime is not available[\s\S]*Settings > Components/);
});

test("the runtime step needs Xcode and a version", async () => {
  listRuntimes.mock.mockImplementation(() => null);
  assert.equal(await step(plan(bare, defaultTarget(bare, "27.0")), "runtime").apply(), false);
  assert.equal(downloadRuntime.mock.callCount(), 0);

  listRuntimes.mock.mockImplementation(() => []);
  assert.equal(await step(plan(bare, defaultTarget(bare, null)), "runtime").apply(), false);
  assert.match(output.join("\n"), /--ios/);
});

test("the simulators are created with the device and runtime", async () => {
  const state = { ...complete, simulators: [] };
  const target = namedTarget(state, "27.0", ["A_{ios}", "B_{ios}"]);
  assert.equal(await step(plan(state, target), "simulators").apply(), true);
  assert.deepEqual(createSimulator.mock.calls.map((c) => c.arguments), [
    ["A_27_0", "id-18-pro", "27.0"],
    ["B_27_0", "id-18-pro", "27.0"],
  ]);
});

test("a failing simulator is reported, and the others are still tried", async () => {
  const state = { ...complete, simulators: [] };
  createSimulator.mock.mockImplementationOnce(() => ({ output: "Invalid device type", exitCode: 1 }));
  assert.equal(await step(plan(state, namedTarget(state, "27.0", ["A", "B"])), "simulators").apply(), false);
  assert.equal(createSimulator.mock.callCount(), 2);
  assert.match(output.join("\n"), /Creating A failed\s+Invalid device type/);
});

test("a device that this iOS cannot run is explained", async () => {
  const state = { ...complete, simulators: [] };
  assert.equal(await step(plan(state, namedTarget(state, "27.0", ["A"], "iPhone 3G")), "simulators").apply(), false);
  assert.match(output.join("\n"), /iOS 27\.0 cannot run a "iPhone 3G"\. Choose one of: iPhone 18 Pro/);
  assert.equal(createSimulator.mock.callCount(), 0);
});

test("simulators need the runtime first", async () => {
  const state = { ...complete, simulators: [] };
  listRuntimes.mock.mockImplementation(() => []);
  assert.equal(await step(plan(state), "simulators").apply(), false);
  assert.match(output.join("\n"), /Install the iOS simulator runtime first/);
});

test("a dry run says what it would do and changes nothing", async () => {
  settings.dryRun = true;
  const state = { ...bare, xcodeApps: ["/Applications/Xcode.app"] };
  const steps = plan(state, defaultTarget(state, "27.0"));
  for (const s of steps) assert.equal(await s.apply(), true, s.id);
  const text = output.join("\n");
  assert.match(text, /\[dry run\] would run: sudo xcode-select -s \/Applications\/Xcode\.app/);
  assert.match(text, /would run: sudo xcodebuild -license accept/);
  assert.match(text, /would run: xcodebuild -downloadPlatform iOS -buildVersion 27\.0/);
  assert.match(text, /would create iPhone_17_Pro_iOS_27_0/);
  assert.equal(downloadRuntime.mock.callCount() + createSimulator.mock.callCount() + acceptLicenseAndInstallComponents.mock.callCount(), 0);
});

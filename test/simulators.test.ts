import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

const result = (output = "", exitCode = 0) => ({ output, exitCode });
const runFile = mock.fn((_file: string, _args?: string[]) => result());
const runFileAsync = mock.fn(async (_file: string, _args?: string[], _options?: unknown) => result());
const run = mock.fn((_cmd: string): string | null => "/Applications/Xcode.app/Contents/Developer");
mock.module("../src/shell.ts", { namedExports: { IS_MAC: true, run, runFile, runFileAsync } });
const s = await import("../src/ios/simulators.ts");

const device = (name: string, state = "Shutdown", extra = {}) => ({ udid: `UDID-${name}`, name, state, isAvailable: true, ...extra });
const JSON_DEVICES = {
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-26-4": [device("iPhone 17 Pro"), device("iPhone 17")],
    "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [device("iPhone 17 Pro", "Booted"), device("Broken", "Shutdown", { isAvailable: false }), device("iPad (A16)")],
    "com.apple.CoreSimulator.SimRuntime.tvOS-27-0": [device("Apple TV")],
    "com.apple.CoreSimulator.SimRuntime.watchOS-12-0": [device("Apple Watch")],
  },
};

beforeEach(() => {
  runFile.mock.resetCalls();
  runFile.mock.mockImplementation(() => result());
  runFileAsync.mock.resetCalls();
});

test("only available iOS simulators are listed, the newest iOS first and by name within it", () => {
  const sims = s.parseSimulators(JSON_DEVICES);
  assert.deepEqual(sims.map((x) => `${x.name} ${x.version}`), ["iPad (A16) 27.0", "iPhone 17 Pro 27.0", "iPhone 17 26.4", "iPhone 17 Pro 26.4"]);
  assert.equal(sims.find((x) => x.name === "iPhone 17 Pro" && x.version === "27.0")!.booted, true);
  assert.deepEqual(s.parseSimulators({}), []);
  assert.deepEqual(s.parseSimulators(null), []);
});

test("listSimulators asks simctl, and says so when simctl does not work", () => {
  runFile.mock.mockImplementation(() => result(JSON.stringify(JSON_DEVICES)));
  assert.equal(s.listSimulators()!.length, 4);
  assert.deepEqual(runFile.mock.calls[0]!.arguments, ["xcrun", ["simctl", "list", "devices", "-j"]]);
  runFile.mock.mockImplementation(() => result("xcrun: error", 1));
  assert.equal(s.listSimulators(), null);
});

test("a simulator is found by UDID, or by name without caring about case", () => {
  const sims = s.parseSimulators(JSON_DEVICES);
  assert.equal((s.findSimulator(sims, "udid-ipad (a16)") as any).simulator.name, "iPad (A16)");
  assert.equal((s.findSimulator(sims, "IPAD (A16)") as any).simulator.name, "iPad (A16)");
  assert.equal((s.findSimulator(sims, "iPhone 17 Pro (iOS 26.4)") as any).simulator.version, "26.4");
});

test("a name that exists for more iOS versions needs --ios, with 27 meaning every 27.x", () => {
  const sims = s.parseSimulators(JSON_DEVICES);
  assert.match((s.findSimulator(sims, "iPhone 17 Pro") as any).error, /2 simulators called "iPhone 17 Pro": iOS 27.0, iOS 26.4. Add --ios/);
  assert.equal((s.findSimulator(sims, "iPhone 17 Pro", "26") as any).simulator.version, "26.4");
  assert.equal((s.findSimulator(sims, "iPhone 17 Pro", "27.0") as any).simulator.version, "27.0");
  assert.equal(s.matchesIos("27.0", "27"), true);
  assert.equal(s.matchesIos("270.0", "27"), false);
});

test("an unknown name lists what there is", () => {
  const sims = s.parseSimulators(JSON_DEVICES);
  assert.match((s.findSimulator(sims, "Nope") as any).error, /no simulator called "Nope"\. The simulators on this machine: iPad \(A16\) \(iOS 27\.0\)/);
  assert.match((s.findSimulator(sims, "iPhone 17", "27") as any).error, /for iOS 27/);
  assert.match((s.findSimulator([], "x") as any).error, /: none/);
});

test("names have no spaces, and {ios} becomes the version", () => {
  assert.equal(s.simulatorName("iPhone 18 Pro", "27.0"), "iPhone_18_Pro_iOS_27_0");
  assert.equal(s.simulatorName("iPad Pro 13-inch (M5)", "27.0"), "iPad_Pro_13_inch_M5_iOS_27_0");
  assert.equal(s.expandName("Test_{ios}_{ios}", "26.4"), "Test_26_4_26_4");
});

test("the default device is the newest iPhone Pro of the iOS, a plain iPhone without one, and a known name without anything", () => {
  const type = (name: string, family = "iPhone") => ({ name, identifier: name, family });
  assert.equal(s.defaultDevice([type("iPhone 17 Pro"), type("iPhone 18 Pro"), type("iPhone 18 Pro Max"), type("iPad Pro 13-inch (M5)", "iPad")]), "iPhone 18 Pro");
  assert.equal(s.defaultDevice([type("iPad Air", "iPad"), type("iPhone 17")]), "iPhone 17");
  assert.equal(s.defaultDevice([]), s.FALLBACK_DEVICE);
});

test("a device is found by name or identifier", () => {
  const types = [{ name: "iPhone 17 Pro", identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro", family: "iPhone" }];
  assert.equal(s.findDevice(types, "iphone 17 pro"), types[0]);
  assert.equal(s.findDevice(types, "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"), types[0]);
  assert.equal(s.findDevice(types, "iPhone 3G"), null);
});

test("simulators are created, booted, shut down and erased with simctl", () => {
  s.createSimulator("Test", "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro", "27.0");
  s.shutdownSimulator("U");
  s.eraseSimulator("U");
  assert.deepEqual(runFile.mock.calls.map((c) => c.arguments[1]), [
    ["simctl", "create", "Test", "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro", "com.apple.CoreSimulator.SimRuntime.iOS-27-0"],
    ["simctl", "shutdown", "U"],
    ["simctl", "erase", "U"],
  ]);
});

test("booting a simulator that is booted already is not a failure", () => {
  assert.deepEqual(s.bootSimulator("U"), { ok: true, output: "" });
  runFile.mock.mockImplementation(() => result("Unable to boot device in current state: Booted", 149));
  assert.equal(s.bootSimulator("U").ok, true);
  runFile.mock.mockImplementation(() => result("Invalid device: U", 164));
  assert.deepEqual(s.bootSimulator("U"), { ok: false, output: "Invalid device: U" });
});

test("the Simulator app opens with the simulator in front", () => {
  assert.equal(s.openSimulatorApp("U"), true);
  assert.deepEqual(runFile.mock.calls[0]!.arguments, ["open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", "U"]]);
});

test("without the Simulator app (Xcode 27 and newer) the simulator opens in a window of its own with the link of Device Hub", () => {
  runFile.mock.mockImplementation((_file, args = []) => result("", args[1] === "Simulator" ? 1 : 0));
  assert.equal(s.openSimulatorApp("U"), true);
  assert.deepEqual(runFile.mock.calls[1]!.arguments, ["open", ["devices://device/open?id=U"]]);
  assert.equal(runFile.mock.callCount(), 2);
});

test("Device Hub itself is the last resort, and a failure is reported", () => {
  runFile.mock.mockImplementation((_file, args = []) => result("", args[0] === "-a" && args[1] !== "Simulator" ? 0 : 1));
  assert.equal(s.openSimulatorApp("U"), true);
  assert.deepEqual(runFile.mock.calls[2]!.arguments, ["open", ["-a", "/Applications/Xcode.app/Contents/Applications/DeviceHub.app"]]);
  runFile.mock.mockImplementation(() => result("", 1));
  assert.equal(s.openSimulatorApp("U"), false);
  run.mock.mockImplementationOnce(() => null);
  assert.equal(s.openSimulatorApp("U"), false);
});

const finished = (value: number) => result(`com.apple.springboard.finishedstartup ${value}`);
const noSleep = { sleep: async () => {} };

test("waiting for the boot is waiting for simctl bootstatus, and then for the home screen", async () => {
  const answers = [result(), finished(0), finished(0), finished(40603)];
  runFileAsync.mock.mockImplementation(async () => answers.shift()!);
  await s.waitForBoot("U", { timeoutMs: 1000, ...noSleep });
  assert.deepEqual(runFileAsync.mock.calls[0]!.arguments, ["xcrun", ["simctl", "bootstatus", "U"], { timeout: 1000 }]);
  assert.deepEqual(runFileAsync.mock.calls[1]!.arguments[1], ["simctl", "spawn", "U", "notifyutil", "-g", "com.apple.springboard.finishedstartup"]);
  assert.equal(runFileAsync.mock.callCount(), 4, "it asks until SpringBoard says it is done");
  runFileAsync.mock.mockImplementation(async () => result());
});

test("the sleep between the questions is short, and an iOS that cannot answer is taken as ready after bootstatus", async () => {
  const sleeps: number[] = [];
  const answers = [result(), finished(0), finished(1)];
  runFileAsync.mock.mockImplementation(async () => answers.shift()!);
  await s.waitForBoot("U", { sleep: async (ms) => void sleeps.push(ms) });
  assert.deepEqual(sleeps, [500]);

  const unknown = [result(), result("notifyutil: not found", 127)];
  runFileAsync.mock.mockImplementation(async () => unknown.shift()!);
  await s.waitForBoot("U", noSleep);
  assert.equal(unknown.length, 0);
  runFileAsync.mock.mockImplementation(async () => result());
});

test("a boot that does not finish says why", async () => {
  runFileAsync.mock.mockImplementationOnce(async () => result("Monitoring boot status\nUnable to get boot status", 1));
  await assert.rejects(s.waitForBoot("U"), /did not finish booting: Unable to get boot status/);
  runFileAsync.mock.mockImplementationOnce(async () => result("", 1));
  await assert.rejects(s.waitForBoot("U", { timeoutMs: 120_000 }), /longer than 2 minutes/);
});

test("a home screen that never comes is a timeout", async () => {
  runFileAsync.mock.mockImplementation(async (_f, args) => (args?.includes("bootstatus") ? result() : finished(0)));
  await assert.rejects(s.waitForBoot("U", { timeoutMs: 30, sleep: (ms) => new Promise((r) => setTimeout(r, ms + 10)) }), /did not finish booting: it took longer/);
  runFileAsync.mock.mockImplementation(async () => result());
});

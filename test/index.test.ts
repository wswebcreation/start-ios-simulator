import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

const select = mock.fn(async (_options: unknown): Promise<string> => "all");
mock.module("@inquirer/prompts", { namedExports: { select, checkbox: async () => [], confirm: async () => true, input: async () => "" } });
const api = await import("../src/index.ts");
const { settings } = await import("../src/ui.ts");
import type { Step } from "../src/index.ts";

afterEach(() => {
  mock.restoreAll();
  select.mock.resetCalls();
});

test("the index exports what a consumer needs to build and run its own plan", () => {
  for (const name of ["planIos", "runPlan", "dry", "configure", "namedTarget", "defaultTarget", "setupIos", "inspect", "listSimulators", "listRuntimes", "bootSimulator", "waitForBoot", "shutdownSimulator", "main"]) {
    assert.equal(typeof (api as Record<string, unknown>)[name], "function", name);
  }
});

test("configure changes only the options that are passed", () => {
  api.configure({ yes: true, dryRun: true });
  assert.deepEqual({ ...settings }, { yes: true, dryRun: true });
  api.configure({ yes: false });
  assert.deepEqual({ ...settings }, { yes: false, dryRun: true });
  api.configure({ dryRun: false });
  assert.equal(settings.dryRun, false);
});

test("configure({ yes }) decides whether runPlan asks", async () => {
  mock.method(console, "log", () => {});
  const step: Step = { id: "x", title: "X", description: "x", done: false, action: "do x", apply: async () => true };

  api.configure({ yes: true });
  assert.equal((await api.runPlan("Plan", [step])).ok, true);
  assert.equal(select.mock.callCount(), 0);

  api.configure({ yes: false });
  assert.equal((await api.runPlan("Plan", [step])).ok, true);
  assert.equal(select.mock.callCount(), 1);
});

test("a plan of the module and a step of your own run together, with the device that was asked for", async () => {
  mock.method(console, "log", () => {});
  api.configure({ yes: true, dryRun: true });
  const state = {
    xcode: { version: "27.0", path: "/x" }, xcodeApps: [], licenseReady: true, sdkVersion: "27.0",
    runtimes: [{ version: "27.0", identifier: "x", deviceTypes: [{ name: "iPhone 18 Pro", identifier: "a", family: "iPhone" }, { name: "iPhone 17 Pro", identifier: "b", family: "iPhone" }] }],
    simulators: [], deviceTypes: [{ name: "iPhone 18 Pro", identifier: "a", family: "iPhone" }],
  };
  const target = api.namedTarget(state, state.sdkVersion, ["Workshop_1_iPhone_17_Pro_iOS_{ios}", "Workshop_2_iPhone_17_Pro_iOS_{ios}"], "iPhone 17 Pro");
  assert.deepEqual(target.simulators.map((s) => [s.name, s.device]), [["Workshop_1_iPhone_17_Pro_iOS_27_0", "iPhone 17 Pro"], ["Workshop_2_iPhone_17_Pro_iOS_27_0", "iPhone 17 Pro"]]);

  let ran = false;
  const mine: Step = { id: "mine", title: "Mine", description: "", done: false, apply: async () => ((ran = true), true) };
  const steps = api.planIos(state, target);
  assert.equal(steps.at(-1)!.id, "simulators");
  assert.equal((await api.runPlan("This is what we need for the workshop:", [...steps, mine])).ok, true);
  assert.ok(ran);
});

test("without Xcode the version is null and the {ios} in the names is not filled in, so the caller can see it", () => {
  const bare = { xcode: null, xcodeApps: [], licenseReady: false, sdkVersion: null, runtimes: [], simulators: [], deviceTypes: [] };
  const target = api.namedTarget(bare, bare.sdkVersion, ["Workshop_iOS_{ios}"], "iPhone 17 Pro");
  assert.equal(target.version, null);
  assert.equal(target.simulators[0]!.name, "Workshop_iOS_{ios}");
});

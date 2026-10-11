import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { HELP } from "../src/args.ts";
import { EXIT, main, type Deps } from "../src/flow.ts";
import type { Inspection } from "../src/ios/inspect.ts";
import type { Simulator } from "../src/ios/simulators.ts";
import { settings } from "../src/ui.ts";

const sim = (name: string, version = "27.0", booted = false): Simulator => ({ udid: `UDID-${name}-${version}`, name, version, booted });
const SIMS = [sim("iPhone 18 Pro"), sim("iPhone 17 Pro"), sim("iPhone 17 Pro", "26.4"), sim("iPad Air", "26.4")];
const pro = { name: "iPhone 18 Pro", identifier: "id", family: "iPhone" };

const ready: Inspection = {
  xcode: { version: "27.0", path: "/Xcode/Developer" },
  xcodeApps: [],
  licenseReady: true,
  sdkVersion: "27.0",
  runtimes: [{ version: "27.0", identifier: "x", deviceTypes: [pro] }],
  simulators: SIMS,
  deviceTypes: [pro],
};
const bare: Inspection = { ...ready, xcode: null, licenseReady: false, sdkVersion: null, runtimes: [], simulators: [], deviceTypes: [] };

let output: string[];
let state: Inspection;
const calls: Record<string, unknown[][]> = {};
const spy = <T>(name: string, impl: (...args: any[]) => T) =>
  (...args: unknown[]): T => {
    (calls[name] ??= []).push(args);
    return impl(...args);
  };
const fine = { output: "", exitCode: 0 };

/** Deps where nothing really happens: the machine is `state`, the user presses enter on every question. */
function fakeDeps(overrides: Partial<Deps> = {}): Partial<Deps> {
  return {
    printBanner: spy("printBanner", () => {}),
    printAbout: spy("printAbout", () => {}),
    inspect: spy("inspect", () => state),
    runPlan: spy("runPlan", async () => ({ ok: true, applied: [] as string[], declined: false })),
    startSpinner: spy("startSpinner", () => () => {}),
    bootSimulator: spy("bootSimulator", () => ({ ok: true, output: "" })),
    shutdownSimulator: spy("shutdownSimulator", () => fine),
    eraseSimulator: spy("eraseSimulator", () => fine),
    openSimulatorApp: spy("openSimulatorApp", () => true),
    waitForBoot: spy("waitForBoot", async () => {}),
    readConfig: spy("readConfig", () => ({})),
    writeConfig: spy("writeConfig", () => {}),
    select: spy("select", async (options: { default?: string; choices: { value: string }[] }) => options.default ?? options.choices[0]!.value),
    checkbox: spy("checkbox", async () => [] as string[]),
    interactive: true,
    isMac: true,
    ...overrides,
  };
}
const text = () => output.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
const arg = (name: string, call = -1) => calls[name]!.at(call)![0];

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  output = [];
  state = ready;
  settings.yes = false;
  settings.dryRun = false;
  mock.method(console, "log", (...args: unknown[]) => output.push(args.join(" ")));
});
afterEach(() => mock.restoreAll());

// ─── the simple answers ─────────────────────────────────────────────────────

test("--help shows the banner and the options; --version only the version", async () => {
  assert.equal(await main(["--help"], fakeDeps()), EXIT.ok);
  assert.equal(calls.printBanner!.length, 1);
  assert.equal(text(), HELP.trimEnd());

  output = [];
  assert.equal(await main(["--version"], fakeDeps()), EXIT.ok);
  assert.match(text(), /^\d+\.\d+\.\d+$/);
  assert.equal(calls.inspect, undefined);
});

test("a mistake in the options is explained and has its own exit code", async () => {
  assert.equal(await main(["--nope"], fakeDeps()), EXIT.usage);
  assert.match(text(), /Unknown option '--nope'/);
});

test("pressing ctrl-c at a question is not an error", async () => {
  const cancel = Object.assign(new Error("cancelled"), { name: "ExitPromptError" });
  assert.equal(await main([], fakeDeps({ select: async () => { throw cancel; } })), EXIT.cancelled);
  assert.match(text(), /Cancelled/);
});

test("on another system than macOS it says so, instead of failing on xcrun", async () => {
  assert.equal(await main([], fakeDeps({ isMac: false })), EXIT.failed);
  assert.match(text(), /only works on macOS/);
  assert.equal(calls.inspect, undefined);
  assert.equal(await main(["--help"], fakeDeps({ isMac: false })), EXIT.ok, "the help can be read anywhere");
});

// ─── starting a simulator ───────────────────────────────────────────────────

test("a simulator that is picked is booted, shown, and waited for", async () => {
  assert.equal(await main([], fakeDeps()), EXIT.ok);
  const picked = SIMS[0]!;
  assert.deepEqual(calls.bootSimulator!.at(-1), [picked.udid]);
  assert.deepEqual(calls.openSimulatorApp!.at(-1), [picked.udid]);
  assert.equal(calls.waitForBoot!.length, 1);
  assert.match(text(), /Booting iPhone 18 Pro \(iOS 27\.0\)/);
  assert.match(text(), /✔ iPhone 18 Pro \(iOS 27\.0\) is ready/);
  assert.deepEqual(calls.writeConfig!.at(-1), [{ lastSimulator: picked.udid }]);
});

test("the list has the iOS version of every simulator, and the last used one is the default", async () => {
  const last = SIMS[2]!;
  await main([], fakeDeps({ readConfig: () => ({ lastSimulator: last.udid }) }));
  const options = arg("select") as { choices: { value: string; name: string }[]; default: string };
  assert.equal(options.default, last.udid);
  assert.equal(options.choices.length, 4);
  assert.match(options.choices[2]!.name.replace(/\x1b\[[0-9;]*m/g, ""), /^iPhone 17 Pro iOS 26\.4 \(last used\)$/);
  assert.deepEqual(calls.bootSimulator!.at(-1), [last.udid]);
});

test("a simulator can be named, with its iOS version when the name is not enough", async () => {
  assert.equal(await main(["iPad Air"], fakeDeps()), EXIT.ok);
  assert.equal(calls.select, undefined, "nobody is asked");
  assert.deepEqual(calls.bootSimulator!.at(-1), [SIMS[3]!.udid]);

  assert.equal(await main(["iPhone 17 Pro"], fakeDeps()), EXIT.failed);
  assert.match(text(), /2 simulators called "iPhone 17 Pro"/);

  assert.equal(await main(["iPhone 17 Pro", "--ios", "26"], fakeDeps()), EXIT.ok);
  assert.deepEqual(calls.bootSimulator!.at(-1), [SIMS[2]!.udid]);
  assert.equal(await main(["Nope"], fakeDeps()), EXIT.failed);
  assert.match(text(), /no simulator called "Nope"/);
});

test("--ios narrows the list, and the only simulator left is used without asking", async () => {
  state = { ...ready, simulators: [sim("iPhone 18 Pro"), sim("iPad Air", "26.4")] };
  assert.equal(await main(["--ios", "26"], fakeDeps()), EXIT.ok);
  assert.equal(calls.select, undefined);
  assert.match(text(), /Using the only simulator: iPad Air \(iOS 26\.4\)/);

  assert.equal(await main(["--ios", "18"], fakeDeps()), EXIT.failed);
  assert.match(text(), /no simulators for iOS 18/);
});

test("without a terminal the name must be given, and the choices are shown", async () => {
  assert.equal(await main([], fakeDeps({ interactive: false })), EXIT.failed);
  assert.match(text(), /no terminal to pick a simulator[\s\S]*iPad Air \(iOS 26\.4\)/);
});

test("a simulator that runs already is not started again, but it is shown", async () => {
  state = { ...ready, simulators: [{ ...SIMS[0]!, booted: true }] };
  assert.equal(await main([], fakeDeps()), EXIT.ok);
  assert.match(text(), /is already running/);
  assert.equal(calls.bootSimulator, undefined);
  assert.equal(calls.openSimulatorApp!.length, 1);
});

test("--headless does not open the Simulator app", async () => {
  assert.equal(await main(["iPad Air", "--headless"], fakeDeps()), EXIT.ok);
  assert.equal(calls.openSimulatorApp, undefined);
  assert.equal(calls.bootSimulator!.length, 1);
});

test("--no-wait returns when the boot is started", async () => {
  assert.equal(await main(["iPad Air", "--no-wait"], fakeDeps()), EXIT.ok);
  assert.equal(calls.waitForBoot, undefined);
  assert.match(text(), /still booting/);
});

test("--erase erases a simulator that is shut down, and shuts down one that runs first", async () => {
  assert.equal(await main(["iPad Air", "--erase"], fakeDeps()), EXIT.ok);
  assert.equal(calls.shutdownSimulator, undefined);
  assert.deepEqual(calls.eraseSimulator!.at(-1), [SIMS[3]!.udid]);
  assert.match(text(), /is erased/);

  state = { ...ready, simulators: [{ ...SIMS[3]!, booted: true }] };
  assert.equal(await main(["iPad Air", "--erase"], fakeDeps()), EXIT.ok);
  assert.equal(calls.shutdownSimulator!.length, 1);
  assert.equal(calls.bootSimulator!.length, 2);
});

test("a simulator that cannot be erased, shut down or booted is reported", async () => {
  const broken = { output: "Unable to erase", exitCode: 1 };
  assert.equal(await main(["iPad Air", "--erase"], fakeDeps({ eraseSimulator: () => broken })), EXIT.failed);
  assert.match(text(), /Erasing iPad Air \(iOS 26\.4\) failed: Unable to erase/);
  assert.equal(calls.bootSimulator, undefined);

  output = [];
  assert.equal(await main(["iPad Air"], fakeDeps({ bootSimulator: () => ({ ok: false, output: "Invalid device" }) })), EXIT.failed);
  assert.match(text(), /Booting iPad Air \(iOS 26\.4\) failed: Invalid device/);
});

test("a boot that does not finish is reported, and the spinner is gone before it is", async () => {
  const stop = mock.fn();
  const failed = fakeDeps({ startSpinner: () => stop, waitForBoot: async () => { throw new Error("The simulator did not finish booting"); } });
  assert.equal(await main(["iPad Air"], failed), EXIT.failed);
  assert.equal(stop.mock.callCount(), 1);
  assert.match(text(), /did not finish booting/);
});

test("when you type no options, you are asked for them; the answers count", async () => {
  await main([], fakeDeps({ checkbox: async () => ["erase", "headless"] }));
  assert.equal(calls.eraseSimulator!.length, 1);
  assert.equal(calls.openSimulatorApp, undefined);
});

test("with a name, an option or --yes nobody is asked", async () => {
  await main(["iPad Air"], fakeDeps());
  await main(["--erase"], fakeDeps());
  await main(["--yes"], fakeDeps());
  assert.equal(calls.checkbox, undefined);
});

// ─── checking and setting up ────────────────────────────────────────────────

test("--check reports and does not change anything, with exit code 1 when something is missing", async () => {
  const planIos = (_state: Inspection, _target: unknown) => [{ id: "a", title: "A", description: "d", done: true, apply: async () => true }];
  assert.equal(await main(["--check"], fakeDeps({ planIos })), EXIT.ok);
  assert.match(text(), /Everything is set up/);
  assert.match(text(), /- iPad Air \(iOS 26\.4\)/);
  assert.equal(calls.bootSimulator, undefined);

  state = bare;
  output = [];
  const missing = () => [{ id: "a", title: "A", description: "d", done: false, apply: async () => true }];
  assert.equal(await main(["--check"], fakeDeps({ planIos: missing })), EXIT.failed);
  assert.match(text(), /Something is missing\. Run start-ios-simulator --setup/);
  assert.equal(calls.runPlan, undefined);
});

test("with a real plan a bare machine is missing everything, a ready one nothing", async () => {
  state = bare;
  assert.equal(await main(["--check"], fakeDeps()), EXIT.failed);
  assert.match(text(), /Xcode, missing[\s\S]*Xcode licence and components, missing[\s\S]*simulator runtime, missing/);
  output = [];
  state = ready;
  assert.equal(await main(["--check"], fakeDeps()), EXIT.ok);
});

test("without simulators the setup is offered, and afterwards a simulator is started", async () => {
  state = { ...ready, simulators: [] };
  const after = [sim("iPhone_18_Pro_iOS_27_0")];
  let inspected = 0;
  const deps = fakeDeps({ inspect: () => (inspected++ === 0 ? state : { ...ready, simulators: after }) });
  assert.equal(await main([], deps), EXIT.ok);
  assert.equal(calls.runPlan!.length, 1);
  assert.match(calls.runPlan![0]![0] as string, /Something is missing/);
  assert.deepEqual(calls.bootSimulator!.at(-1), [after[0]!.udid], "the only simulator is used");
});

test("a setup that is declined or fails stops the run", async () => {
  state = bare;
  assert.equal(await main([], fakeDeps({ runPlan: async () => ({ ok: false, applied: [], declined: true }) })), EXIT.ok);
  assert.equal(await main([], fakeDeps({ runPlan: async () => ({ ok: false, applied: [], declined: false }) })), EXIT.failed);
  assert.equal(calls.bootSimulator, undefined);
});

test("--setup runs the plan also when nothing is missing, and does not start anything", async () => {
  assert.equal(await main(["--setup"], fakeDeps()), EXIT.ok);
  assert.match(calls.runPlan![0]![0] as string, /This is what we need/);
  assert.equal(calls.bootSimulator, undefined);
  assert.match(text(), /Start a simulator with: npx start-ios-simulator/);
});

test("--create makes simulators with these names for the iOS of Xcode, --ios for another one", async () => {
  const plans: { version: string | null; names: string[] }[] = [];
  const planIos = (_state: Inspection, target: { version: string | null; simulators: { name: string }[] }) => {
    plans.push({ version: target.version, names: target.simulators.map((s) => s.name) });
    return [];
  };
  await main(["--create", "T1_{ios}", "--create", "T2_{ios}"], fakeDeps({ planIos }));
  await main(["--create", "T_{ios}", "--ios", "26.4"], fakeDeps({ planIos }));
  await main(["--create", "T_{ios}", "--ios", "26"], fakeDeps({ planIos }));
  assert.deepEqual(plans, [
    { version: "27.0", names: ["T1_27_0", "T2_27_0"] },
    { version: "26.4", names: ["T_26_4"] },
    { version: "26.0", names: ["T_26_0"] },
  ]);
});

test("--dry-run shows the plan and stops", async () => {
  assert.equal(await main(["--dry-run"], fakeDeps()), EXIT.ok);
  assert.equal(calls.runPlan!.length, 1);
  assert.equal(calls.bootSimulator, undefined);
  assert.equal(settings.dryRun, true);
});

test("without a terminal nothing is installed unless you say --yes", async () => {
  state = bare;
  assert.equal(await main([], fakeDeps({ interactive: false })), EXIT.failed);
  assert.match(text(), /no terminal to ask in/);
  assert.equal(calls.runPlan, undefined);

  const failing = fakeDeps({ interactive: false, runPlan: spy("runPlan", async () => ({ ok: false, applied: [] as string[], declined: false })) });
  assert.equal(await main(["--yes"], failing), EXIT.failed, "with --yes the plan does run");
  assert.equal(calls.runPlan!.length, 1);
});

test("--no-setup only reports", async () => {
  state = bare;
  assert.equal(await main(["--no-setup"], fakeDeps()), EXIT.failed);
  assert.match(text(), /switched off/);
  assert.equal(calls.runPlan, undefined);
});

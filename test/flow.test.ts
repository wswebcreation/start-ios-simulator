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

const IMAGES = [
  { id: "A", identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0", version: "27.0", usable: true, sizeBytes: 8_100_000_000 },
  { id: "B", identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-5", version: "26.5", usable: true, sizeBytes: 8_500_000_000 },
];

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
    inspect: spy("inspect", async () => state),
    runPlan: spy("runPlan", async () => ({ ok: true, applied: [] as string[], declined: false })),
    startSpinner: spy("startSpinner", () => () => {}),
    bootSimulator: spy("bootSimulator", () => ({ ok: true, output: "" })),
    shutdownSimulator: spy("shutdownSimulator", () => fine),
    eraseSimulator: spy("eraseSimulator", () => fine),
    deleteSimulator: spy("deleteSimulator", () => fine),
    deleteUnavailableSimulators: spy("deleteUnavailableSimulators", async () => fine),
    listRuntimeImages: spy("listRuntimeImages", () => IMAGES),
    simulatorUsage: spy("simulatorUsage", () => ({ usedRuntimes: new Set(["com.apple.CoreSimulator.SimRuntime.iOS-27-0"]), unavailable: 0 })),
    deleteRuntime: spy("deleteRuntime", async () => fine),
    openSimulatorApp: spy("openSimulatorApp", () => true),
    waitForBoot: spy("waitForBoot", async () => {}),
    readConfig: spy("readConfig", () => ({})),
    writeConfig: spy("writeConfig", () => {}),
    select: spy("select", async (options: { default?: string; choices: { value: string }[] }) => options.default ?? options.choices[0]!.value),
    checkbox: spy("checkbox", async () => [] as string[]),
    confirm: spy("confirm", async () => true),
    input: spy("input", async () => "Typed_Name"),
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

test("when the Simulator app cannot be opened the simulator still runs, with a hint", async () => {
  assert.equal(await main(["iPad Air"], fakeDeps({ openSimulatorApp: () => false })), EXIT.ok);
  assert.match(text(), /Could not open the Simulator app \(or Device Hub\)[\s\S]*is ready/);
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
  const started = mock.fn();
  const failed = fakeDeps({ startSpinner: () => (started(), stop), waitForBoot: async () => { throw new Error("The simulator did not finish booting"); } });
  assert.equal(await main(["iPad Air"], failed), EXIT.failed);
  assert.equal(started.mock.callCount(), 2, "one for looking at the machine, one for the boot");
  assert.equal(stop.mock.callCount(), 2, "every spinner is stopped");
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
  const deps = fakeDeps({ inspect: async () => (inspected++ === 0 ? state : { ...ready, simulators: after }) });
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

// ─── creating with questions ────────────────────────────────────────────────

test("--create without a name asks the questions, and creates what was answered", async () => {
  const planned: { version: string | null; sims: { name: string; device: string }[] }[] = [];
  const planIos = (_s: Inspection, target: { version: string | null; simulators: { name: string; device: string }[] }) => (planned.push({ version: target.version, sims: target.simulators }), []);
  assert.equal(await main(["--create"], fakeDeps({ planIos, select: async (o: any) => o.default ?? o.choices[0].value, confirm: async () => false })), EXIT.ok);
  assert.deepEqual(planned, [{ version: "27.0", sims: [{ name: "iPhone_18_Pro_iOS_27_0", device: "iPhone 18 Pro" }] }]);
  assert.equal(calls.runPlan!.length, 1);
  assert.equal(calls.bootSimulator, undefined, "it only creates, like --create with a name");
});

test("--create without a name needs a terminal", async () => {
  assert.equal(await main(["--create"], fakeDeps({ interactive: false })), EXIT.usage);
  assert.match(text(), /there is no terminal to ask in/);
});

test("--create without a name and without any iOS is explained", async () => {
  state = bare;
  assert.equal(await main(["--create"], fakeDeps()), EXIT.usage);
  assert.match(text(), /Install Xcode first/);
});

// ─── deleting ───────────────────────────────────────────────────────────────

test("--delete with a name asks first, and then deletes it", async () => {
  assert.equal(await main(["--delete", "iPad Air"], fakeDeps()), EXIT.ok);
  assert.match((arg("confirm") as { message: string }).message, /Delete iPad Air \(iOS 26\.4\)\? This removes the simulator and all its data\.$/);
  assert.deepEqual(calls.deleteSimulator!.at(-1), [SIMS[3]!.udid]);
  assert.match(text(), /✔ Deleted iPad Air \(iOS 26\.4\)/);
  assert.equal(calls.shutdownSimulator, undefined);
});

test("--delete shuts a simulator that runs down first, and says so in the question", async () => {
  state = { ...ready, simulators: [{ ...SIMS[3]!, booted: true }, SIMS[0]!] };
  assert.equal(await main(["--delete", "iPad Air"], fakeDeps()), EXIT.ok);
  assert.match((arg("confirm") as { message: string }).message, /shut down first/);
  assert.deepEqual(calls.shutdownSimulator!.at(-1), [SIMS[3]!.udid]);
  assert.equal(calls.deleteSimulator!.length, 1);
});

test("--delete does nothing when you say no, and nobody is asked with --yes", async () => {
  assert.equal(await main(["--delete", "iPad Air"], fakeDeps({ confirm: async () => false })), EXIT.ok);
  assert.match(text(), /Nothing deleted/);
  assert.equal(calls.deleteSimulator, undefined);

  assert.equal(await main(["--delete", "iPad Air", "--yes"], fakeDeps()), EXIT.ok);
  assert.equal(calls.confirm, undefined);
  assert.equal(calls.deleteSimulator!.length, 1);
});

test("--delete without a name lets you pick from a list", async () => {
  const checkbox = spy("checkbox", async () => [SIMS[0]!.udid, SIMS[3]!.udid]);
  assert.equal(await main(["--delete"], fakeDeps({ checkbox })), EXIT.ok);
  assert.equal((arg("checkbox") as { choices: unknown[] }).choices.length, 4);
  assert.deepEqual(calls.deleteSimulator!.map((c) => c[0]), [SIMS[0]!.udid, SIMS[3]!.udid]);

  assert.equal(await main(["--delete"], fakeDeps()), EXIT.ok);
  assert.match(text(), /Nothing deleted/);
  assert.equal(calls.deleteSimulator!.length, 2, "nothing picked, nothing deleted");
});

test("--delete explains what is wrong: no terminal, no simulators, a name that does not exist or is not unique", async () => {
  assert.equal(await main(["--delete"], fakeDeps({ interactive: false })), EXIT.usage);
  state = { ...ready, simulators: [] };
  assert.equal(await main(["--delete"], fakeDeps()), EXIT.failed);
  assert.match(text(), /no simulators to delete/);
  state = ready;
  assert.equal(await main(["--delete", "Nope", "--yes"], fakeDeps()), EXIT.failed);
  assert.equal(await main(["--delete", "iPhone 17 Pro", "--yes"], fakeDeps()), EXIT.failed);
  assert.match(text(), /2 simulators called "iPhone 17 Pro"/);
  assert.equal(calls.deleteSimulator, undefined);
});

test("--delete --dry-run only shows what would go, and a simulator that cannot be deleted fails the run", async () => {
  assert.equal(await main(["--delete", "iPad Air", "--dry-run"], fakeDeps()), EXIT.ok);
  assert.match(text(), /would delete iPad Air \(iOS 26\.4\)/);
  assert.equal(calls.deleteSimulator, undefined);

  const broken = fakeDeps({ deleteSimulator: () => ({ output: "Unable to delete", exitCode: 1 }) });
  assert.equal(await main(["--delete", "iPad Air", "--yes"], broken), EXIT.failed);
  assert.match(text(), /Deleting iPad Air \(iOS 26\.4\) failed\s+Unable to delete/);
});

test("the same simulator named twice is deleted once", async () => {
  await main(["--delete", "iPad Air", "--delete", SIMS[3]!.udid, "--yes"], fakeDeps());
  assert.equal(calls.deleteSimulator!.length, 1);
});

// ─── pruning ────────────────────────────────────────────────────────────────

test("--prune lists the runtimes no simulator uses, all selected, and removes the ones you keep selected", async () => {
  const checkbox = spy("checkbox", async (o: { choices: { value: string }[] }) => o.choices.map((c) => c.value));
  assert.equal(await main(["--prune"], fakeDeps({ checkbox: checkbox as never })), EXIT.ok);
  const options = arg("checkbox") as { choices: { value: string; name: string; checked: boolean }[] };
  assert.deepEqual(options.choices.map((c) => [c.value, c.name, c.checked]), [["runtime:B", "iOS 26.5 runtime, 8.5 GB", true]]);
  assert.match((arg("confirm") as { message: string }).message, /Remove 1 item \(8\.5 GB\)\? A runtime can be downloaded again later\./);
  assert.deepEqual(calls.deleteRuntime!.at(-1), ["B"]);
  assert.match(text(), /✔ Removed iOS 26\.5 runtime/);
});

test("--prune also removes an unusable runtime and the simulators that cannot run anymore", async () => {
  const images = [...IMAGES, { id: "C", identifier: IMAGES[0]!.identifier, version: "27.0", usable: false, sizeBytes: 8_100_000_000 }];
  const usage = () => ({ usedRuntimes: new Set([IMAGES[0]!.identifier, IMAGES[1]!.identifier]), unavailable: 3 });
  assert.equal(await main(["--prune", "--yes"], fakeDeps({ listRuntimeImages: () => images, simulatorUsage: usage })), EXIT.ok);
  assert.deepEqual(calls.deleteRuntime!.map((c) => c[0]), ["C"]);
  assert.equal(calls.deleteUnavailableSimulators!.length, 1);
  assert.match(text(), /3 simulators that cannot run anymore/);
  assert.equal(calls.confirm, undefined, "--yes does not ask");
});

test("--prune with nothing to remove, with nothing selected, and when you say no", async () => {
  state = ready;
  assert.equal(await main(["--prune"], fakeDeps({ listRuntimeImages: () => [IMAGES[0]!] })), EXIT.ok);
  assert.match(text(), /Nothing to remove/);

  assert.equal(await main(["--prune"], fakeDeps()), EXIT.ok);
  assert.match(text(), /Nothing removed/);
  assert.equal(calls.deleteRuntime, undefined);

  const checkbox = async (o: { choices: { value: string }[] }) => o.choices.map((c) => c.value);
  assert.equal(await main(["--prune"], fakeDeps({ checkbox: checkbox as never, confirm: async () => false })), EXIT.ok);
  assert.equal(calls.deleteRuntime, undefined);
});

test("--prune --dry-run only shows, and without a terminal it needs --yes or --dry-run", async () => {
  assert.equal(await main(["--prune", "--dry-run"], fakeDeps()), EXIT.ok);
  assert.match(text(), /would remove iOS 26\.5 runtime, 8\.5 GB/);
  assert.equal(calls.deleteRuntime, undefined);

  assert.equal(await main(["--prune"], fakeDeps({ interactive: false })), EXIT.usage);
  assert.match(text(), /there is no terminal to ask in/);
});

test("--prune needs Xcode, and a runtime that cannot be removed is reported", async () => {
  state = bare;
  assert.equal(await main(["--prune"], fakeDeps()), EXIT.failed);
  assert.match(text(), /Could not read the iOS runtimes/);

  state = ready;
  const broken = fakeDeps({ deleteRuntime: async () => ({ output: "Cannot delete", exitCode: 1 }) });
  assert.equal(await main(["--prune", "--yes"], broken), EXIT.failed);
  assert.match(text(), /Removing iOS 26\.5 runtime, 8\.5 GB failed\s+Cannot delete/);
});

// ─── what we say while we look ──────────────────────────────────────────────

test("while we look at the machine a spinner says what we are doing, depending on what was asked", async () => {
  const texts: string[] = [];
  const deps = fakeDeps({ startSpinner: (text: string) => (texts.push(text), () => {}) });
  await main(["iPad Air", "--headless", "--no-wait"], deps);
  await main(["--check"], deps);
  await main(["--delete", "iPad Air", "--dry-run"], deps);
  await main(["--prune", "--dry-run"], deps);
  await main(["--setup"], deps);
  assert.deepEqual(texts, ["Checking your setup...", "Checking what is set up...", "Looking up your simulators...", "Checking your iOS runtimes...", "Checking your setup..."]);

  texts.length = 0;
  state = { ...ready, simulators: [] };
  await main([], fakeDeps({ startSpinner: (text: string) => (texts.push(text), () => {}), inspect: async () => (texts.length === 1 ? state : ready) }));
  assert.deepEqual(texts.slice(0, 2), ["Checking your setup...", "Checking your setup again..."], "after a setup we look again");
});

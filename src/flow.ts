import { checkbox, confirm, input, select } from "@inquirer/prompts";
import { readFileSync } from "node:fs";
import { HELP, UsageError, hasStartOptions, parseOptions, type Options } from "./args.ts";
import { printAbout, printBanner } from "./banner.ts";
import { readConfig, writeConfig } from "./config.ts";
import { type Inspection, inspect } from "./ios/inspect.ts";
import { unusedRuntimes, runtimeLabel, formatSize } from "./ios/maintain.ts";
import { compareVersions, deleteRuntime, listRuntimeImages } from "./ios/runtimes.ts";
import { askedTarget, defaultTarget, namedTarget, planIos } from "./ios/setup.ts";
import { type Simulator, bootSimulator, deleteSimulator, deleteUnavailableSimulators, eraseSimulator, findSimulator, label, matchesIos, openSimulatorApp, shutdownSimulator, simulatorUsage, waitForBoot } from "./ios/simulators.ts";
import { blocking, runPlan, showPlan, type Step } from "./plan.ts";
import { askNewSimulators, type NewSimulator } from "./wizard.ts";
import { IS_MAC } from "./shell.ts";
import { bold, cyan, dim, fail, info, ok, settings, startSpinner, warn } from "./ui.ts";

/** Everything the flow reaches out to, so a test can replace the parts it does not want to run for real. */
export const realDeps = {
  printBanner,
  printAbout,
  inspect,
  planIos,
  runPlan,
  startSpinner,
  bootSimulator,
  shutdownSimulator,
  eraseSimulator,
  deleteSimulator,
  deleteUnavailableSimulators,
  listRuntimeImages,
  simulatorUsage,
  deleteRuntime,
  openSimulatorApp,
  waitForBoot,
  readConfig,
  writeConfig,
  select: select as (options: unknown) => Promise<string>,
  checkbox: checkbox as (options: unknown) => Promise<string[]>,
  confirm: confirm as (options: unknown) => Promise<boolean>,
  input: input as (options: unknown) => Promise<string>,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  isMac: IS_MAC,
};
export type Deps = typeof realDeps;

export const EXIT = { ok: 0, failed: 1, usage: 2, cancelled: 130 } as const;

const packageVersion = (): string => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "";
  }
};

/** The whole command. Returns the exit code, nothing in here exits the process. */
export async function main(argv: string[], overrides: Partial<Deps> = {}): Promise<number> {
  const deps: Deps = { ...realDeps, ...overrides };
  try {
    const opts = parseOptions(argv);
    if (opts.version) return print(packageVersion());
    if (opts.help) {
      deps.printBanner(packageVersion());
      return print(HELP);
    }
    if (!deps.isMac) {
      fail("start-ios-simulator only works on macOS, because the iOS Simulator is a part of Xcode.");
      return EXIT.failed;
    }

    settings.yes = opts.yes;
    settings.dryRun = opts.dryRun;
    return await run(opts, deps);
  } catch (e) {
    if (e instanceof UsageError) {
      fail(e.message);
      return EXIT.usage;
    }
    if ((e as Error).name === "ExitPromptError") {
      console.log("\nCancelled.");
      return EXIT.cancelled;
    }
    throw e;
  }
}

const print = (text: string) => {
  console.log(text.trimEnd());
  return EXIT.ok;
};

async function run(opts: Options, deps: Deps): Promise<number> {
  deps.printBanner(packageVersion());
  deps.printAbout();

  let state = await busy(deps, lookingText(opts), deps.inspect);
  if (opts.delete.length > 0) return deleteSimulators(opts, state, deps);
  if (opts.prune) return prune(opts, state, deps);
  let asked: NewSimulator[] | null = null;
  if (opts.create[0] === "") ({ opts, asked } = await askForSimulators(opts, state, deps));

  const wantsPlan = opts.setup === true || opts.create.length > 0 || opts.dryRun;
  const canStart = state.simulators.length > 0;

  if (wantsPlan || opts.check || !canStart) {
    const version = chooseVersion(opts, state);
    const target = asked ? askedTarget(version, asked) : opts.create.length > 0 ? namedTarget(state, version, opts.create, opts.device) : defaultTarget(state, version, opts.device);
    const steps = deps.planIos(state, target);

    if (opts.check) return check(state, steps);

    if (wantsPlan || blocking(steps).length > 0) {
      const finished = await setup(opts, steps, deps, wantsPlan);
      if (finished !== null) return finished;
      state = await busy(deps, "Checking your setup again...", deps.inspect);
    }
  } else {
    ok(`Xcode ${dim(state.xcode?.version ?? "")}`.trimEnd());
    ok(`${state.simulators.length} simulator${state.simulators.length === 1 ? "" : "s"} found`);
  }

  return start(opts, state, deps);
}

/** The iOS version for the simulator we might create: --ios, or the one that belongs to the installed Xcode. Null when we cannot tell. */
function chooseVersion(opts: Options, state: Inspection): string | null {
  if (opts.ios?.includes(".")) return opts.ios;
  const versions = state.runtimes.map((r) => r.version);
  if (opts.ios) {
    // --ios 27: the newest 27.x that is installed, or 27.0
    return versions.filter((v) => matchesIos(v, opts.ios!)).sort(compareVersions).at(-1) ?? `${opts.ios}.0`;
  }
  return state.sdkVersion ?? versions[0] ?? null;
}

function check(state: Inspection, steps: Step[]): number {
  showPlan("This is what we found:", steps);
  if (state.simulators.length > 0) {
    console.log("\nSimulators:");
    for (const sim of state.simulators) info(`- ${label(sim)}${sim.booted ? " (running)" : ""}`);
  }
  const missing = blocking(steps);
  console.log(missing.length > 0 ? "\nSomething is missing. Run start-ios-simulator --setup to fix it." : "\nEverything is set up.");
  return missing.length > 0 ? EXIT.failed : EXIT.ok;
}

/** Offer (or, with --setup, run) the setup. Returns an exit code when we are done, null when we can go on to start a simulator. */
async function setup(opts: Options, steps: Step[], deps: Deps, forced: boolean): Promise<number | null> {
  const canAsk = opts.setup !== false && (deps.interactive || opts.yes);
  if (!canAsk) {
    showPlan("Something is missing before a simulator can be started:", steps);
    console.log(opts.setup === false ? "\nSetup is switched off (--no-setup)." : "\nThere is no terminal to ask in. Run start-ios-simulator --setup, or add --yes to set up without asking.");
    return EXIT.failed;
  }

  const result = await deps.runPlan(forced ? "This is what we need:" : "Something is missing before a simulator can be started:", steps);
  if (result.declined) return EXIT.ok;
  if (!result.ok) return EXIT.failed;
  if (opts.dryRun) return EXIT.ok;
  if (forced) {
    console.log(`\nStart a simulator with: ${bold("npx start-ios-simulator")}`);
    return EXIT.ok;
  }
  return null;
}

async function start(opts: Options, state: Inspection, deps: Deps): Promise<number> {
  const config = deps.readConfig();
  const sim = await pickSimulator(opts, state.simulators, config.lastSimulator, deps);
  if (sim === null) return EXIT.failed;

  // Asking is for people who type no options and no name, anyone else knows what they want
  const ask = deps.interactive && !opts.yes && !opts.simulator && !hasStartOptions(opts);
  const chosen = ask ? await askOptions(deps) : { erase: false, headless: false };
  const erase = opts.erase || chosen.erase;
  const headless = opts.headless || chosen.headless;

  deps.writeConfig({ lastSimulator: sim.udid });

  const name = label(sim);
  if (sim.booted && !erase) {
    ok(`${name} is already running`);
    if (!headless) show(sim, deps);
    return EXIT.ok;
  }

  try {
    if (sim.booted) {
      info(`${name} is running, it is shut down first to erase it.`);
      assertOk(deps.shutdownSimulator(sim.udid), `Shutting down ${name} failed`);
    }
    if (erase) {
      assertOk(deps.eraseSimulator(sim.udid), `Erasing ${name} failed`);
      ok(`${name} is erased`);
    }

    console.log(cyan(`Booting ${name}...`));
    const boot = deps.bootSimulator(sim.udid);
    if (!boot.ok) throw new Error(`Booting ${name} failed: ${boot.output}`);
    // The window opens right away, so you see the simulator come up
    if (!headless) show(sim, deps);
    if (!opts.wait) {
      info("Started, it is still booting.");
      return EXIT.ok;
    }

    const stopSpinner = deps.startSpinner("Waiting for the simulator to boot...");
    try {
      await deps.waitForBoot(sim.udid);
    } finally {
      // The line of the spinner must be gone before anything else is printed
      stopSpinner();
    }
    ok(`${name} is ready ${dim(`(UDID: ${sim.udid})`)}`);
    return EXIT.ok;
  } catch (e) {
    fail((e as Error).message);
    return EXIT.failed;
  }
}

/** Open the app that shows the simulator. Not being able to is no reason to stop, the simulator runs. */
function show(sim: Simulator, deps: Deps): void {
  if (!deps.openSimulatorApp(sim.udid)) warn("Could not open the Simulator app (or Device Hub). The simulator is running, open it yourself.");
}

function assertOk(result: { output: string; exitCode: number }, message: string): void {
  if (result.exitCode !== 0) throw new Error(`${message}: ${result.output}`);
}

/** The simulator to start: the one that was named, the only one there is, or a pick from the list. Null after an error is shown. */
async function pickSimulator(opts: Options, all: Simulator[], last: string | undefined, deps: Deps): Promise<Simulator | null> {
  if (opts.simulator) {
    const found = findSimulator(all, opts.simulator, opts.ios);
    if ("error" in found) {
      fail(found.error);
      return null;
    }
    return found.simulator;
  }

  const sims = opts.ios ? all.filter((s) => matchesIos(s.version, opts.ios!)) : all;
  if (sims.length === 0) {
    fail(all.length === 0 ? "No simulators found. Run start-ios-simulator --setup to create one." : `There are no simulators for iOS ${opts.ios}. The simulators on this machine: ${all.map(label).join(", ")}`);
    return null;
  }
  if (sims.length === 1) {
    info(`Using the only simulator: ${label(sims[0]!)}`);
    return sims[0]!;
  }
  if (!deps.interactive) {
    fail(`There is no terminal to pick a simulator in. Give its name: start-ios-simulator <simulator>\nThe simulators on this machine: ${sims.map(label).join(", ")}`);
    return null;
  }

  const udid = await deps.select({
    message: "Which simulator do you want to start?",
    choices: sims.map((s) => ({ value: s.udid, name: choiceName(s, s.udid === last) })),
    default: sims.some((s) => s.udid === last) ? last : sims[0]!.udid,
  });
  return sims.find((s) => s.udid === udid) ?? null;
}

const choiceName = (sim: Simulator, last: boolean) => `${sim.name} ${dim(`iOS ${sim.version}`)}${sim.booted ? ` ${dim("(running)")}` : ""}${last ? ` ${dim("(last used)")}` : ""}`;

async function askOptions(deps: Deps) {
  const picked = await deps.checkbox({
    message: "Start options (space to select, enter to continue)",
    choices: [
      { value: "erase", name: "Erase all content and settings" },
      { value: "headless", name: "Headless (do not open the Simulator app)" },
    ],
  });
  return { erase: picked.includes("erase"), headless: picked.includes("headless") };
}

/** Show a spinner with what we are doing while we wait for something, and take it away when it is done. */
async function busy<T>(deps: Deps, text: string, work: () => Promise<T>): Promise<T> {
  const stop = deps.startSpinner(text);
  try {
    return await work();
  } finally {
    stop();
  }
}

/** What we say while we look at the machine, depending on what was asked. */
const lookingText = (opts: Options) =>
  opts.delete.length > 0 ? "Looking up your simulators..." : opts.prune ? "Checking your iOS runtimes..." : opts.check ? "Checking what is set up..." : "Checking your setup...";

/** A bare --create: ask for the version once and the device and name of each simulator, and go on as if the version was given on the command line. */
async function askForSimulators(opts: Options, state: Inspection, deps: Deps): Promise<{ opts: Options; asked: NewSimulator[] }> {
  if (!deps.interactive) throw new UsageError("--create without a name asks questions, and there is no terminal to ask in. Give a name: --create <name>");
  let answers;
  try {
    answers = await askNewSimulators(state.runtimes, state.sdkVersion, state.deviceTypes, state.simulators.map((s) => s.name), opts, deps);
  } catch (e) {
    if ((e as Error).name === "ExitPromptError") throw e;
    throw new UsageError((e as Error).message);
  }
  return { opts: { ...opts, ios: answers.version, create: answers.simulators.map((s) => s.name) }, asked: answers.simulators };
}

/** --delete: remove the named simulators. Asks first, unless --yes or there is no terminal to ask in. A simulator that runs is shut down first. */
async function deleteSimulators(opts: Options, state: Inspection, deps: Deps): Promise<number> {
  let names = opts.delete;
  if (names[0] === "") {
    if (!deps.interactive) throw new UsageError("--delete without a name asks which simulators, and there is no terminal to ask in. Give the names: --delete <name>");
    if (state.simulators.length === 0) {
      fail("There are no simulators to delete.");
      return EXIT.failed;
    }
    const picked = await deps.checkbox({
      message: "Which simulators do you want to delete? (space to select, enter to continue)",
      choices: state.simulators.map((s) => ({ value: s.udid, name: choiceName(s, false) })),
    });
    if (picked.length === 0) {
      console.log("Nothing deleted.");
      return EXIT.ok;
    }
    names = picked;
  }

  const found = new Map<string, Simulator>();
  for (const name of names) {
    const lookup = findSimulator(state.simulators, name, opts.ios);
    if ("error" in lookup) {
      fail(lookup.error);
      return EXIT.failed;
    }
    found.set(lookup.simulator.udid, lookup.simulator);
  }
  const sims = [...found.values()];
  const list = sims.map(label).join(", ");

  if (opts.check || opts.dryRun) {
    for (const sim of sims) info(`${opts.check ? "Would delete" : "would delete"} ${label(sim)}`);
    return EXIT.ok;
  }
  if (deps.interactive && !opts.yes) {
    const running = sims.filter((s) => s.booted).length;
    const sure = await deps.confirm({ message: `Delete ${list}? This removes the simulator and all its data.${running ? " A simulator that runs is shut down first." : ""}`, default: false });
    if (!sure) {
      console.log("Nothing deleted.");
      return EXIT.ok;
    }
  }

  let allDeleted = true;
  for (const sim of sims) {
    if (sim.booted) deps.shutdownSimulator(sim.udid);
    const { output, exitCode } = deps.deleteSimulator(sim.udid);
    if (exitCode === 0) {
      ok(`Deleted ${label(sim)}`);
    } else {
      fail(`Deleting ${label(sim)} failed`);
      info(output);
      allDeleted = false;
    }
  }
  return allDeleted ? EXIT.ok : EXIT.failed;
}

/** --prune: remove the iOS runtimes that no simulator runs on (about 8 GB each), and the simulators that lost their runtime. */
async function prune(opts: Options, state: Inspection, deps: Deps): Promise<number> {
  const images = state.xcode ? deps.listRuntimeImages() : null;
  const usage = state.xcode ? deps.simulatorUsage() : null;
  if (!images || !usage) {
    fail("Could not read the iOS runtimes. Is Xcode installed? Run start-ios-simulator --check.");
    return EXIT.failed;
  }

  const runtimes = unusedRuntimes(images, usage.usedRuntimes);
  const items = [
    ...runtimes.map((r) => ({ value: `runtime:${r.id}`, name: runtimeLabel(r), bytes: r.sizeBytes })),
    ...(usage.unavailable > 0 ? [{ value: "unavailable", name: `${usage.unavailable} simulator${usage.unavailable === 1 ? "" : "s"} that cannot run anymore, their iOS is gone`, bytes: 0 }] : []),
  ];
  if (items.length === 0) {
    ok("Nothing to remove, every iOS runtime has a simulator");
    return EXIT.ok;
  }

  // Everything nobody needs is selected, you deselect what you want to keep
  let chosen = items.map((i) => i.value);
  if (!opts.yes && !opts.dryRun) {
    if (!deps.interactive) throw new UsageError("--prune asks what to remove, and there is no terminal to ask in. Add --yes to remove everything that is unused, or --dry-run to see it.");
    chosen = await deps.checkbox({
      message: "Nobody uses these. Which do you want to remove? (space to select, enter to continue)",
      choices: items.map((i) => ({ value: i.value, name: i.name, checked: true })),
    });
  }
  const picked = items.filter((i) => chosen.includes(i.value));
  if (picked.length === 0) {
    console.log("Nothing removed.");
    return EXIT.ok;
  }

  if (opts.dryRun || opts.check) {
    for (const item of picked) info(`would remove ${item.name}`);
    return EXIT.ok;
  }
  const freed = picked.reduce((total, i) => total + i.bytes, 0);
  if (deps.interactive && !opts.yes) {
    const sure = await deps.confirm({ message: `Remove ${picked.length} item${picked.length === 1 ? "" : "s"}${freed ? ` (${formatSize(freed)})` : ""}? A runtime can be downloaded again later.`, default: false });
    if (!sure) {
      console.log("Nothing removed.");
      return EXIT.ok;
    }
  }

  let failed = false;
  for (const item of picked) {
    const result = await busy(deps, `Removing ${item.name}...`, () => (item.value === "unavailable" ? deps.deleteUnavailableSimulators() : deps.deleteRuntime(item.value.slice("runtime:".length))));
    if (result.exitCode === 0) {
      ok(`Removed ${item.name}`);
    } else {
      fail(`Removing ${item.name} failed`);
      info(result.output);
      failed = true;
    }
  }
  return failed ? EXIT.failed : EXIT.ok;
}

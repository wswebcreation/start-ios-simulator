import { checkbox, select } from "@inquirer/prompts";
import { readFileSync } from "node:fs";
import { HELP, UsageError, hasStartOptions, parseOptions, type Options } from "./args.ts";
import { printAbout, printBanner } from "./banner.ts";
import { readConfig, writeConfig } from "./config.ts";
import { type Inspection, inspect } from "./ios/inspect.ts";
import { compareVersions } from "./ios/runtimes.ts";
import { defaultTarget, namedTarget, planIos } from "./ios/setup.ts";
import { type Simulator, bootSimulator, eraseSimulator, findSimulator, label, matchesIos, openSimulatorApp, shutdownSimulator, waitForBoot } from "./ios/simulators.ts";
import { blocking, runPlan, showPlan, type Step } from "./plan.ts";
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
  openSimulatorApp,
  waitForBoot,
  readConfig,
  writeConfig,
  select: select as (options: unknown) => Promise<string>,
  checkbox: checkbox as (options: unknown) => Promise<string[]>,
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

  let state = deps.inspect();
  const wantsPlan = opts.setup === true || opts.create.length > 0 || opts.dryRun;
  const canStart = state.simulators.length > 0;

  if (wantsPlan || opts.check || !canStart) {
    const version = chooseVersion(opts, state);
    const target = opts.create.length > 0 ? namedTarget(state, version, opts.create, opts.device) : defaultTarget(state, version, opts.device);
    const steps = deps.planIos(state, target);

    if (opts.check) return check(state, steps);

    if (wantsPlan || blocking(steps).length > 0) {
      const finished = await setup(opts, steps, deps, wantsPlan);
      if (finished !== null) return finished;
      state = deps.inspect();
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

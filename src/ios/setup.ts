import { dry, runPlan, type PlanResult, type Step } from "../plan.ts";
import { fail, info, ok, settings, warn } from "../ui.ts";
import { type Inspection, inspect } from "./inspect.ts";
import { downloadRuntime, hasRuntime, listRuntimes, registerDownloadedRuntime } from "./runtimes.ts";
import { createSimulator, defaultDevice, expandName, findDevice, simulatorName } from "./simulators.ts";
import { acceptLicenseAndInstallComponents, selectXcode } from "./xcode.ts";

export interface SimulatorSpec {
  name: string;
  /** The device type, like "iPhone 18 Pro" */
  device: string;
}

/** What we want to end up with. */
export interface SetupTarget {
  /** The iOS version, like "27.0". Null when we cannot know it yet, because there is no Xcode. */
  version: string | null;
  simulators: SimulatorSpec[];
  /** Any simulator that already exists is good enough, ours is only created when there is none */
  anySimulatorWillDo: boolean;
}

/** One simulator, with the newest iPhone Pro that the installed iOS can run, unless a device is asked for. */
export const defaultTarget = (state: Inspection, version: string | null, device = defaultDevice(state.deviceTypes)): SetupTarget => ({
  version,
  simulators: [{ name: simulatorName(device, version ?? "{ios}"), device }],
  anySimulatorWillDo: true,
});

/** Simulators with these names (see expandName). Any that already exists is left alone. */
export const namedTarget = (state: Inspection, version: string | null, names: string[], device = defaultDevice(state.deviceTypes)): SetupTarget => ({
  version,
  simulators: names.map((name) => ({ name: version ? expandName(name, version) : name, device })),
  anySimulatorWillDo: false,
});

/**
 * Describe every step: what it is, whether it is already done, and how to do it. Nothing is changed here.
 * What is `required` stops a simulator from being created. When a simulator can already be started, the steps before
 * the simulator itself are only nice to have.
 */
export function planIos(state: Inspection, target: SetupTarget): Step[] {
  const existing = new Set(state.simulators.map((s) => s.name));
  const toCreate = target.anySimulatorWillDo ? (state.simulators.length === 0 ? target.simulators : []) : target.simulators.filter((s) => !existing.has(s.name));
  const needWork = toCreate.length > 0;
  const version = target.version;

  return [
    {
      id: "xcode",
      title: "Xcode",
      description: state.xcodeApps.length > 0
        ? "Xcode is installed, but your terminal does not use it. We point it to Xcode (this asks for your Mac password)."
        : "Apple's development tool, it contains the iOS Simulator (about 15 GB). It only comes from the App Store, so we cannot install it for you.",
      required: needWork,
      done: state.xcode !== null,
      detail: state.xcode && [state.xcode.version, state.xcode.path].filter(Boolean).join(", "),
      apply: () => xcodeStep(state),
    },
    {
      id: "license",
      title: "Xcode licence and components",
      description: "You accept the licence of Apple and Xcode installs its helper tools. This asks for your Mac password.",
      required: needWork,
      done: state.licenseReady,
      apply: () => licenseStep(),
    },
    {
      id: "runtime",
      title: `iOS ${version ?? ""} simulator runtime`.replace("  ", " "),
      description: "The iOS that runs inside the simulator (about 8 GB to download).",
      required: needWork,
      done: version !== null && state.runtimes.some((r) => r.version === version),
      apply: () => runtimeStep(version),
    },
    {
      id: "simulators",
      title: target.anySimulatorWillDo ? "An iOS simulator" : `${target.simulators.length} iOS simulator${target.simulators.length === 1 ? "" : "s"}`,
      description: `We create ${toCreate.map((s) => `${s.name} (${s.device})`).join(" and ") || "it"}.`,
      done: !needWork,
      detail: target.anySimulatorWillDo ? `${state.simulators.length} found` : target.simulators.map((s) => s.name).join(", "),
      apply: () => simulatorsStep(toCreate, version),
    },
  ];
}

async function xcodeStep(state: Inspection): Promise<boolean> {
  const app = state.xcodeApps[0];
  if (!app) {
    fail("Xcode is not installed");
    info("Open the App Store, search for Xcode and click Get. Open Xcode once when it is done, then run this setup again.");
    return false;
  }
  if (settings.dryRun) {
    dry(`would run: sudo xcode-select -s ${app}/Contents/Developer`);
    return true;
  }
  info("Your Mac password is asked next. Nothing is shown while you type, that is normal.");
  if (selectXcode(app)) {
    ok(`The terminal now uses ${app}`);
    return true;
  }
  fail("That did not work. Run this command yourself and then run this setup again:");
  info(`  sudo xcode-select -s ${app}/Contents/Developer`);
  return false;
}

async function licenseStep(): Promise<boolean> {
  if (settings.dryRun) {
    dry("would run: sudo xcodebuild -license accept, and sudo xcodebuild -runFirstLaunch");
    return true;
  }
  if (inspect().xcode === null) {
    warn("Set up Xcode first.");
    return false;
  }
  info("Your Mac password is asked next. Nothing is shown while you type, that is normal.");
  if (acceptLicenseAndInstallComponents()) {
    ok("Licence accepted, components installed");
    return true;
  }
  fail("That did not work. Run these two commands yourself and then run this setup again:");
  info("  sudo xcodebuild -license accept");
  info("  sudo xcodebuild -runFirstLaunch");
  return false;
}

async function runtimeStep(version: string | null): Promise<boolean> {
  if (settings.dryRun) {
    dry(`would run: xcodebuild -downloadPlatform iOS${version ? ` -buildVersion ${version}` : ""}`);
    return true;
  }
  if (!hasXcode()) {
    warn("Set up Xcode first.");
    return false;
  }
  if (!version) {
    fail("We cannot tell which iOS version your Xcode needs. Give it with --ios, like --ios 27.0");
    return false;
  }
  if (!hasRuntime(version)) downloadRuntime(version);
  // Xcode 27 can download a runtime without registering it, see registerDownloadedRuntime
  if (hasRuntime(version) || registerDownloadedRuntime(version)) {
    ok(`iOS ${version} simulator runtime installed`);
    return true;
  }
  fail(`The iOS ${version} runtime is not available. Check your internet connection and the free disk space (8 GB), then run this setup again.`);
  info("If it keeps failing, open Xcode > Settings > Components and download iOS from there.");
  return false;
}

/** simctl only answers when Xcode is there and ready. */
const hasXcode = () => listRuntimes() !== null;

async function simulatorsStep(toCreate: SimulatorSpec[], version: string | null): Promise<boolean> {
  if (settings.dryRun) {
    dry(`would create ${toCreate.map((s) => `${s.name} (${s.device})`).join(", ")}`);
    return true;
  }
  const runtime = listRuntimes()?.find((r) => r.version === version);
  if (!version || !runtime) {
    warn("Install the iOS simulator runtime first.");
    return false;
  }
  let allCreated = true;
  for (const spec of toCreate) {
    const device = findDevice(runtime.deviceTypes, spec.device);
    if (!device) {
      fail(`iOS ${version} cannot run a "${spec.device}". Choose one of: ${runtime.deviceTypes.map((d) => d.name).join(", ")}`);
      allCreated = false;
      continue;
    }
    const { output, exitCode } = createSimulator(spec.name, device.identifier, version);
    if (exitCode === 0) {
      ok(`Created ${spec.name} (${device.name})`);
    } else {
      fail(`Creating ${spec.name} failed`);
      info(output);
      allCreated = false;
    }
  }
  return allCreated;
}

/** Run the plan on its own, for code that wants a simulator to exist. */
export async function setupIos(state: Inspection, target: SetupTarget): Promise<PlanResult> {
  return runPlan("This is what we need:", planIos(state, target));
}

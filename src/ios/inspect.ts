import { runAsync, runFileAsync } from "../shell.ts";
import { type DeviceType, type Runtime, parseRuntimes } from "./runtimes.ts";
import { type Simulator, parseSimulators } from "./simulators.ts";
import { type XcodeInstall, findXcodeApps } from "./xcode.ts";

/** What this machine has today. Only looks, nothing is changed. */
export interface Inspection {
  xcode: XcodeInstall | null;
  /** Xcode apps in /Applications, for when Xcode is installed but the terminal does not use it */
  xcodeApps: string[];
  /** The licence is accepted and the extra components of Xcode are installed */
  licenseReady: boolean;
  /** The iOS version of this Xcode, like "27.0" */
  sdkVersion: string | null;
  runtimes: Runtime[];
  simulators: Simulator[];
  /** The iPhones and iPads the installed iOS versions can run */
  deviceTypes: DeviceType[];
}

/** Asks everything at the same time, and without blocking, so a spinner keeps turning while we wait for xcodebuild and simctl. */
export async function inspect(): Promise<Inspection> {
  const version = (await runAsync("xcodebuild -version"))?.match(/Xcode (\S+)/)?.[1];
  if (!version) return { xcode: null, xcodeApps: findXcodeApps(), licenseReady: false, sdkVersion: null, runtimes: [], simulators: [], deviceTypes: [] };

  const [path, license, firstLaunch, sdk, runtimes, simulators] = await Promise.all([
    runAsync("xcode-select -p"),
    runFileAsync("xcodebuild", ["-license", "check"]),
    runFileAsync("xcodebuild", ["-checkFirstLaunchStatus"]),
    runAsync("xcodebuild -version -sdk iphonesimulator ProductVersion"),
    simctlJsonAsync(["list", "runtimes"]),
    simctlJsonAsync(["list", "devices"]),
  ]);
  const installed = runtimes ? parseRuntimes(runtimes) : [];
  return {
    xcode: { version, path },
    xcodeApps: [],
    licenseReady: license.exitCode === 0 && firstLaunch.exitCode === 0,
    sdkVersion: sdk || null,
    runtimes: installed,
    simulators: simulators ? parseSimulators(simulators) : [],
    deviceTypes: installed[0]?.deviceTypes ?? [],
  };
}

async function simctlJsonAsync(args: string[]): Promise<unknown | null> {
  const { output, exitCode } = await runFileAsync("xcrun", ["simctl", ...args, "-j"]);
  if (exitCode !== 0) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

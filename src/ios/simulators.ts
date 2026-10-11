import { join } from "node:path";
import { run, runFile, runFileAsync } from "../shell.ts";
import { type DeviceType, compareVersions, runtimeId, simctl, simctlJson } from "./runtimes.ts";

export interface Simulator {
  udid: string;
  name: string;
  /** Like "27.0" */
  version: string;
  booted: boolean;
}

const RUNTIME_KEY = /SimRuntime\.iOS-(\d+(?:-\d+)*)$/;

/** The iOS simulators from the output of `simctl list devices -j`, newest iOS first and by name within an iOS version. */
export function parseSimulators(json: any): Simulator[] {
  const simulators: Simulator[] = [];
  for (const [key, devices] of Object.entries<any[]>(json?.devices ?? {})) {
    const version = key.match(RUNTIME_KEY)?.[1]?.replaceAll("-", ".");
    if (!version || !Array.isArray(devices)) continue;
    for (const d of devices) {
      if (d.isAvailable === false) continue;
      simulators.push({ udid: d.udid, name: d.name, version, booted: d.state === "Booted" });
    }
  }
  return simulators.sort((a, b) => compareVersions(b.version, a.version) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Null when simctl does not work. */
export function listSimulators(): Simulator[] | null {
  const json = simctlJson(["list", "devices"]);
  return json ? parseSimulators(json) : null;
}

/** --ios 27 means every 27.x, --ios 27.0 only that one. */
export const matchesIos = (version: string, requested: string) => version === requested || version.startsWith(`${requested}.`);

export const label = (sim: Simulator) => `${sim.name} (iOS ${sim.version})`;

export type Lookup = { simulator: Simulator } | { error: string };

/** The simulator the user means: by UDID, or by name (case does not matter). A name that exists for several iOS versions needs --ios. */
export function findSimulator(simulators: Simulator[], query: string, ios?: string): Lookup {
  const wanted = query.toLowerCase();
  const byUdid = simulators.find((s) => s.udid.toLowerCase() === wanted);
  if (byUdid) return { simulator: byUdid };

  const named = simulators.filter((s) => s.name.toLowerCase() === wanted || label(s).toLowerCase() === wanted);
  const matches = ios ? named.filter((s) => matchesIos(s.version, ios)) : named;
  if (matches.length === 1) return { simulator: matches[0]! };
  if (matches.length > 1) {
    return { error: `There are ${matches.length} simulators called "${query}": ${matches.map((s) => `iOS ${s.version}`).join(", ")}. Add --ios <version>, or use the UDID.` };
  }
  const known = simulators.map(label).join(", ") || "none";
  return { error: `There is no simulator called "${query}"${ios ? ` for iOS ${ios}` : ""}. The simulators on this machine: ${known}` };
}

// ─── Names and devices ──────────────────────────────────────────────────────

const iosSuffix = (version: string) => `iOS_${version.replaceAll(".", "_")}`;

/** iPhone_18_Pro_iOS_27_0: no spaces, so it is easy to type. */
export const simulatorName = (device: string, version: string) => `${device.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "")}_${iosSuffix(version)}`;

/** Fill in the version in a name given by the user: Test_iOS_{ios} becomes Test_iOS_27_0. */
export const expandName = (template: string, version: string) => template.replaceAll("{ios}", version.replaceAll(".", "_"));

/** When nothing tells us what this Xcode has: a device that every Xcode of the last years knows. */
export const FALLBACK_DEVICE = "iPhone 17 Pro";

/** The newest iPhone Pro that the iOS runtime can run, like Pixel 9 is for Android. */
export function defaultDevice(deviceTypes: DeviceType[]): string {
  const pros = deviceTypes.filter((d) => /^iPhone \d+ Pro$/.test(d.name)).sort((a, b) => compareVersions(b.name, a.name));
  return pros[0]?.name ?? deviceTypes.find((d) => d.family === "iPhone")?.name ?? FALLBACK_DEVICE;
}

/** The device type for what the user asked for (name or identifier, case does not matter), null when this iOS cannot run it. */
export function findDevice(deviceTypes: DeviceType[], requested: string): DeviceType | null {
  const wanted = requested.toLowerCase();
  return deviceTypes.find((d) => d.name.toLowerCase() === wanted || d.identifier.toLowerCase() === wanted) ?? null;
}

// ─── Doing things ───────────────────────────────────────────────────────────

export function createSimulator(name: string, deviceType: string, version: string) {
  return simctl(["create", name, deviceType, runtimeId(version)]);
}

/** Starts the boot and returns, it does not wait for it. A simulator that is booted already is fine. */
export function bootSimulator(udid: string): { ok: boolean; output: string } {
  const { output, exitCode } = simctl(["boot", udid]);
  return { ok: exitCode === 0 || /current state: Booted/i.test(output), output };
}

export const shutdownSimulator = (udid: string) => simctl(["shutdown", udid]);
export const eraseSimulator = (udid: string) => simctl(["erase", udid]);

/** Xcode 27 replaced the Simulator app by Device Hub, that one lives inside Xcode. */
export function deviceHubApp(): string | null {
  const developerDir = run("xcode-select -p");
  return developerDir ? join(developerDir, "..", "Applications", "DeviceHub.app") : null;
}

/**
 * Show the simulator in a window of its own. The Simulator app does that, with the simulator in front. Without it
 * (Xcode 27 and newer) the devices:// link of Device Hub opens that simulator in a window of its own too, one per
 * simulator. Device Hub itself is the last resort. False when none of them could be opened.
 */
export function openSimulatorApp(udid: string): boolean {
  if (runFile("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid]).exitCode === 0) return true;
  if (runFile("open", [`devices://device/open?id=${udid}`]).exitCode === 0) return true;
  const hub = deviceHubApp();
  return hub !== null && runFile("open", ["-a", hub]).exitCode === 0;
}

const BOOT_TIMEOUT_MS = 10 * 60_000;

/** Wait until the simulator has really booted, so the home screen is there, not only the process. The first boot of a new one can take minutes. */
export async function waitForBoot(udid: string, timeoutMs = BOOT_TIMEOUT_MS): Promise<void> {
  const { output, exitCode } = await runFileAsync("xcrun", ["simctl", "bootstatus", udid], { timeout: timeoutMs });
  if (exitCode !== 0) {
    const reason = output.split("\n").at(-1) || `it took longer than ${Math.round(timeoutMs / 60_000)} minutes`;
    throw new Error(`The simulator did not finish booting: ${reason}`);
  }
}

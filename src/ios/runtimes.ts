import { readdirSync } from "node:fs";
import { arch } from "node:os";
import { join } from "node:path";
import { runFile, runFileAsync, type RunResult } from "../shell.ts";

export interface DeviceType {
  name: string;
  identifier: string;
  family: string;
}

/** An iOS version that simulators can run. */
export interface Runtime {
  /** Like "27.0" */
  version: string;
  identifier: string;
  /** The iPhones and iPads this iOS can run on */
  deviceTypes: DeviceType[];
}

export const runtimeId = (version: string) => `com.apple.CoreSimulator.SimRuntime.iOS-${version.replaceAll(".", "-")}`;

export const simctl = (args: string[]) => runFile("xcrun", ["simctl", ...args]);

export function simctlJson(args: string[]): any | null {
  const { output, exitCode } = simctl([...args, "-j"]);
  if (exitCode !== 0) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

/** The iOS runtimes from the output of `simctl list runtimes -j`, newest first. */
export function parseRuntimes(json: any): Runtime[] {
  const runtimes: any[] = Array.isArray(json?.runtimes) ? json.runtimes : [];
  return runtimes
    .filter((r) => r.platform === "iOS" && r.isAvailable && typeof r.version === "string")
    .map((r) => ({
      version: r.version,
      identifier: r.identifier,
      deviceTypes: (Array.isArray(r.supportedDeviceTypes) ? r.supportedDeviceTypes : []).map((d: any) => ({ name: d.name, identifier: d.identifier, family: d.productFamily })),
    }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

export const compareVersions = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Null when simctl does not work (no Xcode, or its licence is not accepted). */
export function listRuntimes(): Runtime[] | null {
  const json = simctlJson(["list", "runtimes"]);
  return json ? parseRuntimes(json) : null;
}

export const hasRuntime = (version: string) => (listRuntimes() ?? []).some((r) => r.version === version);

/**
 * Download the iOS runtime (about 8 GB), Xcode shows its own progress.
 * On Apple Silicon Xcode 27 only finds it when we ask for the arm64 variant.
 * Without a version it is the one that belongs to the installed Xcode.
 */
export function downloadRuntime(version: string | null): boolean {
  const variant = arch() === "arm64" ? "arm64" : "universal";
  const args = ["-downloadPlatform", "iOS", "-architectureVariant", variant, ...(version ? ["-buildVersion", version] : [])];
  return runFile("xcodebuild", args, { inherit: true }).exitCode === 0;
}

/**
 * Xcode 27 can download a runtime that it then fails to register: `simctl runtime list` shows it as "Ready", but its
 * signature check fails so `simctl list runtimes` stays empty and no simulator can be created. The download does contain
 * a plain .dmg, and adding that one registers the runtime the old way (an APFS clone, so it costs almost no disk space).
 */
export function registerDownloadedRuntime(version: string): boolean {
  const images: any[] = Object.values(simctlJson(["runtime", "list"]) ?? {});
  const stuck = images.find((i) => i.runtimeIdentifier === runtimeId(version) && i.state === "Ready" && i.signatureState !== "Verified" && i.path);
  if (!stuck) return false;
  try {
    const restore = join(stuck.path, "Restore");
    const dmg = readdirSync(restore).find((file) => file.endsWith(".dmg"));
    return Boolean(dmg) && simctl(["runtime", "add", join(restore, dmg!)]).exitCode === 0 && hasRuntime(version);
  } catch {
    return false;
  }
}

/** A downloaded iOS runtime on disk. There can be more than one of the same version, and one that is unusable. */
export interface RuntimeImage {
  id: string;
  identifier: string;
  version: string;
  usable: boolean;
  sizeBytes: number;
}

/** The iOS runtimes on disk from the output of `simctl runtime list -j`, the newest first. */
export function parseRuntimeImages(json: any): RuntimeImage[] {
  return Object.entries<any>(json ?? {})
    .filter(([, i]) => i?.platformIdentifier === "com.apple.platform.iphonesimulator" && typeof i.runtimeIdentifier === "string")
    .map(([id, i]) => ({ id, identifier: i.runtimeIdentifier, version: String(i.version), usable: i.state === "Ready", sizeBytes: Number(i.sizeBytes) || 0 }))
    .sort((a, b) => compareVersions(b.version, a.version) || a.id.localeCompare(b.id));
}

/** Null when simctl does not work. */
export function listRuntimeImages(): RuntimeImage[] | null {
  const json = simctlJson(["runtime", "list"]);
  return json ? parseRuntimeImages(json) : null;
}

/** Removing the disk image of a runtime takes a moment, so this does not block the spinner. */
export const deleteRuntime = (id: string): Promise<RunResult> => runFileAsync("xcrun", ["simctl", "runtime", "delete", id]);

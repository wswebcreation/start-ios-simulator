import { readdirSync } from "node:fs";
import { join } from "node:path";
import { run, runFile } from "../shell.ts";

export interface XcodeInstall {
  version: string;
  /** The developer directory that is selected, like /Applications/Xcode.app/Contents/Developer */
  path: string | null;
}

/** Xcode itself, not only the command line tools: they have no simulator. Null when it is missing or not selected. */
export function detectXcode(): XcodeInstall | null {
  const version = run("xcodebuild -version")?.match(/Xcode (\S+)/)?.[1];
  if (!version) return null;
  return { version, path: run("xcode-select -p") };
}

/** The iOS version that the installed Xcode builds for, like "27.0". The simulator runtime we set up matches it. */
export const simulatorSdkVersion = (): string | null => run("xcodebuild -version -sdk iphonesimulator ProductVersion") || null;

export const licenseAccepted = () => runFile("xcodebuild", ["-license", "check"]).exitCode === 0;
export const firstLaunchDone = () => runFile("xcodebuild", ["-checkFirstLaunchStatus"]).exitCode === 0;

/** The Xcode apps in /Applications. Xcode can be there while the tools of the terminal point somewhere else. */
export function findXcodeApps(dir = "/Applications"): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => /^Xcode.*\.app$/.test(name))
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

const sudo = (args: string[]) => runFile("sudo", args, { inherit: true }).exitCode === 0;

/** Both need an administrator password, so they run in the terminal of the user. */
export const acceptLicenseAndInstallComponents = () => sudo(["xcodebuild", "-license", "accept"]) && sudo(["xcodebuild", "-runFirstLaunch"]);

/** Point the tools of the terminal to an Xcode app. */
export const selectXcode = (app: string) => sudo(["xcode-select", "-s", join(app, "Contents", "Developer")]);

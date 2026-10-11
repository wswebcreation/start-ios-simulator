import { readdirSync } from "node:fs";
import { join } from "node:path";
import { runFile } from "../shell.ts";

export interface XcodeInstall {
  version: string;
  /** The developer directory that is selected, like /Applications/Xcode.app/Contents/Developer */
  path: string | null;
}

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

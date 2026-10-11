import { type DeviceType, type Runtime, listRuntimes } from "./runtimes.ts";
import { type Simulator, listSimulators } from "./simulators.ts";
import { type XcodeInstall, detectXcode, findXcodeApps, firstLaunchDone, licenseAccepted, simulatorSdkVersion } from "./xcode.ts";

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

export function inspect(): Inspection {
  const xcode = detectXcode();
  const runtimes = xcode ? (listRuntimes() ?? []) : [];
  return {
    xcode,
    xcodeApps: xcode ? [] : findXcodeApps(),
    licenseReady: xcode !== null && licenseAccepted() && firstLaunchDone(),
    sdkVersion: xcode ? simulatorSdkVersion() : null,
    runtimes,
    simulators: xcode ? (listSimulators() ?? []) : [],
    deviceTypes: runtimes[0]?.deviceTypes ?? [],
  };
}

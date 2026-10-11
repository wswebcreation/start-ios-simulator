import { NAME } from "./args.ts";
import { compareVersions, type DeviceType, type Runtime } from "./ios/runtimes.ts";
import { defaultDevice, simulatorName } from "./ios/simulators.ts";

/** What the wizard asks with, so a test can answer for the user. */
export interface Asker {
  select: (options: unknown) => Promise<string>;
  input: (options: unknown) => Promise<string>;
  confirm: (options: unknown) => Promise<boolean>;
}

export interface Given {
  ios?: string;
  device?: string;
}

export interface NewSimulator {
  name: string;
  device: string;
}

const CUSTOM = "__custom__";

/**
 * Ask for the iOS version once, then the device and the name of as many simulators as the user wants.
 * What was given on the command line is not asked again. The versions are the runtimes that are installed, and the
 * one of Xcode, which we can download.
 */
export async function askNewSimulators(
  runtimes: Runtime[],
  sdkVersion: string | null,
  deviceTypes: DeviceType[],
  taken: string[],
  given: Given,
  ask: Asker,
): Promise<{ version: string; simulators: NewSimulator[] }> {
  const versions = [...new Set([...runtimes.map((r) => r.version), ...(sdkVersion ? [sdkVersion] : [])])].sort((a, b) => compareVersions(b, a));
  const preferred = sdkVersion ?? versions[0] ?? null;
  const installed = new Set(runtimes.map((r) => r.version));

  const version =
    given.ios && given.ios.includes(".")
      ? given.ios
      : given.ios
        ? (versions.find((v) => v === given.ios || v.startsWith(`${given.ios}.`)) ?? `${given.ios}.0`)
        : versions.length <= 1
          ? preferred
          : await ask.select({
              message: "Which iOS version?",
              choices: versions.map((v) => ({ value: v, name: installed.has(v) ? `iOS ${v}` : `iOS ${v} (not installed, we download it)` })),
              default: preferred,
            });
  if (!version) throw new Error("There is no iOS version to create a simulator for. Install Xcode first, or give a version with --ios.");

  const types = runtimes.find((r) => r.version === version)?.deviceTypes ?? deviceTypes;
  const names = [...taken];
  const simulators: NewSimulator[] = [];
  do {
    const device = given.device ?? (await askDevice(types, ask));
    const name = await askName(simulatorName(device, version), names, ask);
    names.push(name);
    simulators.push({ name, device });
  } while (await ask.confirm({ message: `Create another simulator? (${simulators.length} so far)`, default: false }));

  return { version, simulators };
}

async function askName(suggestion: string, taken: string[], ask: Asker): Promise<string> {
  const validName = (value: string) =>
    !NAME.test(value) || value.includes("{") ? "Use letters, numbers, _ . - and no spaces" : taken.includes(value) ? `There is a simulator called ${value} already` : true;
  const picked = taken.includes(suggestion)
    ? CUSTOM
    : await ask.select({
        message: "What should the simulator be called?",
        choices: [{ value: suggestion, name: `${suggestion} (suggested)` }, { value: CUSTOM, name: "Type my own name" }],
        default: suggestion,
      });
  return picked === CUSTOM ? ask.input({ message: "Name of the simulator (use letters, numbers, _ . -)", validate: validName }) : picked;
}

async function askDevice(types: DeviceType[], ask: Asker): Promise<string> {
  const suggestion = defaultDevice(types);
  const phones = types.filter((d) => d.family === "iPhone");
  const tablets = types.filter((d) => d.family === "iPad");
  return ask.select({
    message: "Which device?",
    choices: [...phones, ...tablets].map((d) => ({ value: d.name, name: d.name })),
    default: suggestion,
  });
}

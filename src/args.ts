import { parseArgs } from "node:util";
import { aboutText } from "./about.ts";

export interface Options {
  /** The simulator to start, by name or UDID, instead of picking one from a list */
  simulator?: string;
  /** Delete everything on the simulator before starting it */
  erase: boolean;
  /** Do not open the Simulator app: the simulator runs without a window, enough for Appium and for CI */
  headless: boolean;
  /** Wait until the simulator has booted. --no-wait starts it and returns. */
  wait: boolean;
  /** true for --setup (always show the setup plan), false for --no-setup (never offer it), undefined to offer it when something is missing */
  setup?: boolean;
  /** Only show what is there and what is missing */
  check: boolean;
  /** Answer yes to every question */
  yes: boolean;
  dryRun: boolean;
  /** The iOS version, like 27 or 27.0 */
  ios?: string;
  /** Simulators to create, by name. {ios} in a name becomes the iOS version, like 27_0 */
  create: string[];
  /** The iPhone or iPad for the simulators to create, like "iPhone 17 Pro" */
  device?: string;
  help: boolean;
  version: boolean;
}

/** A mistake in how the command was used. The message is meant for the user. */
export class UsageError extends Error {}

export const HELP = `${aboutText()}

Usage: start-ios-simulator [simulator] [options]

The simulator is its name, like "iPhone 17 Pro", or its UDID.

Start options
  --erase            Delete all content and settings of the simulator before starting
  --headless         Do not open the Simulator app, the simulator runs without a window
  --no-wait          Start the simulator and return, without waiting for it to boot
  --ios <version>    Only the simulators of this iOS version, like 26 or 27.0

Setup
  --setup            Show the setup plan, also when nothing is missing
  --no-setup         Never offer to install anything, only report what is missing
  --create <name>    Create a simulator with this name, repeat it for more. {ios} becomes the iOS version,
                     like --create "Test_iOS_{ios}" for Test_iOS_27_0
  --device <device>  The iPhone or iPad for the simulators to create (default: the newest iPhone Pro)
  --dry-run          Show what the setup would do, without changing anything

Other
  --check            Only show what is set up and what is missing, exits with 1 when something is missing
  -y, --yes          Answer yes to every question (also needed to set up without a terminal)
  -h, --help         Show this help
  -v, --version      Show the version
`;

const IOS = /^\d+(\.\d+)?$/;
const NAME = /^[\w.{}-]+$/;

export function parseOptions(argv: string[]): Options {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        erase: { type: "boolean" },
        headless: { type: "boolean" },
        wait: { type: "boolean" },
        setup: { type: "boolean" },
        check: { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        "dry-run": { type: "boolean" },
        ios: { type: "string" },
        create: { type: "string", multiple: true },
        device: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    throw new UsageError(`${(e as Error).message}\n\nRun start-ios-simulator --help for the options.`);
  }

  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new UsageError(`Only one simulator can be started at a time, but you gave ${positionals.length}: ${positionals.join(", ")}`);
  if (values.ios !== undefined && !IOS.test(values.ios)) throw new UsageError(`"${values.ios}" is not an iOS version, use for example --ios 27.0`);
  const create = values.create ?? [];
  for (const name of create) {
    if (!NAME.test(name)) throw new UsageError(`"${name}" is not a valid simulator name, use letters, numbers, _ . - and {ios}`);
  }
  if (positionals[0] && create.length > 0) throw new UsageError("--create sets up simulators, it does not start one. Start them afterwards with their name.");
  if (values.device && create.length === 0) throw new UsageError("--device is for the simulators you create, add --create <name>.");

  return {
    simulator: positionals[0],
    erase: values.erase ?? false,
    headless: values.headless ?? false,
    wait: values.wait ?? true,
    setup: values.setup,
    check: values.check ?? false,
    yes: values.yes ?? false,
    dryRun: values["dry-run"] ?? false,
    ios: values.ios,
    create,
    device: values.device,
    help: values.help ?? false,
    version: values.version ?? false,
  };
}

/** Any option about how to start: when one is given the user knows what they want, so we do not ask. */
export const hasStartOptions = (o: Options) => o.erase || o.headless;

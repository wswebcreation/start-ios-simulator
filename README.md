# start-ios-simulator

Start an iOS simulator from your terminal. No iOS runtime or simulator yet? It sets them up for you.

```
npm install -g start-ios-simulator
start-ios-simulator
```

Requires Node.js 24 or newer and a Mac with [Xcode](https://apps.apple.com/app/xcode/id497799835), the iOS Simulator is a part of it.

## What can it do?

| Command | What it does |
| --- | --- |
| `start-ios-simulator` | Pick a simulator from the list, and start it |
| `start-ios-simulator "iPhone 17 Pro"` | Start a simulator by name (or by UDID) |
| `start-ios-simulator --check` | See what is set up and what is missing, and which simulators exist |
| `start-ios-simulator --setup` | Install what is missing |
| `start-ios-simulator --create` | Create a simulator, pick the iOS version, device and name from a list |
| `start-ios-simulator --delete` | Delete simulators, see [below](#deleting-simulators) |
| `start-ios-simulator --prune` | Remove iOS runtimes no simulator uses, see [below](#freeing-disk-space) |

Every simulator opens in a window of its own (on Xcode 27 and newer too, where the Simulator app has been replaced by Device Hub). It waits until the simulator has booted, remembers the one you used last, and leaves the simulator running when the command ends. A simulator that is running already is not restarted.

### Pick the version, device and name from a list

```
start-ios-simulator --create
```

Without a name you are asked which iOS version (the installed ones, and the one of your Xcode), which device (every iPhone and iPad this iOS can run) and what the simulator is called: the suggested name, like `iPhone_18_Pro_iOS_27_0`, or your own. Then you can add another one.

### Several simulators with your own names

```
start-ios-simulator --create "Test_1_iOS_{ios}" --create "Test_2_iOS_{ios}" --device "iPhone 17 Pro" --yes
```

Each `--create` makes one simulator, and `{ios}` becomes the iOS version (`Test_1_iOS_27_0`). Use `--ios 26.4` for another version than the one of your Xcode. Simulators that already exist are left alone.

### Deleting simulators

```
start-ios-simulator --delete
```

Without a name you get a list of your simulators and select the ones to delete (space to select, enter to continue). With a name or UDID it goes straight to the question:

```
start-ios-simulator --delete Test_1_iOS_27_0 --delete Test_2_iOS_27_0
```

You are asked to confirm first, `--yes` skips the question and `--dry-run` only shows what would be deleted. A simulator that is running is shut down first. `--delete` cannot be combined with `--create` or a simulator to start.

### Freeing disk space

```
start-ios-simulator --prune
```

Every iOS runtime is about 8 GB. `--prune` lists the runtimes that no simulator uses, the unusable ones, and the simulators that cannot run anymore because their iOS is gone. Everything is selected, deselect what you want to keep. A runtime can be downloaded again later with `--setup`. Use `--dry-run` to only see them, and `--yes` to remove everything without asking.

### When something is missing

When the Xcode licence, the iOS runtime or a simulator are missing, you see a plan of what is needed and you choose to do everything, pick steps, or nothing. It can:

- accept the Xcode licence and install its extra components (asks for your Mac password)
- select Xcode for the terminal when it is installed but the terminal uses something else
- download the iOS simulator runtime that belongs to your Xcode (about 8 GB)
- create a simulator, by default the newest iPhone Pro (`iPhone_18_Pro_iOS_27_0`)

Xcode itself only comes from the App Store, so that one you install yourself.

## Options

```
Start options
  --erase            Delete all content and settings of the simulator before starting
  --headless         Do not open the Simulator app, the simulator runs without a window
  --no-wait          Start the simulator and return, without waiting for it to boot
  --ios <version>    Only the simulators of this iOS version, like 26 or 27.0

Setup
  --setup            Show the setup plan, also when nothing is missing
  --no-setup         Never offer to install anything, only report what is missing
  --create [name]    Create a simulator with this name, repeat it for more. {ios} becomes the iOS version,
                     like --create "Test_iOS_{ios}" for Test_iOS_27_0.
                     Without a name you pick the version, the device and the name from a list
  --delete [name]    Delete the simulator with this name (or UDID), repeat it for more.
                     Without a name you pick the simulators to delete from a list
  --prune            Remove the iOS runtimes no simulator uses, and the simulators that cannot run anymore
  --device <device>  The iPhone or iPad for the simulators to create (default: the newest iPhone Pro)
  --dry-run          Show what the setup would do, without changing anything

Other
  --check            Only show what is set up and what is missing, exits with 1 when something is missing
  -y, --yes          Answer yes to every question (also needed to set up without a terminal)
  -h, --help         Show this help
  -v, --version      Show the version
```

Your last simulator is saved in `~/.config/start-ios-simulator/config.json`.

## Use it from code

```ts
import { inspect, listSimulators, namedTarget, setupIos } from "start-ios-simulator";

const state = inspect();
const target = namedTarget(state, state.sdkVersion, ["Test_1_iOS_{ios}", "Test_2_iOS_{ios}"]);
await setupIos(state, target);
console.log(listSimulators());
```

`main(argv)` runs the whole CLI and returns the exit code, for example `await main(["--create", "Test_1_iOS_{ios}", "--yes"])`.

## Upgrading from 1.x

The module is now written in TypeScript and needs Node.js 24. It lists every iOS version, so a simulator is no longer shown as `iPhone 17 Pro 26.4` but as `iPhone 17 Pro (iOS 26.4)`. A simulator that runs already is no longer restarted, use `--erase` to start from scratch.

## Development

```
npm install
npm run build:watch   # build on every change
npm test              # or npm run test:watch
npm run typecheck
```

## Releasing

Releases are made by GitHub Actions ([release.yml](.github/workflows/release.yml)) and published to npm with trusted publishing, so no npm token is needed.

1. Merge your changes into `main` and make sure the tests are green.
2. On GitHub, go to Actions, Release, Run workflow. Choose `main`, the release type (`patch`, `minor` or `major`) and the npm tag (`latest`, or `next` for a test version).
3. The workflow runs the tests, bumps the version, publishes to npm with provenance, pushes the version commit and the `vX.Y.Z` tag, and creates the GitHub release with generated release notes. Only the owner of the repository can run it.

Give every pull request one of the `PR: …` labels (Breaking Change, New Feature, Bug Fix, Polish, Docs, Internal) to get it under the right heading in the release notes, see [.github/release.yml](.github/release.yml). `skip-changelog` leaves a pull request out.

One-time setup on npmjs.com: package settings, Trusted Publisher, GitHub Actions, repository `wswebcreation/start-ios-simulator`, workflow `release.yml`, with "Allow npm publish" ticked.

## License

MIT

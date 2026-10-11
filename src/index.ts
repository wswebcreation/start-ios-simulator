/** The public API, for projects that want to set up iOS simulators from their own code. */
export { main } from "./flow.ts";
export { inspect, type Inspection } from "./ios/inspect.ts";
export { listSimulators, defaultDevice, simulatorName, type Simulator } from "./ios/simulators.ts";
export { listRuntimes, type Runtime, type DeviceType } from "./ios/runtimes.ts";
export { defaultTarget, namedTarget, planIos, setupIos, type SetupTarget } from "./ios/setup.ts";

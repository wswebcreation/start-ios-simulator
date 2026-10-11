/** The public API, for projects that want to set up iOS simulators from their own code. */
export { main } from "./flow.ts";
export { inspect, type Inspection } from "./ios/inspect.ts";
export { listSimulators, defaultDevice, simulatorName, bootSimulator, waitForBoot, shutdownSimulator, type Simulator } from "./ios/simulators.ts";
export { listRuntimes, type Runtime, type DeviceType } from "./ios/runtimes.ts";
export { defaultTarget, namedTarget, planIos, setupIos, type SetupTarget, type SimulatorSpec } from "./ios/setup.ts";
export { runPlan, dry, type Step, type PlanResult } from "./plan.ts";
export { configure } from "./configure.ts";

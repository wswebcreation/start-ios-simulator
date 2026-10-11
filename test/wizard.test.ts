import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeviceType, Runtime } from "../src/ios/runtimes.ts";
import { askNewSimulators, type Asker } from "../src/wizard.ts";

const type = (name: string, family = "iPhone"): DeviceType => ({ name, identifier: name, family });
const types = [type("iPhone 17"), type("iPhone 18 Pro"), type("iPad Air", "iPad")];
const runtime = (version: string): Runtime => ({ version, identifier: version, deviceTypes: types });

/** The user answers with `answers`, in the order of the questions. A missing answer is the default. */
function user(answers: (string | boolean)[] = []) {
  const asked: { message: string; choices?: { value: string; name: string }[]; default?: unknown }[] = [];
  const next = (options: any) => {
    asked.push(options);
    const answer = answers.shift();
    return answer ?? options.default;
  };
  const ask: Asker = { select: async (o) => next(o) as string, input: async (o) => next(o) as string, confirm: async (o) => (next(o) as boolean | undefined) ?? false };
  return { ask, asked };
}

test("with one iOS version it is not asked, then the device and the name, and the suggestions are the defaults", async () => {
  const { ask, asked } = user();
  const result = await askNewSimulators([runtime("27.0")], "27.0", types, [], {}, ask);
  assert.deepEqual(result, { version: "27.0", simulators: [{ name: "iPhone_18_Pro_iOS_27_0", device: "iPhone 18 Pro" }] });
  assert.deepEqual(asked.map((q) => q.message), ["Which device?", "What should the simulator be called?", "Create another simulator? (1 so far)"]);
  assert.deepEqual(asked[0]!.choices!.map((c) => c.value), ["iPhone 17", "iPhone 18 Pro", "iPad Air"], "iPhones first, then iPads");
});

test("with more versions you pick one, and the one of Xcode that is not installed yet says so", async () => {
  const { ask, asked } = user(["26.5"]);
  const result = await askNewSimulators([runtime("26.5")], "27.0", types, [], {}, ask);
  assert.equal(result.version, "26.5");
  assert.deepEqual(asked[0]!.choices!.map((c) => c.name), ["iOS 27.0 (not installed, we download it)", "iOS 26.5"]);
  assert.equal(asked[0]!.default, "27.0", "the one of Xcode is the default");
});

test("what is given on the command line is not asked again", async () => {
  const { ask, asked } = user();
  const result = await askNewSimulators([runtime("26.4"), runtime("27.0")], "27.0", types, [], { ios: "26", device: "iPhone 17" }, ask);
  assert.equal(result.version, "26.4");
  assert.deepEqual(asked.map((q) => q.message), ["What should the simulator be called?", "Create another simulator? (1 so far)"]);
  assert.equal(result.simulators[0]!.name, "iPhone_17_iOS_26_4");
  assert.equal((await askNewSimulators([], "27.0", types, [], { ios: "28" }, user().ask)).version, "28.0", "a version we do not know yet");
});

test("you can type your own name, and the question refuses a name that is not valid or taken", async () => {
  const { ask, asked } = user(["iPhone 17", "__custom__", "My_Sim"]);
  const result = await askNewSimulators([runtime("27.0")], "27.0", types, ["Taken"], {}, ask);
  assert.equal(result.simulators[0]!.name, "My_Sim");
  const validate = (asked[2] as any).validate as (v: string) => true | string;
  assert.equal(validate("Fine_1"), true);
  assert.match(validate("has space") as string, /no spaces/);
  assert.match(validate("{ios}") as string, /no spaces/);
  assert.match(validate("Taken") as string, /already/);
});

test("you can add more simulators, and a suggestion that is taken is not offered again", async () => {
  // device, name, another?, device, (the suggestion is taken, so only the name to type), another?
  const { ask, asked } = user(["iPhone 17", "iPhone_17_iOS_27_0", true, "iPhone 17", "Second", false]);
  const result = await askNewSimulators([runtime("27.0")], "27.0", types, [], {}, ask);
  assert.deepEqual(result.simulators.map((s) => s.name), ["iPhone_17_iOS_27_0", "Second"]);
  assert.deepEqual(asked.map((q) => q.message), [
    "Which device?", "What should the simulator be called?", "Create another simulator? (1 so far)",
    "Which device?", "Name of the simulator (use letters, numbers, _ . -)", "Create another simulator? (2 so far)",
  ]);
});

test("without any iOS version there is nothing to create a simulator for", async () => {
  await assert.rejects(askNewSimulators([], null, [], [], {}, user().ask), /Install Xcode first/);
});

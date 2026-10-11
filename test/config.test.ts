import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { configFile, readConfig, writeConfig } from "../src/config.ts";

const root = mkdtempSync(join(tmpdir(), "start-ios-simulator-config-"));
const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

beforeEach(() => {
  rmSync(join(root, "config"), { recursive: true, force: true });
  process.env.HOME = root;
  process.env.XDG_CONFIG_HOME = join(root, "config");
});
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

test("the settings live in a folder of their own in the config folder", () => {
  assert.equal(configFile(), join(root, "config", "start-ios-simulator", "config.json"));
});

test("without a file there is nothing remembered", () => {
  assert.deepEqual(readConfig(), {});
});

test("what is written is read back, and a key set to undefined is forgotten", () => {
  writeConfig({ lastSimulator: "ABC-123" });
  assert.deepEqual(readConfig(), { lastSimulator: "ABC-123" });
  writeConfig({ lastSimulator: undefined });
  assert.deepEqual(readConfig(), {});
  assert.equal(JSON.parse(readFileSync(configFile(), "utf8")).lastSimulator, undefined);
});

test("a broken or unexpected file is the same as an empty one", () => {
  mkdirSync(dirname(configFile()), { recursive: true });
  for (const content of ["{not json", "42", "null", '{"lastSimulator": 5, "other": 1}']) {
    writeFileSync(configFile(), content);
    assert.deepEqual(readConfig(), {}, content);
  }
});

test("not being able to write is not an error", () => {
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "start-ios-simulator"), "this is a file, so the folder cannot be made");
  assert.doesNotThrow(() => writeConfig({ lastSimulator: "A" }));
});

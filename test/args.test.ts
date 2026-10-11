import assert from "node:assert/strict";
import { test } from "node:test";
import { HELP, UsageError, hasStartOptions, parseOptions } from "../src/args.ts";

test("without arguments everything is off, and we wait for the boot", () => {
  assert.deepEqual(parseOptions([]), {
    simulator: undefined,
    erase: false,
    headless: false,
    wait: true,
    setup: undefined,
    check: false,
    yes: false,
    dryRun: false,
    ios: undefined,
    create: [],
    device: undefined,
    help: false,
    version: false,
  });
});

test("a simulator name and the start options", () => {
  const o = parseOptions(["iPhone 17 Pro", "--erase", "--headless", "--no-wait"]);
  assert.equal(o.simulator, "iPhone 17 Pro");
  assert.deepEqual([o.erase, o.headless, o.wait], [true, true, false]);
});

test("setup is forced with --setup, forbidden with --no-setup, and left to the program otherwise", () => {
  assert.equal(parseOptions(["--setup"]).setup, true);
  assert.equal(parseOptions(["--no-setup"]).setup, false);
  assert.equal(parseOptions([]).setup, undefined);
});

test("the short flags", () => {
  assert.equal(parseOptions(["-y"]).yes, true);
  assert.equal(parseOptions(["-h"]).help, true);
  assert.equal(parseOptions(["-v"]).version, true);
});

test("--ios takes 27 or 27.0, and nothing else", () => {
  assert.equal(parseOptions(["--ios", "27"]).ios, "27");
  assert.equal(parseOptions(["--ios", "26.4"]).ios, "26.4");
  assert.throws(() => parseOptions(["--ios", "latest"]), /not an iOS version/);
});

test("--create can be repeated, and {ios} is allowed in a name", () => {
  const o = parseOptions(["--create", "Test_1_iOS_{ios}", "--create", "Test_2_iOS_{ios}", "--device", "iPhone 17"]);
  assert.deepEqual(o.create, ["Test_1_iOS_{ios}", "Test_2_iOS_{ios}"]);
  assert.equal(o.device, "iPhone 17");
  assert.throws(() => parseOptions(["--create", "has space"]), /not a valid simulator name/);
});

test("mistakes in how the command is used are explained", () => {
  assert.throws(() => parseOptions(["--nope"]), (e) => e instanceof UsageError && /--help/.test(e.message));
  assert.throws(() => parseOptions(["A", "B"]), /Only one simulator/);
  assert.throws(() => parseOptions(["A", "--create", "B"]), /does not start one/);
  assert.throws(() => parseOptions(["--device", "iPhone 17"]), /add --create/);
});

test("any option about how to start means we do not ask", () => {
  assert.equal(hasStartOptions(parseOptions([])), false);
  assert.equal(hasStartOptions(parseOptions(["--erase"])), true);
  assert.equal(hasStartOptions(parseOptions(["--headless"])), true);
});

test("the help lists every option", () => {
  for (const flag of ["--erase", "--headless", "--no-wait", "--ios", "--setup", "--no-setup", "--create", "--device", "--dry-run", "--check", "--yes", "--help", "--version"]) {
    assert.ok(HELP.includes(flag), flag);
  }
});

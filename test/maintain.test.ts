import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSize, runtimeLabel, unusedRuntimes } from "../src/ios/maintain.ts";
import type { RuntimeImage } from "../src/ios/runtimes.ts";

const image = (version: string, extra: Partial<RuntimeImage> = {}): RuntimeImage => ({
  id: `ID-${version}`,
  identifier: `com.apple.CoreSimulator.SimRuntime.iOS-${version.replace(".", "-")}`,
  version,
  usable: true,
  sizeBytes: 8_000_000_000,
  ...extra,
});

test("a runtime without a simulator is unused, and one that is unusable always is", () => {
  const images = [image("27.0"), image("26.5"), image("27.0", { id: "ID-stuck", usable: false })];
  const used = new Set([image("27.0").identifier]);
  assert.deepEqual(unusedRuntimes(images, used).map((i) => i.id), ["ID-26.5", "ID-stuck"]);
  assert.deepEqual(unusedRuntimes(images, new Set(images.map((i) => i.identifier))).map((i) => i.id), ["ID-stuck"]);
  assert.deepEqual(unusedRuntimes([], used), []);
});

test("sizes are in GB for a runtime, and in MB for something small", () => {
  assert.equal(formatSize(8_494_282_293), "8.5 GB");
  assert.equal(formatSize(250_000_000), "250 MB");
  assert.equal(formatSize(0), "1 MB");
});

test("a runtime is shown by its iOS version and size, and says when it is unusable", () => {
  assert.equal(runtimeLabel(image("26.5")), "iOS 26.5 runtime, 8.0 GB");
  assert.equal(runtimeLabel(image("27.0", { usable: false })), "iOS 27.0 runtime, 8.0 GB, unusable");
});

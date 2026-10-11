import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { COMMANDS, INTRO, MORE, aboutText } from "../src/about.ts";
import { HEAD, aboutLines, bannerLines, colorSupport, logo, printAbout, printBanner, title } from "../src/banner.ts";
import { HELP } from "../src/args.ts";

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
let output: string[];
beforeEach(() => {
  output = [];
  mock.method(console, "log", (...args: unknown[]) => output.push(args.join(" ")));
});
afterEach(() => mock.restoreAll());

test("the Apple logo is drawn in braille dots, in one even block", () => {
  assert.ok(HEAD.length >= 9);
  assert.equal(new Set(HEAD.map((line) => line.length)).size, 1, "every line is as wide as the others");
  assert.ok(HEAD.every((line) => /^[⠀-⣿]+$/.test(line)), "only braille");
  assert.ok(HEAD[0]!.length <= 40, "it fits a small terminal");
  assert.ok(HEAD.some((line) => line.includes("⣿")), "it has a filled body");
});

test("the logo of wswebcreation is the name in a thick frame, as wide on every row", () => {
  const rows = logo();
  assert.equal(rows.length, 3);
  assert.match(rows[1]!, /^┃\s+W S W E B C R E A T I O N\s+┃$/);
  assert.equal(rows[0], `┏${"━".repeat(rows[1]!.length - 2)}┓`);
  assert.equal(rows[2], `┗${"━".repeat(rows[1]!.length - 2)}┛`);
  assert.equal(new Set(rows.map((row) => row.length)).size, 1);
});

test("the logo of wswebcreation is a bit wider than the Apple logo, so the Apple logo is the one that is moved to the middle", () => {
  assert.ok(HEAD[0]!.length <= logo()[0]!.length);
  const lines = bannerLines("1", "none");
  const apple = lines.find((l) => l.includes(HEAD[5]!))!;
  const frame = lines.find((l) => l.includes("┏"))!;
  const centerOf = (line: string, text: string) => line.indexOf(text) + text.length / 2;
  assert.ok(Math.abs(centerOf(apple, HEAD[5]!) - centerOf(frame, "┏")) <= 1 + (logo()[0]!.length - 1) / 2 - 0.5, "the Apple logo is above the middle of the frame");
});

test("the banner shows the Apple logo, the name of the tool with its version, and the logo", () => {
  const text = plain(bannerLines("1.2.0", "none").join("\n"));
  for (const line of HEAD) assert.ok(text.includes(line));
  assert.match(text, /iOS Simulator CLI Helper v1\.2\.0\n\s*by\n\s*┏━+┓\n\s*┃  W S W E B C R E A T I O N  ┃\n\s*┗━+┛/);
});

test("the name, 'by' and the logo are centered under the Apple logo", () => {
  const lines = bannerLines("1.2.0", "none");
  const width = logo()[0]!.length;
  const centerOf = (line: string) => line.length - line.trimStart().length + line.trim().length / 2;
  for (const row of [...logo(), "by"]) {
    const line = lines.find((l) => l.trim() === row)!;
    assert.ok(Math.abs(centerOf(line) - width / 2) <= 1, `${row} is centered`);
  }
});

test("the Apple logo is silver, in the exact colour when the terminal can do it", () => {
  const silver = bannerLines("1", "truecolor").find((line) => line.includes(HEAD[3]!))!;
  assert.ok(silver.trimStart().startsWith("\x1b[38;2;162;170;173m"), "#A2AAAD");
  assert.ok(silver.endsWith("\x1b[0m"));
  assert.ok(bannerLines("1", "ansi").find((line) => line.includes(HEAD[3]!))!.trimStart().startsWith("\x1b[1m"), "bold text colour otherwise");
});

test("without colour there are no escape codes at all, but the art is still there", () => {
  const text = bannerLines("1", "none").join("\n");
  assert.doesNotMatch(text, /\x1b/);
  assert.ok(text.includes(HEAD[3]!));
});

test("the spaces that center a line are not painted", () => {
  const line = bannerLines("1", "truecolor").find((l) => l.includes("by"))!;
  assert.match(line, /^ +\x1b\[2mby\x1b\[0m$/);
});

test("colour support follows the terminal: truecolor, plain ANSI, or none with NO_COLOR", () => {
  assert.equal(colorSupport({ COLORTERM: "truecolor" }), "truecolor");
  assert.equal(colorSupport({ COLORTERM: "24bit" }), "truecolor");
  assert.equal(colorSupport({ TERM: "xterm-256color" }), "ansi");
  assert.equal(colorSupport({ COLORTERM: "truecolor", NO_COLOR: "1" }), "none");
});

test("in a terminal the whole banner is printed", () => {
  printBanner("1.2.0", { stream: { isTTY: true }, env: { COLORTERM: "truecolor" } });
  const text = output.join("\n");
  assert.ok(text.includes(HEAD[3]!));
  assert.match(plain(text), /iOS Simulator CLI Helper v1\.2\.0/);
  assert.match(plain(text), /W S W E B C R E A T I O N/);
});

test("without a terminal (CI, a pipe) it is one plain line without art or colour", () => {
  printBanner("1.2.0", { stream: { isTTY: false }, env: {} });
  assert.deepEqual(output, ["iOS Simulator CLI Helper v1.2.0"]);
  assert.equal(title(""), "iOS Simulator CLI Helper");
});

// ─── what the tool can do ───────────────────────────────────────────────────

test("under the banner it says what the tool does, the commands to try, and where to find all options", () => {
  const text = aboutLines("none").join("\n");
  assert.match(text, /^Start an iOS simulator from your terminal\.\nNo iOS runtime or simulator yet\? We set it up for you\.\n\n/);
  assert.match(text, /  start-ios-simulator \[simulator\]\s+Pick a simulator, or start one by name/);
  assert.match(text, /  start-ios-simulator --check\s+See what is set up and what is missing/);
  assert.match(text, /  start-ios-simulator --setup\s+Install what is missing/);
  assert.match(text, /  start-ios-simulator --help\s+All options\n$/);
});

test("it is short: the intro, three commands and the pointer", () => {
  assert.ok(aboutLines("none").filter((line) => line.trim()).length <= 7);
  assert.ok(aboutLines("none").every((line) => line.length <= 80));
});

test("the descriptions line up in one column", () => {
  const columns = aboutLines("none").filter((line) => line.startsWith("  start-ios-simulator")).map((line) => line.search(/\s{2}[A-Z]/) + 2);
  assert.equal(new Set(columns).size, 1);
  assert.equal(columns.length, COMMANDS.length + 1);
});

test("the commands are green and the descriptions dim", () => {
  const line = aboutLines("ansi").find((l) => l.includes("--check"))!;
  assert.match(line, /^  \x1b\[32mstart-ios-simulator --check\x1b\[0m +\x1b\[2mSee what is set up/);
  assert.doesNotMatch(aboutLines("none").join("\n"), /\x1b/);
});

test("--help starts with the same text, and then has the options, without the pointer to itself", () => {
  assert.ok(HELP.startsWith(aboutText()));
  assert.match(HELP, /Start options/);
  assert.doesNotMatch(HELP, new RegExp(MORE[0]));
  assert.ok(INTRO.every((line) => HELP.includes(line)));
});

test("what the tool can do is only shown in a terminal", () => {
  printAbout({ stream: { isTTY: false } });
  assert.deepEqual(output, []);
  printAbout({ stream: { isTTY: true }, env: { NO_COLOR: "1" } });
  assert.match(output.join("\n"), /Start an iOS simulator from your terminal/);
});

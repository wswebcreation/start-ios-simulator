import { COMMANDS, INTRO, MORE, commandLine } from "./about.ts";
import { say } from "./ui.ts";

// The Apple logo in braille dots: every character is a 2x4 grid of dots, so the shape stays right.
// It is drawn in the silver of the logo, or in the colour of the text when the terminal has no 24 bit colour.
export const HEAD = [
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣤⣶⣾⣿⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣿⣿⣿⣿⡟⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⣿⣿⣿⣿⡟⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣿⣿⣿⠟⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⣠⣤⣤⣶⣤⣤⣄⡀⠀⠉⠉⣀⣤⣤⣶⣶⣦⣤⣤⡀⠀⠀⠀",
  "⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣀⠀",
  "⠀⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠛⠁",
  "⢰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠀⠀⠀",
  "⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠀⠀⠀⠀",
  "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀⠀",
  "⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀",
  "⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣆⠀⠀⠀",
  "⠸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄⠀",
  "⠀⢹⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿",
  "⠀⠀⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠃",
  "⠀⠀⠀⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠁⠀",
  "⠀⠀⠀⠀⠙⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠈⠻⢿⣿⣿⣿⠿⠟⠋⠉⠙⠛⠿⢿⣿⣿⣿⠿⠋⠀⠀⠀⠀",
];

const LOGO_TEXT = "W S W E B C R E A T I O N";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const TRUECOLOR_SILVER = "\x1b[38;2;162;170;173m"; // #A2AAAD, the silver of the logo
const GREEN = "\x1b[32m";

export type ColorSupport = "truecolor" | "ansi" | "none";

export function colorSupport(env: NodeJS.ProcessEnv = process.env): ColorSupport {
  if (env.NO_COLOR) return "none";
  return /truecolor|24bit/i.test(env.COLORTERM ?? "") ? "truecolor" : "ansi";
}

/** The logo of wswebcreation: the name in a thick frame. */
export function logo(): string[] {
  const inner = `  ${LOGO_TEXT}  `;
  return [`┏${"━".repeat(inner.length)}┓`, `┃${inner}┃`, `┗${"━".repeat(inner.length)}┛`];
}

export const title = (version: string) => `iOS Simulator CLI Helper${version ? ` v${version}` : ""}`;

// The logo of wswebcreation is a bit wider than the Apple logo, so everything is centered on the widest of the two
const HEAD_WIDTH = HEAD[0]!.length;
const WIDTH = Math.max(HEAD_WIDTH, logo()[0]!.length);

/** The banner: the Apple logo, the name of the tool and the logo of wswebcreation, as lines of text. */
export function bannerLines(version: string, color: ColorSupport): string[] {
  const paint = (code: string, text: string) => (color === "none" ? text : `${code}${text}${RESET}`);
  const silver = color === "truecolor" ? TRUECOLOR_SILVER : BOLD;
  // Centered under the head. The spaces are added before the colour, so they are not painted.
  const centered = (text: string, code: string) => " ".repeat(Math.max(0, Math.floor((WIDTH - text.length) / 2))) + paint(code, text);
  return [
    "",
    ...HEAD.map((line) => " ".repeat(Math.floor((WIDTH - HEAD_WIDTH) / 2)) + paint(silver, line)),
    "",
    centered(title(version), BOLD),
    centered("by", DIM),
    ...logo().map((line) => centered(line, BOLD)),
    "",
  ];
}

/** Show the banner. Without a terminal (CI, a pipe) there is no art, just the name on one line. */
export function printBanner(version: string, { stream = process.stdout, env = process.env }: { stream?: { isTTY?: boolean }; env?: NodeJS.ProcessEnv } = {}): void {
  if (!stream.isTTY) {
    say(title(version));
    return;
  }
  say(bannerLines(version, colorSupport(env)).join("\n"));
}

/** What the tool can do, under the banner: the intro, the commands to try first and where to find the rest. */
export function aboutLines(color: ColorSupport): string[] {
  const paint = (code: string, text: string) => (color === "none" ? text : `${code}${text}${RESET}`);
  const line = (entry: [string, string]) => commandLine(entry, (part, text) => paint(part === "command" ? GREEN : DIM, text));
  return [...INTRO, "", ...COMMANDS.map(line), line(MORE), ""];
}

/** Show what the tool can do. Only in a terminal: in a log it is just noise. */
export function printAbout({ stream = process.stdout, env = process.env }: { stream?: { isTTY?: boolean }; env?: NodeJS.ProcessEnv } = {}): void {
  if (!stream.isTTY) return;
  say(aboutLines(colorSupport(env)).join("\n"));
}

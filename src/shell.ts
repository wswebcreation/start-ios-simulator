import { execSync, spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";

export const IS_MAC = platform() === "darwin";

export interface RunResult {
  output: string;
  exitCode: number;
}

export interface RunFileOptions {
  env?: NodeJS.ProcessEnv;
  /** Show the output in the terminal instead of capturing it */
  inherit?: boolean;
  timeout?: number;
}

/** Run a command line and return its output, or null when it fails. */
export function run(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    return execSync(cmd, { stdio: "pipe", encoding: "utf8", env }).trim();
  } catch {
    return null;
  }
}

/** Run an executable with arguments (no shell quoting issues for names with spaces). */
export function runFile(file: string, args: string[] = [], { env = process.env, inherit = false, timeout }: RunFileOptions = {}): RunResult {
  const result = spawnSync(file, args, { encoding: "utf8", env, timeout, stdio: inherit ? ["inherit", "inherit", "inherit"] : "pipe" });
  const output = ((result.stdout || "") + (result.stderr || "")).trim();
  return { output, exitCode: result.status ?? 1 };
}

/**
 * Like runFile, but the terminal stays alive while it runs: a spinner only turns when nothing blocks the event loop.
 * Rejects when the program cannot be started, resolves with the exit code (1 when it was stopped by the timeout).
 */
export function runFileAsync(file: string, args: string[] = [], { env = process.env, timeout }: RunFileOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = timeout ? setTimeout(() => child.kill(), timeout) : null;
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ output: output.trim(), exitCode: code ?? 1 });
    });
  });
}

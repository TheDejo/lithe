import { spawn, ChildProcess } from "child_process";
import { watch as fsWatch } from "fs";
import { relative, resolve, sep } from "path";
import { c } from "./reporter";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "out", "__recordings__"]);
const DEBOUNCE_MS = 120;

/**
 * Re-run the tests whenever a file under `cwd` changes.
 *
 * Each run happens in a fresh child process, so edited source and test files
 * are always loaded anew (no stale module cache).
 */
export function watch(opts: { cwd: string; cliPath: string; args: string[]; ignore: string[] }): Promise<number> {
  const ignoredFiles = new Set(opts.ignore.map((f) => resolve(opts.cwd, f)));
  let child: ChildProcess | undefined;
  let timer: NodeJS.Timeout | undefined;
  let changed: string | undefined;

  const isIgnored = (file: string) => {
    if (ignoredFiles.has(resolve(opts.cwd, file))) return true;
    return file.split(/[\\/]/).some((part) => IGNORED_DIRS.has(part) || (part.startsWith(".") && part.length > 1));
  };

  const run = () => {
    if (child && child.exitCode === null) child.kill();
    if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    if (changed) console.log(c.gray(`Changed: ${changed}\n`));
    child = spawn(process.execPath, [opts.cliPath, ...opts.args], {
      cwd: opts.cwd,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...(process.stdout.isTTY && !process.env.NO_COLOR ? { FORCE_COLOR: "1" } : {}) },
    });
    const current = child;
    current.on("exit", (code, signal) => {
      if (current !== child || signal) return;
      const status = code === 0 ? c.green("Passed.") : c.red("Failed.");
      const keys = process.stdin.isTTY ? " Press Enter to run again, or q to quit." : "";
      console.log(`\n${status} ${c.gray(`Watching for changes…${keys}`)}`);
    });
  };

  const schedule = (file: string) => {
    changed = file;
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  };

  const watcher = fsWatch(opts.cwd, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const file = filename.toString();
    if (isIgnored(file)) return;
    schedule(relative(opts.cwd, resolve(opts.cwd, file)).split(sep).join("/"));
  });

  return new Promise((done) => {
    const stop = () => {
      watcher.close();
      clearTimeout(timer);
      if (child && child.exitCode === null) child.kill();
      done(0);
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", (buf) => {
        const key = buf.toString();
        if (key === "q" || key === "\u0003") stop();
        else if (key === "\r" || key === "\n") {
          changed = undefined;
          run();
        }
      });
    }
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    run();
  });
}

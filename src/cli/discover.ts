import { existsSync, readdirSync, statSync } from "fs";
import { join, relative, resolve, sep } from "path";

export const TEST_FILE = /\.(test|spec)\.(c|m)?[jt]sx?$/;
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "coverage", "out"]);

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name)) walk(full, out);
    } else if (e.isFile() && TEST_FILE.test(e.name)) {
      out.push(full);
    }
  }
}

/**
 * Resolve CLI arguments to test files.
 *  - an existing file  -> that file (any name)
 *  - an existing dir   -> all test files under it
 *  - anything else     -> filter on paths (substring or regex), Jest-style
 */
export function discover(cwd: string, args: string[]): string[] {
  const roots: string[] = [];
  const explicit: string[] = [];
  const filters: RegExp[] = [];

  for (const arg of args) {
    const p = resolve(cwd, arg);
    if (existsSync(p)) {
      (statSync(p).isDirectory() ? roots : explicit).push(p);
    } else {
      let re: RegExp;
      try {
        re = new RegExp(arg);
      } catch {
        re = new RegExp(arg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      }
      filters.push(re);
    }
  }

  let found: string[] = [];
  if (roots.length || !explicit.length) {
    for (const r of roots.length ? roots : [cwd]) walk(r, found);
  }
  if (filters.length) {
    found = found.filter((f) => {
      const rel = relative(cwd, f).split(sep).join("/");
      return filters.some((re) => re.test(rel));
    });
  }

  return [...new Set([...explicit, ...found])].sort();
}

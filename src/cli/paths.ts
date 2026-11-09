import { relative, sep } from "path";

/** A path relative to `cwd`, always with forward slashes, so output looks the same on every OS. */
export function displayPath(cwd: string, file: string): string {
  return relative(cwd, file).split(sep).join("/");
}

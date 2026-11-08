import { recordCall } from "./trace";

/**
 * A judge is any function that sends a prompt to a language model and returns
 * its text reply. Lithe builds the grading prompt and reads the verdict.
 */
export type Judge = (prompt: string) => Promise<string> | string;

/** Turns texts into embedding vectors, one per input, in the same order. */
export type Embedder = (texts: string[]) => Promise<number[][]> | number[][];

export interface LitheConfig {
  /** Used by toMean() and toMeetCriteria(). */
  judge?: Judge;
  /** Used by toBeSimilarTo(). */
  embed?: Embedder;
}

const CONFIG_KEY = Symbol.for("lithe.config");
const PENDING_KEY = Symbol.for("lithe.pendingAssertions");

function store(): LitheConfig {
  const g = globalThis as any;
  return (g[CONFIG_KEY] ??= {});
}

/**
 * Configure Lithe. Call it once, for example in a file passed to `--setup`.
 *
 *   configure({ judge: (prompt) => askMyModel(prompt) });
 */
export function configure(config: LitheConfig): void {
  Object.assign(store(), config);
}

export function getConfig(): Readonly<LitheConfig> {
  return store();
}

// ---------------------------------------------------------------------------
// Async assertions started during a test, so the runner can catch any that
// were not awaited instead of letting them pass silently.
// ---------------------------------------------------------------------------

export interface PendingAssertion {
  promise: Promise<unknown>;
  /** True once the test awaited the assertion or attached a handler to it. */
  observed: boolean;
}

function pendingList(): PendingAssertion[] {
  const g = globalThis as any;
  return (g[PENDING_KEY] ??= []);
}

/**
 * Register an async assertion and return a promise-like wrapper that notices
 * when the test awaits it (or calls .then/.catch/.finally on it).
 */
export function trackAssertion<T>(p: Promise<T>): Promise<T> {
  // A handler is attached so an un-awaited failure is not reported as an
  // unhandled rejection; the runner reports it against the test instead.
  p.catch(() => {});
  const entry: PendingAssertion = { promise: p, observed: false };
  pendingList().push(entry);
  const seen = () => { entry.observed = true; };
  return {
    then: (onFulfilled?: any, onRejected?: any) => { seen(); return p.then(onFulfilled, onRejected); },
    catch: (onRejected?: any) => { seen(); return p.catch(onRejected); },
    finally: (onFinally?: any) => { seen(); return p.finally(onFinally); },
    [Symbol.toStringTag]: "Promise",
  } as Promise<T>;
}

export function takePendingAssertions(): PendingAssertion[] {
  return pendingList().splice(0);
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export interface Verdict {
  pass: boolean;
  reason: string;
}

const asText = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);

export function judgePrompt(output: string, criteria: string[]): string {
  const list = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return [
    "You are grading the output of an AI system as part of an automated test.",
    "",
    "<output>",
    output,
    "</output>",
    "",
    "<criteria>",
    list,
    "</criteria>",
    "",
    "Decide whether the output meets every criterion. Judge what it says, not how it is worded.",
    'Reply with only a JSON object, and nothing else: {"pass": true or false, "reason": "<one short sentence>"}',
  ].join("\n");
}

export function meaningCriterion(reference: string): string {
  return (
    "The output means the same thing as this reference answer. Wording, length and formatting may differ, " +
    "but the facts and intent must match, and it must not add claims that contradict the reference.\n" +
    `Reference answer: ${reference}`
  );
}

/** Pull the verdict out of a model reply, tolerating code fences and extra prose. */
export function parseVerdict(reply: string): Verdict {
  const text = String(reply ?? "");
  const candidates = [text.trim(), ...(text.match(/\{[\s\S]*?\}/g) ?? [])];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      if (v && typeof v.pass === "boolean") {
        return { pass: v.pass, reason: typeof v.reason === "string" ? v.reason : "" };
      }
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`The judge's reply could not be read as a verdict. Expected JSON like {"pass": true, "reason": "..."}, got:\n${text.slice(0, 500)}`);
}

function requireJudge(matcher: string): Judge {
  const judge = getConfig().judge;
  if (!judge) {
    throw new Error(
      `${matcher} needs a judge. Call configure({ judge }) first, for example in a setup file run with --setup. ` +
        "See https://github.com/TheDejo/lithe#semantic-assertions"
    );
  }
  return judge;
}

export async function judge(output: unknown, criteria: string[], matcher: string): Promise<Verdict> {
  const fn = requireJudge(matcher);
  const prompt = judgePrompt(asText(output), criteria);
  const reply = await recordCall("judge", [prompt], () => fn(prompt));
  return parseVerdict(String(reply));
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error(`Embeddings must be non-empty and the same length (got ${a.length} and ${b.length})`);
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export async function similarity(received: unknown, expected: string): Promise<number> {
  const embed = getConfig().embed;
  if (!embed) {
    throw new Error(
      "toBeSimilarTo needs an embedding function. Call configure({ embed }) first, for example in a setup file run with --setup. " +
        "See https://github.com/TheDejo/lithe#semantic-assertions"
    );
  }
  const texts = [asText(received), expected];
  const vectors = (await recordCall("embed", [texts], () => embed(texts))) as number[][];
  if (!Array.isArray(vectors) || vectors.length !== 2) {
    throw new Error(`The embedding function must return one vector per input text (expected 2, got ${Array.isArray(vectors) ? vectors.length : typeof vectors})`);
  }
  return cosine(vectors[0], vectors[1]);
}

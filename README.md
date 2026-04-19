# Lithe

**Test your AI agents like real software.**

Lithe is an open-source test runner for AI agents, bringing structure, repeatability, and confidence to LLM-powered systems.

---

## ✨ Why Lithe

AI systems are powerful, but hard to trust.

* Outputs change between runs
* Prompts behave unpredictably
* Multi-step agents are difficult to validate
* Small changes cause silent regressions

**Lithe solves this by making AI behaviour testable, like code.**

---

## 🚀 Example

```ts
import { test } from "lithe";
import { expect } from "lithe";

async function agent(input: string) {
  return {
    jobs: ["Frontend Developer", "Backend Developer"]
  };
}

test("returns relevant jobs", async () => {
  const result = await agent("frontend jobs");

  expect(result.jobs).toContain("Frontend Developer");
});
```

Run:

```bash
lithe test
```

Output:

```
✓ returns relevant jobs
```

---

## 🧠 What Lithe is

* 🧪 A test runner for AI agents
* 🔁 Built for multi-step workflows
* ⚙️ Code-first (like Jest)
* ⚡ Designed for CI pipelines

---

## 🧩 What makes it different

**Prompt tools evaluate outputs.
Lithe tests behaviour.**

| Capability            | Lithe | Typical Tools |
| --------------------- | ----- | ------------- |
| Code-first tests      | ✅     | ❌             |
| Multi-turn workflows  | ✅     | ⚠️ Limited    |
| Agent-level testing   | ✅     | ❌             |
| Deterministic testing | ✅     | ❌             |

---

## 📦 Installation

```bash
npm install lithe
```

or

```bash
npx lithe test
```

---

## ⚙️ Usage

Create a test file:

```
example.test.ts
```

Write your test:

```ts
test("agent behaves correctly", async () => {
  const result = await agent.run("input");

  expect(result).toBeDefined();
});
```

Run all tests:

```bash
lithe test
```

---

## 🏗️ Roadmap

* [ ] Test file auto-discovery
* [ ] Async timeout handling
* [ ] AI-specific assertions (semantic matching)
* [ ] Mocking & simulation layer
* [ ] CI integrations

---

## 🌍 Open Source

Lithe is open-source and built for developers working with AI systems.

Contributions, ideas, and feedback are welcome.

---

## 📄 License

MIT License © 2026 Dejo

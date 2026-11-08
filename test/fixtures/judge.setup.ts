import { configure } from "../../src";

// Passes when the output contains the last word of the reference/criterion.
configure({
  judge: (prompt) => {
    const output = prompt.split("<output>\n")[1].split("\n</output>")[0].toLowerCase();
    const crit = prompt.split("<criteria>\n")[1].split("\n</criteria>")[0];
    const word = crit.trim().split(/\s+/).at(-1)!.toLowerCase().replace(/[^a-z]/g, "");
    const pass = output.includes(word);
    return JSON.stringify({ pass, reason: pass ? `mentions ${word}` : `never mentions ${word}` });
  },
});

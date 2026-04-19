import { Command } from "commander";
import { run } from "../core/runner";

const program = new Command();

program
  .command("test")
  .description("Run Lithe tests")
  .action(async () => {
    await import("../../examples/basic.test"); // temp loading
    await run();
  });

program.parse();
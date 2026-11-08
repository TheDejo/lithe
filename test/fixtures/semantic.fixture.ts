import { test, expect } from "../../src";

test("awaited semantic assertion passes", async () => {
  await expect("It ships Friday").toMean("ships on friday");
});

test("un-awaited failing assertion still fails the test", () => {
  expect("It ships Monday").toMean("ships on friday");
});

test("judge calls appear in the trace", async () => {
  await expect("It ships Monday").toMeetCriteria("mentions friday");
});

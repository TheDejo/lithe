"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("../src/core/test");
const expect_1 = require("../src/core/expect");
async function fakeAgent(input) {
    return {
        jobs: ["Frontend Developer", "Backend Developer"]
    };
}
(0, test_1.test)("returns frontend jobs", async () => {
    const result = await fakeAgent("frontend jobs");
    (0, expect_1.expect)(result.jobs).toContain("Frontend Developer");
});

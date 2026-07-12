import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";

// We modify src/http-client.ts to export buildMultipart first
import { buildMultipart } from "../src/http-client.js";
import type { MealieTool } from "../src/tools.js";

test("buildMultipart validates against path traversal", async () => {
    // Setup a dummy file
    const safePath = "test-safe-file.txt";
    writeFileSync(safePath, "hello");

    try {
        const tool: MealieTool = {
            name: "test_tool",
            path: "/api/test",
            method: "post",
            pathParams: [],
            queryParams: [],
            body: {
                kind: "multipart",
                fileFields: ["file"]
            }
        };

        // This should pass
        const formSafe = await buildMultipart(tool, { file: safePath });
        assert(formSafe instanceof FormData);
        assert.equal(formSafe.get("file")?.name, "test-safe-file.txt");

        // This should fail
        await assert.rejects(
            async () => await buildMultipart(tool, { file: "../package.json" }),
            { message: /Security Error/ }
        );

        // This should also fail
        await assert.rejects(
            async () => await buildMultipart(tool, { file: "/etc/passwd" }),
            { message: /Security Error/ }
        );
    } finally {
        if (existsSync(safePath)) {
            rmSync(safePath);
        }
    }
});

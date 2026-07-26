import type { Config } from "../src/config.js";

/**
 * A complete `Config` for tests, with overrides applied on top.
 *
 * This lives in one place on purpose. The same literal used to be copy-pasted
 * into several suites, each one missing whichever fields had been added to
 * `Config` since it was written; because the build config only type-checks
 * `src/`, that drift stayed invisible until a suite happened to touch a missing
 * field at runtime. Add a required field to `Config` and this fixture is the
 * single place that needs updating — `npm run typecheck` covers the tests too.
 *
 * Not named `*.test.ts`, so the test runner's glob does not pick it up.
 */
export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: "https://mealie.example.com",
    useBundledSpec: false,
    readOnly: false,
    include: [],
    exclude: [],
    timeoutMs: 60_000,
    toolNameMax: 50,
    debug: false,
    retries: 0,
    allowedUploadDirs: [],
    ...overrides,
  };
}

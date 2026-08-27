import { defineConfig } from "vitest/config";

/*
  Unit tests, separate from the Playwright suite in the same folder.

  `npm test` used to print "No automated tests configured yet" and exit 0 -
  a green result that proved nothing, which is worse than a red one because CI
  treats it as a pass. It now runs these.

  What is covered is the arithmetic: the speed conversion and its overhead
  factor, the loaded-latency and probe-loss figures, the KPI thresholds and
  boundaries, record normalisation and its absent-is-not-zero rule, and the
  bridge parsers. Those are the places where a mistake produces a plausible
  wrong number instead of an error, which is exactly what a test catches and a
  human reviewing a screenshot does not.

  End-to-end coverage stays in Playwright (`npm run test:e2e`): it needs Docker
  and real backends, and mixing the two would mean neither could be run
  quickly.
*/
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
    /* Playwright owns tests/e2e and uses its own runner. */
    exclude: ["tests/e2e/**", "node_modules/**", "backend-go/**"]
  }
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  runBrowsingTest,
  calculateBrowsingScore,
  DEFAULT_BROWSING_TARGETS
} from "../../ui/src/measurement/browsing.js";

describe("Browsing Service", () => {
  it("has comprehensive default targets", () => {
    expect(DEFAULT_BROWSING_TARGETS.length).toBeGreaterThanOrEqual(3);
    const names = DEFAULT_BROWSING_TARGETS.map((t) => t.name);
    expect(names).toContain("Unitel Portal");
  });

  describe("runBrowsingTest execution", () => {
    const originalFetch = global.fetch;
    const originalPerformance = global.performance;

    beforeEach(() => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          type: "cors"
        })
      );
    });

    afterEach(() => {
      global.fetch = originalFetch;
      global.performance = originalPerformance;
    });

    it("measures multi-target loading times and computes overall stats", async () => {
      const targets = [
        { id: "site_1", name: "Site 1", url: "https://site1.la" },
        { id: "site_2", name: "Site 2", url: "https://site2.la" }
      ];

      const progressCalls = [];
      const result = await runBrowsingTest({
        sites: targets,
        timeoutMs: 3000,
        onProgress: (info) => progressCalls.push(info)
      });

      expect(result.status).toBe("OK");
      expect(result.totalSites).toBe(2);
      expect(result.successfulSites).toBe(2);
      expect(result.successRate).toBe(100);
      expect(result.sites.length).toBe(2);
      expect(result.score).toBeGreaterThan(0);
      expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("handles opaque or CORS-restricted responses gracefully without throwing", async () => {
      // Simulate opaque response when cross-origin mode is no-cors
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 0,
          type: "opaque"
        })
      );

      const targets = [{ id: "site_opaque", name: "Opaque Site", url: "https://opaque.com" }];
      const result = await runBrowsingTest({
        sites: targets,
        timeoutMs: 2000
      });

      expect(result.status).toBe("OK");
      expect(result.totalSites).toBe(1);
      expect(result.sites[0].success).toBe(true); // Opaque response counts as reachable
    });

    it("respects AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort();

      const targets = [{ id: "site_1", name: "Site 1", url: "https://site1.la" }];
      const result = await runBrowsingTest({
        sites: targets,
        signal: controller.signal
      });

      expect(result.status).toBe("Aborted");
    });
  });
});

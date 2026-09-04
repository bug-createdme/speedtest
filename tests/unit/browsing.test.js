import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  runBrowsingTest,
  calculateBrowsingScore,
  loadTimeRating,
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
        /* The on-screen hold is presentational; nothing here measures it. */
        dwellMs: 0,
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

    it("announces every URL it will visit before the first one loads", async () => {
      const targets = [
        { id: "site_1", name: "Site 1", url: "https://site1.la" },
        { id: "site_2", name: "Site 2", url: "https://site2.la" }
      ];

      const first = await new Promise((resolve) => {
        let captured = false;
        runBrowsingTest({
          sites: targets,
          dwellMs: 0,
          onProgress: (info) => {
            if (!captured) {
              captured = true;
              resolve(info);
            }
          }
        });
      });

      expect(first.plannedSites.map((s) => s.url)).toEqual([
        "https://site1.la",
        "https://site2.la"
      ]);
      expect(first.totalSites).toBe(2);
      expect(first.sites).toEqual([]);
    });

    it("holds each finished page on screen for the dwell, without counting it", async () => {
      const targets = [{ id: "site_1", name: "Site 1", url: "https://site1.la" }];
      const dwellMs = 300;

      const startedAt = Date.now();
      const result = await runBrowsingTest({ sites: targets, dwellMs });
      const elapsed = Date.now() - startedAt;

      expect(elapsed).toBeGreaterThanOrEqual(dwellMs);
      // The wait is display time, so it must stay out of the reported timing.
      expect(result.sites[0].loadTimeMs).toBeLessThan(dwellMs);
      expect(result.averageLoadTime).toBeLessThan(dwellMs);
    });

    it("cuts the dwell short when the run is cancelled", async () => {
      const controller = new AbortController();
      const targets = [
        { id: "site_1", name: "Site 1", url: "https://site1.la" },
        { id: "site_2", name: "Site 2", url: "https://site2.la" }
      ];

      const startedAt = Date.now();
      const run = runBrowsingTest({ sites: targets, dwellMs: 5000, signal: controller.signal });
      setTimeout(() => controller.abort(), 100);
      const result = await run;

      expect(Date.now() - startedAt).toBeLessThan(4000);
      expect(result.sites.length).toBe(1);
    });

    it("probes a site marked render:false and says that is what it did", async () => {
      const targets = [
        { id: "framed", name: "Framed", url: "https://site1.la" },
        { id: "no_frame", name: "No frame", url: "https://site2.la", render: false }
      ];

      const seen = [];
      const result = await runBrowsingTest({
        sites: targets,
        dwellMs: 0,
        onProgress: (info) => {
          if (info.phase === "loading" && info.currentSite) {
            seen.push([info.currentSite, info.currentRenders]);
          }
        }
      });

      expect(result.sites.map((s) => s.source)).toEqual(["probe", "probe"]);
      // Headless, so neither is framed - but only the second says so up front,
      // which is what the screen needs to explain the empty panel.
      expect(seen.find((s) => s[0] === "No frame")[1]).toBe(false);
      expect(seen.find((s) => s[0] === "Framed")[1]).toBe(true);
    });

    it("rates each site as well as the run", async () => {
      const targets = [{ id: "site_1", name: "Site 1", url: "https://site1.la" }];
      const result = await runBrowsingTest({ sites: targets, dwellMs: 0 });

      // A mocked fetch resolves instantly, so this is the top of the scale.
      expect(result.sites[0].rating).toBe(100);
      expect(result.sites[0].rendered).toBe(false);
      expect(result.sites[0].source).toBe("probe");
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
        timeoutMs: 2000,
        dwellMs: 0
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

  describe("loadTimeRating", () => {
    it("tops out under the excellent threshold and falls away above it", () => {
      expect(loadTimeRating(400)).toBe(100);
      expect(loadTimeRating(1200)).toBe(100);
      expect(loadTimeRating(2200)).toBe(75);
      expect(loadTimeRating(3800)).toBe(50);
      expect(loadTimeRating(6000)).toBe(25);
    });

    it("never rates a page that took forever above the floor", () => {
      expect(loadTimeRating(60000)).toBe(10);
    });

    it("is monotonic - slower is never rated higher", () => {
      let previous = 101;
      for (let ms = 200; ms <= 20000; ms += 200) {
        const rating = loadTimeRating(ms);
        expect(rating).toBeLessThanOrEqual(previous);
        previous = rating;
      }
    });
  });
});

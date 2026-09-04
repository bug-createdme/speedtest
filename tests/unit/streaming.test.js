import { describe, expect, it } from "vitest";

import {
  calculateStreamingScore,
  DEFAULT_QUALITIES,
  formatBytes,
  performanceRate,
  runStreamingTest
} from "../../ui/src/measurement/streaming.js";

describe("Streaming Service", () => {
  it("defines three tiers, ascending, each labelled with its own height", () => {
    expect(DEFAULT_QUALITIES.length).toBe(3);

    /*
      A tier's label is what the result screen reports as the quality reached,
      so it has to be the height the file actually decodes to - not a rung on
      an idealised ladder. Two of these used to be named 360p and 720p while
      being 640x480 and 960x540 files, which is how runs came to report a
      highest stable quality no tier had ever produced.
    */
    for (const tier of DEFAULT_QUALITIES) {
      expect(tier.quality).toBe(`${tier.height}p`);
      expect(tier.url).toMatch(/^https:\/\/.+\.mp4$/);
    }

    const heights = DEFAULT_QUALITIES.map((q) => q.height);
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
  });

  describe("calculateStreamingScore", () => {
    it("returns high score for fast startup and zero rebuffering", () => {
      const res = calculateStreamingScore({
        startupTimeMs: 400,
        bufferingCount: 0,
        bufferingDurationMs: 0,
        rebufferingRatio: 0,
        highestStableQuality: 1080,
        playbackSuccess: true
      });
      expect(res.score).toBeGreaterThanOrEqual(90);
      expect(res.grade).toBe("excellent");
    });

    it("moderates score for 720p with slight stall", () => {
      const res = calculateStreamingScore({
        startupTimeMs: 1200,
        bufferingCount: 1,
        bufferingDurationMs: 500,
        rebufferingRatio: 3,
        highestStableQuality: 720,
        playbackSuccess: true
      });
      expect(res.score).toBeGreaterThan(65);
      expect(res.score).toBeLessThan(85);
    });

    it("severely penalizes frequent stalls and high rebuffering ratio", () => {
      const res = calculateStreamingScore({
        startupTimeMs: 3500,
        bufferingCount: 5,
        bufferingDurationMs: 6000,
        rebufferingRatio: 25,
        highestStableQuality: 360,
        playbackSuccess: false
      });
      expect(res.score).toBeLessThan(40);
      expect(res.grade).toMatch(/poor|veryPoor/);
    });
  });

  /*
    The two numbers the per-tier table on the testing screen is built from.
    Both are shown to the tester as measurements, so both are pinned here.
  */
  describe("performanceRate", () => {
    it("matches nPerf: 5.56s played after 0.49s of loading rates 91.9%", () => {
      expect(performanceRate(5560, 490, 0)).toBeCloseTo(91.9, 1);
    });

    it("is 100% only when nothing was spent waiting", () => {
      expect(performanceRate(4000, 0, 0)).toBe(100);
    });

    it("counts a stall against the tier the same way startup does", () => {
      expect(performanceRate(4000, 500, 500)).toBe(performanceRate(4000, 1000, 0));
      expect(performanceRate(4000, 0, 1000)).toBe(80);
    });

    it("returns null rather than 0 when no video played", () => {
      expect(performanceRate(0, 800, 0)).toBeNull();
      expect(performanceRate(null, null, null)).toBeNull();
    });
  });

  describe("formatBytes", () => {
    it("reads as kiB below a megabyte and MiB above it", () => {
      expect(formatBytes(978944)).toBe("956 kiB");
      expect(formatBytes(1531805)).toBe("1.46 MiB");
      expect(formatBytes(512)).toBe("512 B");
    });

    it("returns null for a count that was never measured", () => {
      expect(formatBytes(null)).toBeNull();
      expect(formatBytes(0)).toBeNull();
      expect(formatBytes(undefined)).toBeNull();
    });
  });

  describe("runStreamingTest abort handling", () => {
    it("immediately handles aborted signal cleanly without hanging", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await runStreamingTest({
        qualities: DEFAULT_QUALITIES,
        signal: controller.signal
      });

      expect(result.status).toBe("Aborted");
    });
  });
});

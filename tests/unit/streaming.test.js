import { describe, expect, it } from "vitest";

import {
  calculateStreamingScore,
  DEFAULT_QUALITIES,
  runStreamingTest
} from "../../ui/src/measurement/streaming.js";

describe("Streaming Service", () => {
  it("defines standard quality tiers: 360p, 720p, 1080p", () => {
    expect(DEFAULT_QUALITIES.length).toBe(3);
    const names = DEFAULT_QUALITIES.map((q) => q.quality);
    expect(names).toContain("360p");
    expect(names).toContain("720p");
    expect(names).toContain("1080p");
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

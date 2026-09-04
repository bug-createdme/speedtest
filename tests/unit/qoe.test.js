import { describe, expect, it } from "vitest";

import {
  calculateDownloadScore,
  calculateUploadScore,
  calculateLatencyScore,
  calculateOverallNetworkScore,
  getQoEGrade,
  DEFAULT_QOE_WEIGHTS
} from "../../ui/src/measurement/qoe.js";
import { calculateBrowsingScore } from "../../ui/src/measurement/browsing.js";
import { calculateStreamingScore } from "../../ui/src/measurement/streaming.js";

describe("calculateDownloadScore", () => {
  it("returns 0 for null, undefined, or 0 Mbps", () => {
    expect(calculateDownloadScore(0)).toBe(0);
    expect(calculateDownloadScore(null)).toBe(0);
    expect(calculateDownloadScore(-5)).toBe(0);
  });

  it("scales accurately across speed thresholds", () => {
    expect(calculateDownloadScore(2)).toBe(30);
    expect(calculateDownloadScore(5)).toBe(50);
    expect(calculateDownloadScore(10)).toBe(65);
    expect(calculateDownloadScore(25)).toBe(80);
    expect(calculateDownloadScore(50)).toBe(90);
    expect(calculateDownloadScore(100)).toBe(100);
    expect(calculateDownloadScore(200)).toBe(100);
  });
});

describe("calculateUploadScore", () => {
  it("returns 0 for non-positive values", () => {
    expect(calculateUploadScore(0)).toBe(0);
    expect(calculateUploadScore(null)).toBe(0);
  });

  it("scales appropriately for typical upload tiers", () => {
    expect(calculateUploadScore(1)).toBe(20);
    expect(calculateUploadScore(2)).toBe(40);
    expect(calculateUploadScore(5)).toBe(60);
    expect(calculateUploadScore(10)).toBe(75);
    expect(calculateUploadScore(25)).toBe(90);
    expect(calculateUploadScore(50)).toBe(100);
  });
});

describe("calculateLatencyScore", () => {
  it("rewards low ping and minimal bufferbloat", () => {
    const score = calculateLatencyScore({
      ping: 15,
      jitter: 2,
      dlPing: 20,
      ulPing: 22,
      probeLoss: 0
    });
    expect(score).toBeGreaterThan(85);
  });

  it("penalizes high loaded latency and packet/probe loss", () => {
    const score = calculateLatencyScore({
      ping: 120,
      jitter: 35,
      dlPing: 350,
      ulPing: 420,
      probeLoss: 8
    });
    expect(score).toBeLessThan(40);
  });
});

describe("calculateBrowsingScore", () => {
  it("scores fast site loading and 100% success rate high", () => {
    const res = calculateBrowsingScore({
      averageLoadTime: 650, // 0.65s
      successRate: 100
    });
    expect(res.score).toBeGreaterThanOrEqual(90);
    expect(res.grade).toBe("excellent");
  });

  it("penalizes slow loading and failed pages", () => {
    const res = calculateBrowsingScore({
      averageLoadTime: 4500, // 4.5s
      successRate: 60
    });
    expect(res.score).toBeLessThan(45);
    expect(res.grade).toMatch(/poor|veryPoor/);
  });
});

describe("calculateStreamingScore", () => {
  it("scores instant 1080p playback with zero stalls near 100", () => {
    const res = calculateStreamingScore({
      startupTimeMs: 450,
      bufferingCount: 0,
      bufferingDurationMs: 0,
      rebufferingRatio: 0,
      highestStableQuality: 1080,
      playbackSuccess: true
    });
    expect(res.score).toBeGreaterThanOrEqual(90);
    expect(res.grade).toBe("excellent");
  });

  it("penalizes buffering stalls and low quality", () => {
    const res = calculateStreamingScore({
      startupTimeMs: 3200,
      bufferingCount: 4,
      bufferingDurationMs: 4000,
      rebufferingRatio: 18,
      highestStableQuality: 360,
      playbackSuccess: false
    });
    expect(res.score).toBeLessThan(45);
    expect(res.grade).toMatch(/poor|veryPoor/);
  });
});

describe("calculateOverallNetworkScore & getQoEGrade", () => {
  it("computes weighted overall score and correct grade", () => {
    const qoe = calculateOverallNetworkScore({
      download: 85,
      upload: 30,
      ping: 18,
      jitter: 2,
      dlPing: 24,
      ulPing: 26,
      probeLoss: 0,
      browsingScore: 90,
      streamingScore: 92
    });

    expect(qoe.overallScore).toBeGreaterThanOrEqual(88);
    expect(qoe.overallGrade).toMatch(/excellent|good/);
    expect(getQoEGrade(qoe.overallScore)).toBe(qoe.overallGrade);
  });

  it("handles missing browsing or streaming without crashing (dynamically renormalizes weights)", () => {
    const qoeWithoutExtra = calculateOverallNetworkScore({
      download: 50,
      upload: 15,
      ping: 25,
      jitter: 5,
      dlPing: 45,
      ulPing: 50,
      probeLoss: 0
    });

    expect(qoeWithoutExtra.overallScore).toBeGreaterThan(60);
    expect(qoeWithoutExtra.browsingScore).toBeNull();
    expect(qoeWithoutExtra.streamingScore).toBeNull();
  });

  it("accurately classifies edge grades", () => {
    expect(getQoEGrade(95)).toBe("excellent");
    expect(getQoEGrade(80)).toBe("good");
    expect(getQoEGrade(60)).toBe("average");
    expect(getQoEGrade(35)).toBe("poor");
    expect(getQoEGrade(15)).toBe("veryPoor");
    expect(getQoEGrade(null)).toBe("veryPoor");
  });
});

/**
 * qoe.js - Quality of Experience (QoE) Scoring Algorithm
 *
 * Evaluates real-world internet usability rather than raw bandwidth alone.
 * Evaluates 5 dimensions:
 *   1. Download Performance (25%)
 *   2. Upload Performance   (10%)
 *   3. Latency & Stability  (15%) - includes idle ping, jitter & loaded bufferbloat
 *   4. Web Browsing QoE     (20%) - page load times, TTFB, DNS, success rate
 *   5. Video Streaming QoE  (30%) - startup time, buffering/stalls, throughput, quality
 */

export const QOE_WEIGHTS = {
  download: 0.25,
  upload: 0.10,
  latency: 0.15,
  browsing: 0.20,
  streaming: 0.30
};

export const QOE_GRADES = {
  EXCELLENT: "excellent",
  GOOD: "good",
  AVERAGE: "average",
  POOR: "poor",
  VERY_POOR: "veryPoor"
};

/**
 * Returns user-friendly grade based on 0-100 score.
 *   90 - 100: Excellent
 *   75 - 89:  Good
 *   50 - 74:  Average
 *   25 - 49:  Poor
 *    0 - 24:  Very Poor
 */
export function getQoEGrade(score) {
  const s = Math.round(Number(score) || 0);
  if (s >= 90) return QOE_GRADES.EXCELLENT;
  if (s >= 75) return QOE_GRADES.GOOD;
  if (s >= 50) return QOE_GRADES.AVERAGE;
  if (s >= 25) return QOE_GRADES.POOR;
  return QOE_GRADES.VERY_POOR;
}

/**
 * Download Score (0 - 100)
 * Practical daily user experience scale:
 *   >= 100 Mbps: 100
 *   >= 50 Mbps:  90 - 99
 *   >= 25 Mbps:  80 - 89 (smooth 4K streaming / heavy download)
 *   >= 10 Mbps:  65 - 79 (smooth 1080p streaming / browsing)
 *   >= 5 Mbps:   50 - 64 (usable for HD video)
 *   >= 2 Mbps:   30 - 49 (minimum for basic web)
 *   < 2 Mbps:    0 - 29 (struggles with modern sites)
 */
export function calculateDownloadScore(mbps) {
  const speed = Number(mbps) || 0;
  if (speed <= 0) return 0;
  if (speed >= 100) return 100;
  if (speed >= 50) return Math.round(90 + ((speed - 50) / 50) * 10);
  if (speed >= 25) return Math.round(80 + ((speed - 25) / 25) * 10);
  if (speed >= 10) return Math.round(65 + ((speed - 10) / 15) * 15);
  if (speed >= 5) return Math.round(50 + ((speed - 5) / 5) * 15);
  if (speed >= 2) return Math.round(30 + ((speed - 2) / 3) * 20);
  return Math.round((speed / 2) * 30);
}

/**
 * Upload Score (0 - 100)
 * Scale:
 *   >= 50 Mbps: 100
 *   >= 25 Mbps: 90 - 99
 *   >= 10 Mbps: 75 - 89 (high-res video calls, cloud backup)
 *   >= 5 Mbps:  60 - 74 (standard 1080p video calls)
 *   >= 2 Mbps:  40 - 59 (voice calls, basic photo upload)
 *   < 2 Mbps:   0 - 39
 */
export function calculateUploadScore(mbps) {
  const speed = Number(mbps) || 0;
  if (speed <= 0) return 0;
  if (speed >= 50) return 100;
  if (speed >= 25) return Math.round(90 + ((speed - 25) / 25) * 10);
  if (speed >= 10) return Math.round(75 + ((speed - 10) / 15) * 15);
  if (speed >= 5) return Math.round(60 + ((speed - 5) / 5) * 15);
  if (speed >= 2) return Math.round(40 + ((speed - 2) / 3) * 20);
  return Math.round((speed / 2) * 40);
}

/**
 * Latency Score (0 - 100)
 * Evaluates:
 *   - Idle Ping (ms)
 *   - Jitter (ms)
 *   - Loaded Latency increase / bufferbloat (dlPing - idlePing)
 *   - Probe Loss (%)
 */
export function calculateLatencyScore(options) {
  const idlePing = Number(options?.ping) || 0;
  const jitter = Number(options?.jitter) || 0;
  const dlPing = Number(options?.dlPing) || 0;
  const ulPing = Number(options?.ulPing) || 0;
  const probeLoss = Number(options?.probeLoss) || 0;

  if (idlePing <= 0) return 0;

  // Base ping score
  let pingScore;
  if (idlePing <= 15) pingScore = 100;
  else if (idlePing <= 30) pingScore = 90 - ((idlePing - 15) / 15) * 10;
  else if (idlePing <= 60) pingScore = 75 - ((idlePing - 30) / 30) * 15;
  else if (idlePing <= 120) pingScore = 50 - ((idlePing - 60) / 60) * 25;
  else if (idlePing <= 250) pingScore = 25 - ((idlePing - 120) / 130) * 25;
  else pingScore = 10;

  // Jitter penalty (excessive jitter ruins real-time communication)
  let jitterPenalty = 0;
  if (jitter > 30) jitterPenalty = 25;
  else if (jitter > 15) jitterPenalty = 15;
  else if (jitter > 5) jitterPenalty = 5;

  // Bufferbloat penalty: how much ping degrades under load
  let bufferbloatPenalty = 0;
  const maxLoaded = Math.max(dlPing, ulPing);
  if (maxLoaded > idlePing && idlePing > 0) {
    const delta = maxLoaded - idlePing;
    if (delta > 200) bufferbloatPenalty = 25;
    else if (delta > 100) bufferbloatPenalty = 15;
    else if (delta > 40) bufferbloatPenalty = 8;
  }

  // Probe loss penalty (failed requests under load)
  let lossPenalty = 0;
  if (probeLoss > 10) lossPenalty = 40;
  else if (probeLoss > 5) lossPenalty = 25;
  else if (probeLoss > 1) lossPenalty = 10;

  const score = Math.max(0, Math.min(100, pingScore - jitterPenalty - bufferbloatPenalty - lossPenalty));
  return Math.round(score);
}

/**
 * Calculates overall QoE Score (0 - 100) and component breakdowns.
 */
export function calculateOverallNetworkScore(input) {
  const customWeights = input?.weights || {};
  const weights = {
    download: customWeights.download ?? QOE_WEIGHTS.download,
    upload: customWeights.upload ?? QOE_WEIGHTS.upload,
    latency: customWeights.latency ?? QOE_WEIGHTS.latency,
    browsing: customWeights.browsing ?? QOE_WEIGHTS.browsing,
    streaming: customWeights.streaming ?? QOE_WEIGHTS.streaming
  };

  const downloadScore = calculateDownloadScore(input?.download);
  const uploadScore = calculateUploadScore(input?.upload);
  const latencyScore = calculateLatencyScore({
    ping: input?.ping,
    jitter: input?.jitter,
    dlPing: input?.dlPing,
    ulPing: input?.ulPing,
    probeLoss: input?.probeLoss
  });

  // If browsing or streaming were skipped or not run, redistribute weights to available metrics
  const browsingAvailable = input?.browsingScore !== null && input?.browsingScore !== undefined;
  const streamingAvailable = input?.streamingScore !== null && input?.streamingScore !== undefined;

  const browsingScore = browsingAvailable ? Number(input.browsingScore) : null;
  const streamingScore = streamingAvailable ? Number(input.streamingScore) : null;

  let totalWeight = weights.download + weights.upload + weights.latency;
  let weightedSum = downloadScore * weights.download + uploadScore * weights.upload + latencyScore * weights.latency;

  if (browsingAvailable) {
    totalWeight += weights.browsing;
    weightedSum += browsingScore * weights.browsing;
  }

  if (streamingAvailable) {
    totalWeight += weights.streaming;
    weightedSum += streamingScore * weights.streaming;
  }

  const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  const overallGrade = getQoEGrade(overallScore);

  return {
    overallScore,
    overallGrade,
    downloadScore,
    uploadScore,
    latencyScore,
    browsingScore: browsingAvailable ? Math.round(browsingScore) : null,
    streamingScore: streamingAvailable ? Math.round(streamingScore) : null,
    weights
  };
}

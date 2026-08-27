import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/*
  The measurement formulas, tested in the engine itself.

  speedtest_worker.js is a classic Web Worker script: no exports, module-level
  state, and a deliberate commitment (docs/architecture.md) to shipping
  identical bytes on the web and inside the mini-app. Refactoring it into
  importable pieces to make it testable would break that commitment and put the
  risk in the one file where a mistake produces a wrong number rather than an
  error.

  So it is loaded as-is into a sandbox with the handful of worker globals it
  touches at load time, and a shim is appended that hands out references to the
  functions and the module-level state. The file on disk is untouched: what
  these tests exercise is exactly what ships.
*/
function loadEngine() {
  const source = fs.readFileSync(path.join(repoRoot, "speedtest_worker.js"), "utf8");
  const sandbox = {
    addEventListener() {},
    postMessage() {},
    console: { warn() {}, log() {} }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  /* Test-only accessors. `let` bindings are not properties of the sandbox
     global, so they have to be handed out explicitly from inside. */
  const shim = `
    globalThis.__engine = {
      toSpeedStatus,
      publishLoadedLatency,
      get settings() { return settings; },
      set loadedLatency(value) { loadedLatency = value; },
      read() {
        return {
          dlPingStatus, dlPingMaxStatus, dlJitterStatus,
          ulPingStatus, ulJitterStatus,
          probeLossStatus, probeCountStatus
        };
      }
    };
  `;
  vm.runInNewContext(source + shim, sandbox, { filename: "speedtest_worker.js" });
  return sandbox.__engine;
}

let engine;
beforeEach(() => {
  engine = loadEngine();
});

describe("throughput", () => {
  /*
    speed x 8 x overheadCompensationFactor / 1e6.

    The factor is 1.06 and is NOT calibrated for this network - it is
    LibreSpeed's default, measured for IPv4/TCP/Ethernet over the internet, not
    for 4G in Laos (docs/overhead-calibration.md). It matters because the KPI
    thresholds come from nPerf data: reporting 6% high across the board would
    inflate the share of samples that pass. This test does not say the factor
    is right, only that it is applied exactly once and where expected, so a
    calibration change moves the numbers and nothing else does.
  */
  it("converts bytes per second to Mbit/s with overhead compensation", () => {
    expect(engine.toSpeedStatus(1_000_000)).toBe("8.48"); // 1e6 * 8 * 1.06 / 1e6
    expect(engine.toSpeedStatus(2_500_000)).toBe("21.20");
  });

  it("applies the factor exactly once", () => {
    engine.settings.overheadCompensationFactor = 1;
    expect(engine.toSpeedStatus(1_000_000)).toBe("8.00");
  });

  it("switches to mebibits when asked", () => {
    engine.settings.overheadCompensationFactor = 1;
    engine.settings.useMebibits = true;
    expect(engine.toSpeedStatus(1_048_576)).toBe("8.00");
  });

  /*
    An empty string, not "0.00". A missing measurement and a measured zero must
    not look alike: record.js turns "" into null and 0 into null too, but the
    result screen renders them differently and a zero would read as "your
    connection is 0 Mbps" rather than "not measured".
  */
  it("reports nothing rather than zero when there is nothing to report", () => {
    expect(engine.toSpeedStatus(0)).toBe("");
    expect(engine.toSpeedStatus(-1)).toBe("");
    expect(engine.toSpeedStatus(Infinity)).toBe("");
    expect(engine.toSpeedStatus(NaN)).toBe("");
  });
});

describe("probe loss", () => {
  function publish(dl, ul) {
    engine.loadedLatency = {
      dl: Object.assign({ sent: 0, lost: 0, samples: [] }, dl),
      ul: Object.assign({ sent: 0, lost: 0, samples: [] }, ul)
    };
    engine.publishLoadedLatency();
    return engine.read();
  }

  it("reports nothing when no probe was sent", () => {
    const out = publish({}, {});
    expect(out.probeLossStatus).toBe("");
    expect(out.probeCountStatus).toBe(0);
  });

  it("reports a clean run as a measured zero", () => {
    const out = publish({ sent: 40, lost: 0, samples: [10, 12] }, {});
    expect(out.probeLossStatus).toBe("0.00");
    expect(out.probeCountStatus).toBe(40);
  });

  it("reports total loss", () => {
    const out = publish({ sent: 20, lost: 20 }, {});
    expect(out.probeLossStatus).toBe("100.00");
  });

  it("reports partial loss", () => {
    const out = publish({ sent: 10, lost: 3 }, {});
    expect(out.probeLossStatus).toBe("30.00");
  });

  /* The figure spans both transfer phases, because it answers "how did this
     link behave under load", not "how did the download behave". */
  it("pools the download and upload phases", () => {
    const out = publish({ sent: 10, lost: 1 }, { sent: 10, lost: 3 });
    expect(out.probeCountStatus).toBe(20);
    expect(out.probeLossStatus).toBe("20.00");
  });
});

describe("latency under load", () => {
  function publishDl(samples) {
    engine.loadedLatency = {
      dl: { sent: samples.length, lost: 0, samples },
      ul: { sent: 0, lost: 0, samples: [] }
    };
    engine.publishLoadedLatency();
    return engine.read();
  }

  /*
    Average, not minimum. Under load a single probe slipping through between
    buffer drains would report an unloaded-looking figure for a badly bloated
    link; the average is what a user experiences and the maximum is what makes
    a call drop.
  */
  it("reports the average and the worst", () => {
    const out = publishDl([100, 200, 300]);
    expect(out.dlPingStatus).toBe("200.00");
    expect(out.dlPingMaxStatus).toBe("300.00");
  });

  /*
    Jitter as the standard deviation of the probe round trips. This is what
    separates a link that is uniformly slow under load from one that is mostly
    fine and occasionally stalls - identical averages, completely different to
    use.
  */
  it("reports a steady link as zero spread", () => {
    expect(publishDl([50, 50, 50]).dlJitterStatus).toBe("0.00");
  });

  it("measures the spread", () => {
    // mean 15, deviations -5 and +5, population stddev 5
    expect(publishDl([10, 20]).dlJitterStatus).toBe("5.00");
  });

  it("separates two links with the same average", () => {
    const steady = publishDl([100, 100, 100, 100]);
    const spiky = publishDl([25, 25, 25, 325]);
    expect(steady.dlPingStatus).toBe(spiky.dlPingStatus);
    expect(Number(spiky.dlJitterStatus)).toBeGreaterThan(
      Number(steady.dlJitterStatus)
    );
  });

  /* One sample has no spread to speak of; reporting 0.00 there would read as
     "perfectly steady" rather than "not enough data". */
  it("reports nothing for a single sample", () => {
    expect(publishDl([42]).dlJitterStatus).toBe("");
  });

  it("leaves a phase that took no samples alone", () => {
    const out = publishDl([10, 20]);
    expect(out.ulPingStatus).toBe("");
    expect(out.ulJitterStatus).toBe("");
  });
});

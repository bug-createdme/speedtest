import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  How long a locate is allowed to take.

  These are regression tests for a defect that cost the field survey its
  position on every run for a day: each source had been given a hard 2-2.5s
  cap, and a cold native locate on iOS routinely needs 3-8s. Every attempt was
  abandoned a moment before the OS answered, and retrying could not help -
  each retry restarts the same slow call from zero. LOCATION_LAT/LNG came back
  empty on every stored record until the caps were replaced by shares of the
  caller's budget.

  Nothing here asserts a specific number of milliseconds; they assert that a
  slow-but-successful locate still produces a fix.
*/

let nativeLatencyMs = 0;
let calls = [];

vi.mock("../../ui/src/bridge/windvane.js", () => ({
  isSuperApp: () => true,
  /* A bridge that answers after nativeLatencyMs, and gives up at its own
     timeout exactly as bridge/windvane.js does. */
  call: (namespace, method, params, timeoutMs) => {
    calls.push({ namespace, method, timeoutMs });
    return new Promise((resolve) => {
      const answer = setTimeout(
        () => resolve({ data: JSON.stringify({ latitude: 17.9693, longitude: 102.6251 }) }),
        nativeLatencyMs
      );
      setTimeout(() => {
        clearTimeout(answer);
        resolve(null);
      }, timeoutMs || 5000);
    });
  }
}));
vi.mock("../../ui/src/context/geo.js", () => ({ locateArea: () => null }));

const { fetchLocationRaw, recentFix } = await import("../../ui/src/context/location.js");

function asDevice(geolocation) {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Unitel",
      platform: "iPhone",
      geolocation
    },
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
    writable: true
  });
}

beforeEach(() => {
  calls = [];
  asDevice(undefined);
  globalThis.fetch = () => Promise.reject(new Error("offline"));
});

describe("fetchLocationRaw budget", () => {
  /* 7500ms is past the old 2500ms cap by 3x and still well inside what a cold
     GPS takes; the run lasts a minute, so there is time to wait for it. */
  for (const latency of [500, 3200, 7500]) {
    it(`returns a fix when the bridge takes ${latency}ms`, async () => {
      nativeLatencyMs = latency;
      const fix = await fetchLocationRaw(20000);
      expect(fix).toEqual({ lat: 17.9693, lng: 102.6251 });
    }, 30000);
  }

  it("gives the primary source a share of the budget, not a fixed cap", async () => {
    nativeLatencyMs = 100;
    await fetchLocationRaw(20000);
    const primary = calls[0];
    expect(primary.method).toBe("getUserLocation");
    /* The exact fraction is free to change; being unable to outlast a cold
       fix is not. */
    expect(primary.timeoutMs).toBeGreaterThan(8000);
  }, 30000);
});

describe("HTML5 coarse fallback", () => {
  it("delivers the cell/wifi fix when high-accuracy never locks", async () => {
    nativeLatencyMs = 99999; // no bridge fix; fall through to the web API
    asDevice({
      getCurrentPosition(success, error, opts) {
        if (opts.enableHighAccuracy) {
          /* GPS indoors: silent until its own timeout expires. */
          setTimeout(() => error({ code: 3, message: "Timeout expired" }), opts.timeout);
        } else {
          setTimeout(
            () => success({ coords: { latitude: 17.9693, longitude: 102.6251, accuracy: 1200 } }),
            50
          );
        }
      }
    });
    const fix = await fetchLocationRaw(9000);
    /* Previously null: the high-accuracy attempt was handed the WHOLE budget,
       so it expired together with the backstop timer and this coarse fix -
       already in hand - was discarded unread. */
    expect(fix).not.toBe(null);
    expect(fix.accuracy).toBe(1200);
  }, 40000);
});

describe("recentFix", () => {
  it("offers a fresh fix as a seed and refuses a stale one", async () => {
    nativeLatencyMs = 50;
    const fix = await fetchLocationRaw(20000);
    expect(recentFix()).toEqual(fix);
    expect(recentFix(0)).toBe(null);
  }, 30000);
});

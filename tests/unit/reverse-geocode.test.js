import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../ui/src/bridge/windvane.js", () => ({
  isSuperApp: () => false,
  call: () => Promise.resolve(null)
}));
vi.mock("../../ui/src/context/geo.js", () => ({ locateArea: () => null }));

const { reverseGeocode, withArea } = await import("../../ui/src/context/location.js");

/* The point every stored record in this survey has been taken at: Naxay
   village, Xaysetha district, Vientiane. */
const LAT = 17.96886604207369;
const LNG = 102.62518586928178;

/* What BigDataCloud actually answered for it - the "administrative" list has
   no depth, and its last entry is the district NEXT DOOR. */
const BIGDATACLOUD = {
  countryName: "Lao People's Democratic Republic",
  principalSubdivision: "Viangchan",
  city: "Viangchan",
  locality: "Muang Sisattanak",
  localityInfo: {
    administrative: [
      { adminLevel: 2, name: "Laos" },
      { adminLevel: 4, name: "Viangchan" },
      { adminLevel: 6, name: "Muang Xaisettha" },
      { adminLevel: 6, name: "Muang Sisattanak" }
    ]
  }
};

const NOMINATIM = {
  display_name: "Nongbone Path, Naxay, Vientiane Capital, Xaysetha District, Vientiane Prefecture, 01003, Laos",
  address: {
    road: "Nongbone Path",
    village: "Naxay",
    county: "Xaysetha District",
    state: "Vientiane Prefecture",
    country: "Laos"
  }
};

function serve({ nominatim, bigdatacloud }) {
  globalThis.fetch = (url) => {
    const target = String(url);
    if (target.includes("nominatim")) {
      if (!nominatim) return Promise.reject(new Error("nominatim unreachable"));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(nominatim) });
    }
    if (target.includes("bigdatacloud")) {
      if (!bigdatacloud) return Promise.reject(new Error("bigdatacloud unreachable"));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(bigdatacloud) });
    }
    return Promise.reject(new Error("unexpected host: " + target));
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "iPhone", platform: "iPhone" },
    configurable: true,
    writable: true
  });
});
afterEach(() => {
  delete globalThis.fetch;
});

describe("reverseGeocode", () => {
  it("prefers Nominatim, which names the right district", async () => {
    serve({ nominatim: NOMINATIM, bigdatacloud: BIGDATACLOUD });
    const geo = await reverseGeocode(LAT, LNG);
    expect(geo.aal1).toBe("Vientiane Prefecture");
    expect(geo.aal2).toBe("Xaysetha District");
    expect(geo.locality).toBe("Naxay");
    expect(geo.fullAddress).toContain("Nongbone Path");
  });

  it("falls back to BigDataCloud, without stacking two sibling districts", async () => {
    serve({ nominatim: null, bigdatacloud: BIGDATACLOUD });
    const geo = await reverseGeocode(LAT, LNG);
    expect(geo.aal1).toBe("Viangchan");
    expect(geo.aal2).toBe("Muang Xaisettha");
    /*
      Previously "Muang Sisattanak" - a district recorded as a locality inside
      a DIFFERENT district. Empty is the honest answer; the coordinates are
      stored either way and the report groups by aal2.
    */
    expect(geo.locality).toBe(null);
    expect(geo.fullAddress).toBe("Muang Xaisettha, Viangchan, Laos");
  });

  it("keeps a genuine sub-district locality from BigDataCloud", async () => {
    serve({
      nominatim: null,
      bigdatacloud: {
        ...BIGDATACLOUD,
        locality: "Naxay",
        localityInfo: {
          administrative: [
            { adminLevel: 4, name: "Viangchan" },
            { adminLevel: 6, name: "Muang Xaisettha" },
            { adminLevel: 8, name: "Naxay" }
          ]
        }
      }
    });
    const geo = await reverseGeocode(LAT, LNG);
    expect(geo.locality).toBe("Naxay");
    expect(geo.fullAddress).toBe("Naxay, Muang Xaisettha, Viangchan, Laos");
  });

  it("drops a locality that merely repeats the district or province", async () => {
    serve({
      nominatim: {
        display_name: "Viangchan, Laos",
        address: { state: "Viangchan", county: "Muang Xaisettha", village: "Muang Xaisettha", country: "Laos" }
      },
      bigdatacloud: null
    });
    const geo = await reverseGeocode(LAT, LNG);
    expect(geo.locality).toBe(null);
  });

  it("returns null when neither provider can be reached", async () => {
    serve({ nominatim: null, bigdatacloud: null });
    expect(await reverseGeocode(LAT, LNG)).toBe(null);
  });
});

describe("withArea", () => {
  it("does not let a bridge-supplied city outrank the geocoded district", async () => {
    serve({ nominatim: null, bigdatacloud: BIGDATACLOUD });
    const out = await withArea({ lat: LAT, lng: LNG, city: "Viangchan" });
    expect(out.aal1).toBe("Viangchan");
    expect(out.aal2).toBe("Muang Xaisettha");
    expect(out.locality).toBe(null);   // "Viangchan" is the province, not a locality
  });
});

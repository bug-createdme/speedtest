import { beforeEach, describe, expect, it } from "vitest";

import { hasAreaTable, locateArea, setAreaTable } from "../../ui/src/context/geo.js";

/*
  The province is the key the report is grouped by, and it is decided here from
  a pair of coordinates. A lookup that is merely nearly right files rows under
  the wrong province while looking entirely ordinary, so what is pinned below is
  the geometry itself - concave shapes, disjoint pieces, and the bounding box the
  engine derives rather than trusts.

  Coordinates in the table are [longitude, latitude] (GeoJSON order); locateArea
  takes (lat, lng). The two are deliberately different numbers in every fixture
  so a swapped argument cannot pass.
*/

/* lng 100..102, lat 10..12 */
const SQUARE = [
  [
    [100, 10],
    [102, 10],
    [102, 12],
    [100, 12],
    [100, 10]
  ]
];

/*
  An L: the bottom bar (lng 100..102, lat 10..11) plus the left column
  (lng 100..101, lat 11..12). The top-right quadrant is a notch that is NOT part
  of the area, which is what a bounding-box test alone would get wrong.
*/
const L_SHAPE = [
  [
    [100, 10],
    [102, 10],
    [102, 11],
    [101, 11],
    [101, 12],
    [100, 12],
    [100, 10]
  ]
];

beforeEach(() => {
  setAreaTable(null);
});

describe("no table", () => {
  it("resolves nothing, and says so", () => {
    expect(hasAreaTable()).toBe(false);
    expect(locateArea(11, 101)).toBeNull();
  });

  it("treats a table with no usable areas as no table", () => {
    const count = setAreaTable({
      areas: [
        { aal1: "", rings: SQUARE }, // no name
        { aal1: "Nowhere", rings: [] }, // no polygon
        { aal1: "Too small", rings: [[[100, 10], [101, 11]]] } // two points enclose nothing
      ]
    });
    expect(count).toBe(0);
    expect(hasAreaTable()).toBe(false);
    expect(locateArea(11, 101)).toBeNull();
  });

  it("keeps the usable areas when only some are malformed", () => {
    const count = setAreaTable({
      areas: [{ aal1: "Broken", rings: [] }, { aal1: "Bokeo", rings: SQUARE }]
    });
    expect(count).toBe(1);
    expect(locateArea(11, 101).aal1).toBe("Bokeo");
  });
});

describe("point in area", () => {
  it("resolves a point inside, and nothing for one outside", () => {
    setAreaTable({ country: "Laos", areas: [{ aal1: "Bokeo", rings: SQUARE }] });
    expect(locateArea(11, 101)).toEqual({
      aal1: "Bokeo",
      aal2: null,
      country: "Laos"
    });
    expect(locateArea(9, 101)).toBeNull(); // south of it
    expect(locateArea(11, 99)).toBeNull(); // west of it
  });

  /*
    The case a bounding box gets wrong. The notch is inside the box that
    encloses the L and outside the L itself; a province resolved on the box
    alone would swallow its neighbour's territory.
  */
  it("excludes a point in the notch of a concave area", () => {
    setAreaTable({ areas: [{ aal1: "Attapeu", rings: L_SHAPE }] });
    expect(locateArea(10.5, 101.5).aal1).toBe("Attapeu"); // bottom bar
    expect(locateArea(11.5, 100.5).aal1).toBe("Attapeu"); // left column
    expect(locateArea(11.5, 101.5)).toBeNull(); // the notch
  });

  /* A province in several disconnected pieces is one area with several rings. */
  it("matches any piece of a multi-part area", () => {
    setAreaTable({
      areas: [
        {
          aal1: "Champasak",
          rings: [
            SQUARE[0],
            [
              [200, 20],
              [201, 20],
              [201, 21],
              [200, 21],
              [200, 20]
            ]
          ]
        }
      ]
    });
    expect(locateArea(11, 101).aal1).toBe("Champasak");
    expect(locateArea(20.5, 200.5).aal1).toBe("Champasak");
    expect(locateArea(15, 150)).toBeNull();
  });

  /*
    The bounding box is computed from the polygon, never read from the file. A
    file whose bbox disagrees with its own polygon would otherwise skip that
    province before the polygon test ran - silently, and for every run.
  */
  it("ignores a wrong bounding box in the file", () => {
    setAreaTable({
      areas: [{ aal1: "Bokeo", bbox: [0, 0, 1, 1], rings: SQUARE }]
    });
    expect(locateArea(11, 101).aal1).toBe("Bokeo");
  });

  it("refuses a position that is not a pair of numbers", () => {
    setAreaTable({ areas: [{ aal1: "Bokeo", rings: SQUARE }] });
    expect(locateArea(NaN, 101)).toBeNull();
    expect(locateArea(11, undefined)).toBeNull();
  });
});

describe("province and district", () => {
  /* A district entry names its province too, so one lookup answers both. */
  const table = {
    country: "Laos",
    areas: [
      { aal1: "Vientiane Capital", rings: SQUARE },
      {
        aal1: "Vientiane Capital",
        aal2: "Chanthabuly",
        rings: [
          [
            [100, 10],
            [101, 10],
            [101, 11],
            [100, 11],
            [100, 10]
          ]
        ]
      }
    ]
  };

  it("fills both when the point is inside a district", () => {
    setAreaTable(table);
    expect(locateArea(10.5, 100.5)).toEqual({
      aal1: "Vientiane Capital",
      aal2: "Chanthabuly",
      country: "Laos"
    });
  });

  /* Inside the province but in no district the table describes: the province is
     still a fact, and inventing a district for it would not be. */
  it("fills only the province when no district contains the point", () => {
    setAreaTable(table);
    const area = locateArea(11.5, 101.5);
    expect(area.aal1).toBe("Vientiane Capital");
    expect(area.aal2).toBeNull();
  });

  it("works with a province-only table", () => {
    setAreaTable({ areas: [{ aal1: "Bokeo", rings: SQUARE }] });
    expect(locateArea(11, 101).aal2).toBeNull();
  });

  it("reports no country when the table does not name one", () => {
    setAreaTable({ areas: [{ aal1: "Bokeo", rings: SQUARE }] });
    expect(locateArea(11, 101).country).toBeNull();
  });
});

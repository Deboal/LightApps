/* ===================== DESIGN BASIS =====================
   Source: Rev1 FULL STATUS SET - PJ office infill - 4-9-26
     Room numbers + order .... A2 proposed 1st / 2nd floor plans, M1.1
     Areas ................... M0.1 Outdoor Air Table (mech numbers the
                               1st floor in the 300s; same rooms as 100s)
     Depth ................... 14'-0" section depth, A2 / Section B-A4
     Overall ................. 145'-0" per A2 dimension string
   Drawn width = area / depth. Corridor band and stair positions are
   indicative, not dimensioned here.

   Dimensions live ON THE GROUP (depthFt / overallFt / stairFt), not as
   module globals, so a second building with a different footprint can be
   added later without touching the renderer. `site` is the physical
   location, ready for a location picker in the next pass.
========================================================= */

export const BASIS_LABEL = "Rev1 FULL STATUS SET - PJ office infill - 4-9-26";
export const LAYOUT_VERSION = 3;

/* B100 defaults, straight off the plan set. */
export const B100 = { depthFt: 14, overallFt: 145, stairFt: 7.67 };

export const BASIS = [
  {
    id: "b100-2",
    site: "903 Langley Rd, Red Bluff",
    building: "B100",
    floor: "2nd Floor",
    note: "Mezzanine",
    depthFt: B100.depthFt,
    overallFt: B100.overallFt,
    stairFt: B100.stairFt,
    items: [
      { kind: "room", code: "201", name: "Training Room", sf: 340, type: "support", cap: 0 },
      { kind: "room", code: "202", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "stair", label: "STAIR DN (20R)" },
      { kind: "room", code: "203", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "204", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "205", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "206", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "207", name: "Office", sf: 143, type: "office", cap: 2 },
      { kind: "room", code: "208", name: "Office", sf: 117, type: "office", cap: 2 },
      {
        kind: "room", code: "—", name: "Pilot Lockers", sf: null, widthFt: 14, est: true,
        type: "support", cap: 0, sub: "Guardrail gates — forklift access",
      },
      { kind: "room", code: "209", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "210", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "211", name: "Office", sf: 200, type: "office", cap: 2 },
      { kind: "stair", label: "STAIR DN (20R)" },
      { kind: "existing", label: "(E) EXISTING OFFICES — not in this scope" },
    ],
  },
  {
    id: "b100-1",
    site: "903 Langley Rd, Red Bluff",
    building: "B100",
    floor: "1st Floor",
    note: "Hangar level",
    depthFt: B100.depthFt,
    overallFt: B100.overallFt,
    stairFt: B100.stairFt,
    /* Drawn once per building, under the lowest floor. Omit on buildings
       that aren't a hangar and the band is skipped. */
    hangarLabel: "EXISTING HANGAR — (E) 60' × 22' HANGAR DOORS BEYOND",
    items: [
      {
        kind: "room", code: "100", name: "Vinyl Shop", sf: 340, type: "support", cap: 0,
        sub: "Paint mixing struck per 4-21 comments",
      },
      { kind: "room", code: "101", name: "PJ Swag Store", sf: 340, type: "support", cap: 0 },
      { kind: "stair", label: "STAIR UP (20R)" },
      { kind: "room", code: "102", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "103", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "104", name: "Rigging Equip. Storage", sf: 200, type: "support", cap: 0 },
      { kind: "room", code: "105", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "106", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "107", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "108", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "109", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "room", code: "110", name: "Office", sf: 117, type: "office", cap: 2 },
      { kind: "stair", label: "STAIR UP (20R)" },
      { kind: "existing", label: "(E) EXISTING OFFICES — not in this scope" },
    ],
  },
];

/* Expand the terse basis into the runtime shape (ids, derived widths). */
export function buildGroups(nextId) {
  return BASIS.map(function (g) {
    var depth = g.depthFt || B100.depthFt;
    return {
      id: g.id,
      site: g.site,
      building: g.building,
      floor: g.floor,
      note: g.note,
      depthFt: depth,
      overallFt: g.overallFt || B100.overallFt,
      stairFt: g.stairFt || B100.stairFt,
      hangarLabel: g.hangarLabel || "",
      items: g.items.map(function (it) {
        if (it.kind !== "room") return JSON.parse(JSON.stringify(it));
        return {
          kind: "room",
          id: nextId("r"),
          code: it.code,
          name: it.name,
          sub: it.sub || "",
          sf: it.sf === undefined ? null : it.sf,
          widthFt: it.widthFt || (it.sf ? it.sf / depth : depth),
          est: !!it.est,
          type: it.type,
          cap: it.cap,
        };
      }),
    };
  });
}

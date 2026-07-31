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

/* ===================== TRACED FLOOR =====================
   NOT from a plan set. Every coordinate below was traced by eye from a
   low-resolution raster image, at Alex's explicit direction, because no
   dimensioned source was available.

   What that means in practice:
     - Room positions and sizes are APPROXIMATE. Adjacency and rough
       proportion are meaningful; individual dimensions are not.
     - Room codes are trace placeholders (T01..), not real room numbers.
       Inventing numbers that might collide with a real scheme would be
       worse than obviously-fake ones. Rename from the real plan.
     - Every room carries est:true, so the whole floor draws dashed —
       the board's existing signal for "this dimension is inferred".
     - The overall envelope is anchored to the ~361 m² (~3,890 sf) figure
       in the image header, which was itself only partly legible.

   To correct this later: replace the numbers here. The renderer needs no
   changes, and a dimensioned source would simply drop in.
========================================================= */
var T = function (code, name, x, y, w, h, type, cap) {
  return { kind: "room", code: code, name: name, xFt: x, yFt: y, wFt: w, hFt: h,
           type: type || "office", cap: cap === undefined ? 2 : cap, est: true };
};

export const TRACED = {
  id: "b2-upper",
  site: "",
  building: "Building 2",
  floor: "Upper Floor",
  note: "Traced from image — approximate, not dimensioned",
  layout: "plan",
  approx: true,
  widthFt: 85,
  heightFt: 64,
  items: [
    /* detached wing, upper right */
    T("T01", "Office", 67, 1, 9, 9),
    T("T02", "Office", 76, 1, 8, 9),
    T("T03", "Office", 67, 10, 9, 9),
    T("T04", "Office", 76, 10, 8, 9),
    T("T05", "Office", 58, 13, 8, 7),
    /* top band of the main block */
    T("T06", "Office", 2, 21, 9, 10),
    T("T07", "Office", 11, 21, 9, 10),
    T("T08", "Kitchen", 24, 21, 16, 10, "support", 0),
    T("T09", "Office", 44, 21, 39, 10, "office", 4),
    /* left zone */
    T("T10", "Living Room 1", 2, 32, 14, 8, "support", 0),
    T("T11", "Office", 17, 32, 12, 8),
    T("T12", "Office", 2, 41, 14, 7),
    T("T13", "Office", 17, 41, 12, 7),
    T("T14", "Office", 2, 49, 14, 7),
    T("T15", "Office", 17, 49, 12, 7),
    T("T16", "Office", 2, 57, 14, 6),
    /* centre */
    T("T17", "Living Room 2", 31, 32, 13, 10, "support", 0),
    T("T18", "Office", 45, 32, 18, 15, "office", 6),
    T("T19", "Office", 31, 43, 13, 9),
    T("T20", "Living Room 3", 31, 53, 32, 10, "support", 0),
    /* right zone */
    T("T21", "Bathroom", 64, 32, 8, 9, "support", 0),
    T("T22", "Office", 73, 32, 10, 9),
    T("T23", "Office", 64, 42, 8, 7),
    T("T24", "Office", 73, 42, 10, 7),
    T("T25", "Office", 64, 50, 8, 7),
    T("T26", "Office", 73, 50, 10, 7),
    T("T27", "Office", 73, 58, 10, 5),
  ],
};

BASIS.push(TRACED);

/* Expand the terse basis into the runtime shape (ids, derived widths). */
export function buildGroups(nextId) {
  return BASIS.map(function (g) {
    var depth = g.depthFt || B100.depthFt;
    var plan = g.layout === "plan";
    return {
      id: g.id,
      site: g.site,
      building: g.building,
      floor: g.floor,
      note: g.note,
      layout: plan ? "plan" : "strip",
      approx: !!g.approx,
      depthFt: depth,
      overallFt: g.overallFt || B100.overallFt,
      stairFt: g.stairFt || B100.stairFt,
      widthFt: g.widthFt || 0,
      heightFt: g.heightFt || 0,
      hangarLabel: g.hangarLabel || "",
      items: g.items.map(function (it) {
        if (it.kind !== "room") return JSON.parse(JSON.stringify(it));
        var room = {
          kind: "room",
          id: nextId("r"),
          code: it.code,
          name: it.name,
          sub: it.sub || "",
          sf: it.sf === undefined ? null : it.sf,
          est: !!it.est,
          type: it.type,
          cap: it.cap,
        };
        if (plan) {
          /* Positioned rooms carry their own box; area is derived from it
             rather than scheduled, hence est:true above. */
          room.xFt = it.xFt; room.yFt = it.yFt;
          room.wFt = it.wFt; room.hFt = it.hFt;
          room.widthFt = it.wFt;
          room.sf = Math.round(it.wFt * it.hFt);
        } else {
          room.widthFt = it.widthFt || (it.sf ? it.sf / depth : depth);
        }
        return room;
      }),
    };
  });
}

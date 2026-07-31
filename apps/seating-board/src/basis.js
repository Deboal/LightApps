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
var T = function (code, name, x, y, w, h, type, cap, extra) {
  var r = { kind: "room", code: code, name: name, xFt: x, yFt: y, wFt: w, hFt: h,
            type: type || "office", cap: cap === undefined ? 2 : cap, est: true };
  if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  return r;
};

/* Rotate a room box inside a widthFt x heightFt envelope. Coordinates are kept
   in their as-traced orientation above and rotated here, so the trace stays
   comparable to the source image and reorienting is a one-number change. */
function rotateBox(r, W, H, deg) {
  if (deg === 90)  return { x: H - r.yFt - r.hFt, y: r.xFt,                w: r.hFt, h: r.wFt };
  if (deg === 180) return { x: W - r.xFt - r.wFt, y: H - r.yFt - r.hFt,    w: r.wFt, h: r.hFt };
  if (deg === 270) return { x: r.yFt,             y: W - r.xFt - r.wFt,    w: r.hFt, h: r.wFt };
  return { x: r.xFt, y: r.yFt, w: r.wFt, h: r.hFt };
}

export const TRACED = {
  id: "b2-upper",
  site: "",
  building: "Building 2",
  floor: "Upper Floor",
  note: "Traced from image — approximate, not dimensioned",
  layout: "plan",
  approx: true,
  /* As-traced envelope. rotateDeg turns the whole floor at build time; at 90
     or 270 the drawn canvas swaps to heightFt x widthFt. */
  widthFt: 85,
  heightFt: 64,
  rotateDeg: 90,
  /* Bump whenever the traced geometry changes. On load, a stored copy with a
     lower geomRev is rebuilt from this definition, carrying over each room's
     id (so existing assignments survive) and seat count, matched by code.
     rev 2 = rotated 90 CW, and Living Room 2 + Office 5 merged into T17.
     rev 3 = reapplies rev 2 now that seat counts only carry across when the
     room type is unchanged; T17 went support -> office, so it needed its
     definition's 4 seats rather than Living Room 2's 0.
     rev 4 = rev 3 left the stale 0 in place, because by then the stored copy
     already had the new type alongside the old count. T17 now sets forceCap. */
  geomRev: 4,
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
    /* centre.
       T17 is what the source image drew as two rooms, "Living Room 2" and
       "Office 5", divided by a wall that does not exist. Per Alex they are one
       space, and it is an open office with a single wall — so it is one
       assignable room here, flagged open. Which side the wall is on was not
       stated and is not guessed, so no single edge is drawn as solid. */
    /* forceCap because this code previously described "Living Room 2", a
       0-seat support room. Without it the reshape would carry that 0 forward
       onto a room that is now assignable. */
    T("T17", "Open Office", 31, 32, 13, 20, "office", 4, { open: true, forceCap: true,
      sub: "One-walled open area — was drawn as Living Room 2 + Office 5" }),
    T("T18", "Office", 45, 32, 18, 15, "office", 6),
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
    var deg = ((g.rotateDeg || 0) % 360 + 360) % 360;
    var turned = deg === 90 || deg === 270;
    var envW = g.widthFt || 0, envH = g.heightFt || 0;
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
      widthFt: turned ? envH : envW,
      heightFt: turned ? envW : envH,
      rotateDeg: deg,
      geomRev: g.geomRev || 0,
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
          var b = rotateBox(it, envW, envH, deg);
          room.xFt = b.x; room.yFt = b.y;
          room.wFt = b.w; room.hFt = b.h;
          room.widthFt = b.w;
          room.sf = Math.round(b.w * b.h);
          room.open = !!it.open;
          if (it.forceCap) room.forceCap = true;
        } else {
          room.widthFt = it.widthFt || (it.sf ? it.sf / depth : depth);
        }
        return room;
      }),
    };
  });
}

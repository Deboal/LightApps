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
     - Room codes are placeholders (U01..), not real room numbers. Inventing
       numbers that might collide with a real scheme would be worse than
       obviously-fake ones — and 201.. is already taken on this board, by
       B100's second floor. Renumber from the real plan when it arrives.
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
  rotateDeg: 180,
  /* Bump whenever the traced geometry changes. On load, a stored copy with a
     lower geomRev is rebuilt from this definition, carrying over each room's
     id (so existing assignments survive) and seat count, matched by code — or
     by the room's `was` code, for a rev that renames.
     rev 2 = rotated 90 CW, and Living Room 2 + Office 5 merged into T17.
     rev 3 = reapplies rev 2 now that seat counts only carry across when the
     room type is unchanged; T17 went support -> office, so it needed its
     definition's 4 seats rather than Living Room 2's 0.
     rev 4 = rev 3 left the stale 0 in place, because by then the stored copy
     already had the new type alongside the old count. T17 now sets forceCap.
     rev 5 = Alex's first naming pass. Merges (T14+T16, T10+T06+T07,
     T02+T03+T04 as an L around T01), the T17 open area split into three
     offices, and hallways/stair/server/storage/second bathroom reclassified.
     T03, T04, T07, T10, T16 and T17 no longer exist as codes.
     rev 6 = Alex's second pass, and the whole T-series is retired for a
     gap-free U01-U18. A further 90 CW (rotateDeg 90 -> 180) puts the floor
     landscape. Everything Alex placed by eye was described in the orientation
     he was looking at — the 64' x 85' portrait — so the edits below were
     worked there and mapped back: the T17 offices onto the cubicle grid, the
     accounting desks to the far corner of their L, kitchen + right hallway
     into one unnumbered space, and the left hallway run from the office at
     the top to the bottom wall, absorbing T27. */
  geomRev: 6,
  items: [
    /* ---- circulation ----
       Codes here are internal keys for the migration only. Circulation carries
       no room number on the drawing, deliberately: a hallway with a code
       invites someone to name and fill it. */
    T("C01", "Hallway", 16, 57, 69, 6, "support", 0,
      { circ: true, was: ["T20", "T27"],
        sub: "Runs the length of the floor to U16 — absorbs the old T20 and T27" }),
    /* The kitchen opens onto the corridor rather than closing off from it, so
       the two are one space and it takes no number. The 4' the old T08 and T09
       left between them was the wall that isn't there. */
    T("C02", "Kitchen / Hallway", 24, 21, 59, 10, "support", 0,
      { circ: true, was: ["T08", "T09"] }),
    T("C03", "Stair", 58, 13, 8, 7, "support", 0, { circ: true, was: "T05" }),

    /* ---- first column: three offices, then the accounting block ---- */
    T("U01", "Office", 73, 50, 10, 7, "office", 2, { was: "T26" }),
    T("U02", "Office", 73, 42, 10, 7, "office", 2, { was: "T24" }),
    T("U03", "Office", 73, 32, 10, 9, "office", 2, { was: "T22" }),
    /* The accounting L has no primitive. U04 is its bounding box drawn FIRST
       and U05 paints over the corner, so paint order carves the notch and
       clicks in that corner land on U05 because it sits on top. Item order
       matters here; do not sort this list. sfOverride is the real L area,
       since the bounding box overstates it by U05's 81 sf. */
    T("U04", "Accounting — open", 67, 1, 17, 18, "office", 4,
      { sfOverride: 225, forceCap: true, was: "T02",
        sub: "L-shaped, wraps U05 — was drawn as three rooms" }),
    T("U05", "Accounting — 2 desks", 75, 1, 9, 9, "office", 2,
      { was: "T01", sub: "Kept subdivision inside the accounting office" }),

    /* ---- second column ---- */
    T("U06", "Bathroom", 64, 50, 8, 7, "support", 0, { was: "T25" }),
    T("U07", "Storage", 64, 42, 8, 7, "support", 0, { was: "T23" }),
    T("U08", "Bathroom", 64, 32, 8, 9, "support", 0, { was: "T21" }),

    /* ---- third column ---- */
    T("U09", "Conference Room", 45, 32, 18, 20, "support", 0,
      { was: "T18", sub: "No office seats" }),

    /* ---- fourth column: the offices, now on the cubicle grid ----
       Each one takes the width and the run of the cubicle beside it, so the
       two columns line up instead of straddling each other's walls. This is
       also what frees the strip the hallway runs down. */
    T("U10", "Office", 31, 49, 13, 7, "office", 2, { was: "T17A" }),
    T("U11", "Office", 31, 41, 13, 7, "office", 2, { was: "T17B" }),
    T("U12", "Office", 31, 32, 13, 8, "office", 2, { was: "T17C" }),

    /* ---- fifth column: cubicles, which set the grid ---- */
    T("U13", "Cubicles", 17, 49, 12, 7, "office", 2, { was: "T15" }),
    T("U14", "Cubicles", 17, 41, 12, 7, "office", 2, { was: "T13" }),
    T("U15", "Cubicles", 17, 32, 12, 8, "office", 2, { was: "T11" }),

    /* ---- sixth column ---- */
    T("U16", "Office", 2, 49, 14, 14, "office", 2,
      { was: "T14", sub: "Was drawn as two rooms" }),
    T("U17", "Server Room", 2, 41, 14, 7, "support", 0,
      { was: "T12", sub: "Labelled for reference — not occupied" }),
    T("U18", "Office", 2, 21, 14, 19, "office", 2,
      { was: "T06", sub: "Was drawn as three rooms" }),
  ],
};

BASIS.push(TRACED);

/* ============= 821 LAWN WAY — BUILDING 100, BOTTOM FLOOR =============
   Source: "FLOOR PLAN – BOTTOM FLOOR / 821 Lawn Way, Red Bluff, CA
   (Approximate Layout)", drawn at 1/8" = 1'-0" and carrying its own note:
   "All dimensions are approximate. Not for construction."

   Unlike the traced floor above, this one IS dimensioned. Every room but the
   locked office comes from the plan's two ROOM DIMENSIONS tables, read as
   width x depth — the reading the plan corroborates twice over (see the
   closures below). Positions come from the drawn adjacency and are
   approximate; the sizes are not guessed. Rooms still carry est:true and the
   group is approx:true, because the plan itself declines to be authoritative.

   Two places the plan does not close, both left visible rather than smoothed:

     - The top dimension string reads 31'-6" + 6'-0" + 29'-0" + 28'-0" +
       24'-0" + 12'-0" = 130'-6" against a stated 131'-0" overall. The room
       widths back the split rather than the total: the left block closes
       exactly on 66'-6" (9'-6" + 9'-6" + 6'-0" + 11'-6" + 10'-6" + 19'-6")
       and the right block on 64'-0" (28 + 24 + 12).

     - The right-hand depth string reads 36'-0", but the tabulated depths
       stacked down that side need 44'-6" — 11'-6" + 13'-6" + 6'-0" + 11'-6"
       on the far column, 13'-6" + 17'-6" + 13'-6" in the column beside it.
       The rooms are drawn at their tabulated depths and the envelope follows
       them, so the 8'-6" disagreement stays on the drawing instead of being
       absorbed into a room nobody measured.

   Codes are placeholders, as on the traced floor. L.. is the plan's left-hand
   room-dimension table, R.. the right-hand one. They are page-relative, NOT
   compass directions: the plan carries no north arrow and this board does not
   invent one — see the B100 open items.

   Two labelling faults in the plan, resolved here and worth raising with
   whoever drew it:
     - Office 1, 2 and 3 appear in BOTH tables as different rooms. Hence L/R.
     - Two rooms are labelled "Dining Room 1". The dimension table names the
       lower one Dining Room 2 at 18'-0" x 13'-6", which is what is used.

   The bottom-left corner below Filing is drawn with furniture but is not
   labelled or tabulated, so it is left as blank floor rather than invented.
===================================================================== */
export const LAWN_WAY_BOTTOM = {
  id: "b100-lawnway-bottom",
  site: "821 Lawn Way, Red Bluff, CA",
  building: "Building 100",
  floor: "Bottom Floor",
  note: "Dimensioned from the plan tables — plan marks all dimensions approximate",
  layout: "plan",
  approx: true,
  /* Width per the plan's overall string. Height follows the tabulated room
     depths, which overrun the plan's 36'-0" string by 8'-6". */
  widthFt: 131,
  heightFt: 44.5,
  rotateDeg: 0,
  approxLabel: "DIMENSIONS APPROXIMATE — PER THE PLAN'S OWN NOTE",
  caveat: "(sizes are the plan's own room tables, but the plan marks every " +
          "dimension approximate and its 36'-0\" depth string does not close " +
          "against them; room codes are placeholders)",
  geomRev: 1,
  items: [
    /* ---- left block — the plan's first ROOM DIMENSIONS table ----
       Top band is 11'-6" deep and closes across the block at 66'-6". */
    T("L01", "Office 2", 0, 0, 9.5, 11.5, "office", 2),
    T("L02", "Office 1", 9.5, 0, 9.5, 11.5, "office", 2),
    T("L03", "Office (locked)", 19, 0, 6, 11.5, "office", 1,
      { sub: "“Locked when scanned” on the plan — the one room with no tabulated size" }),
    T("L04", "Office 3", 25, 0, 11.5, 11.5, "office", 2),
    T("L05", "Office 4", 36.5, 0, 10.5, 11.5, "office", 2),
    /* 23'-6" deep — it is the kitchen that sets the left block's depth. */
    T("L06", "Kitchen / Break Room", 47, 0, 19.5, 23.5, "support", 0),
    T("L07", "Filing", 0, 11.5, 21.5, 6, "support", 0),
    T("L08", "Open Office 4", 21.5, 13.5, 15.5, 10, "office", 4,
      { sub: "Bottom-aligned to the block. Four workstations drawn — the seat count follows the desks" }),

    /* ---- right block — the plan's second ROOM DIMENSIONS table ---- */
    T("R01", "Reception", 67, 0, 28, 23.5, "office", 4,
      { sub: "“Reception — 4 Desks” on the plan" }),
    T("R02", "Office 2", 95, 0, 11.5, 13.5, "office", 2),
    /* 57 sf. The gap to its left is the unlabelled closet/hall on the plan. */
    T("R03", "Office 1", 113, 0, 6, 9.5, "office", 1),
    T("R04", "Office 3", 119, 0, 12, 11.5, "office", 2),
    T("R05", "Living Room 1", 95, 13.5, 24, 17.5, "office", 2,
      { sub: "Two “1 Desk” call-outs on the plan" }),
    T("R06", "Dining Room 1", 119, 11.5, 12, 13.5, "support", 0,
      { sub: "Table and chairs drawn — no desks, so no seats" }),
    T("R07", "Office 5", 119, 25, 12, 6, "office", 1),
    T("R08", "Office (two desks)", 119, 31, 12, 11.5, "office", 2,
      { sub: "Plan label: “1 Office with Two Desks”" }),
    T("R09", "Dining Room 2", 95, 31, 18, 13.5, "support", 0,
      { sub: "Drawn as a second “Dining Room 1”; the dimension table names it Dining Room 2" }),

    /* ---- the bump-out below the left block ----
       Bathroom 1 + Bathroom 2 stack to 15'-6", exactly Office 6's depth
       beside them, which is what fixes this group's position. */
    T("R10", "Bathroom 1", 63.5, 23.5, 6.5, 9.5, "support", 0),
    T("R11", "Bathroom 2", 63.5, 33, 6.5, 6, "support", 0),
    T("R12", "Office 6", 70, 23.5, 6.5, 15.5, "office", 1,
      { sub: "100 sf and 6'-6\" wide — one desk" }),
  ],
};

BASIS.push(LAWN_WAY_BOTTOM);

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
      /* Both default to the traced floor's wording, which was the only kind of
         approximate floor when the flag was introduced. A floor that is
         dimensioned but declared approximate says so in its own words. */
      approxLabel: g.approxLabel || "",
      caveat: g.caveat || "",
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
          /* sfOverride exists for rooms whose bounding box overstates them —
             an L drawn as a rectangle with another room over its corner. */
          room.sf = it.sfOverride || Math.round(b.w * b.h);
          room.open = !!it.open;
          room.circ = !!it.circ;
          if (it.forceCap) room.forceCap = true;
          /* The code this room used to carry. Without it a renumbering pass
             would look like 18 new rooms to the migration, every id would be
             reminted, and every existing assignment would point at nothing. */
          if (it.was) room.was = it.was;
        } else {
          room.widthFt = it.widthFt || (it.sf ? it.sf / depth : depth);
        }
        return room;
      }),
    };
  });
}

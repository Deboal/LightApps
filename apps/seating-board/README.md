# Seating Board

Seating assignment board for the PJ Helicopters B100 hangar office infill
(903 Langley Rd, Red Bluff). Draws the 23 new spaces to scale from the plan set
and lets you drag people from a roster into rooms. The point of the visual is the
fill-state colouring: it makes "who is missing a desk" and "which room is
over-seated" readable at a glance.

Live at `/<hub>/seating-board/`.

## Design basis — don't break this

Derived from `Rev1_FULL STATUS SET - PJ office infill - 4-9-26.pdf`. The geometry
is not decorative; it's how the board gets reviewed.

| Thing | Source |
|---|---|
| Room numbers and order | Sheet A2 (proposed 1st/2nd floor plans) and M1.1. Drawn left to right as they appear on A2. |
| Areas | M0.1 Outdoor Air Table. The mechanical engineer numbers the 1st floor in the **300s**; every other sheet uses **100s**. Same rooms. This board uses the 100s. |
| Depth | 14'-0", per A2 and Section B-A4. Both levels. |
| Overall | 145'-0", per the A2 dimension string. |

Derivations, and the tie-out that proves the drawing closes:

- Drawn room width = scheduled area ÷ floor depth.
- Scheduled rooms total **129'-8"** (2nd floor) and **129'-9"** (1st floor).
- Two stair enclosures at **7'-8"** each carry the **15'-4"** balance, so both
  floors close on the 145'-0" overall.
- The tie-out is **computed and displayed per floor** in the "How this is drawn"
  note, not hardcoded. Edit the room table and the note tells you whether it
  still closes, and by how much it doesn't.
- **Pilot Lockers has no scheduled area.** Its width is an estimated 14'-0" and
  it is drawn with a dashed outline for exactly that reason. Keep the dashed
  treatment — it marks the one place the drawing is inferred.
- Corridor/catwalk band and stair *positions* are **indicative, not
  dimensioned**, and labelled as such. Don't let them get promoted to fact.
- **There is deliberately no compass on the drawing.** See open items.

Inventory: **18 private offices** (102, 103, 105–110 first floor; 202–211
second) plus **5 support/shared spaces** (100 Vinyl Shop, 101 PJ Swag Store,
104 Rigging Equip. Storage, 201 Training Room, Pilot Lockers). Support spaces
default to 0 seats so they can't silently absorb people; each is adjustable.

## Files

| File | Role |
|---|---|
| `index.html` | Shell and all CSS. Styles are scoped under `.board-root` so they don't leak into the shared AuthGate. |
| `src/app.jsx` | Entry. Shared `AuthGate` + mounts the board. React does nothing else. |
| `src/board.js` | The board: ~600 lines of vanilla DOM, to-scale rendering, drag-drop. |
| `src/basis.js` | The design basis as data, plus `buildGroups()`. |
| `src/persist.js` | Supabase sync — split writes, ready gate, revision check. |

The board is **deliberately not React**. The geometry and drag-drop are the
whole value; a rewrite would risk them for nothing the user would see. React's
only jobs are auth and mounting.

## Persistence

Shared, not per-user — `store("b100-seating", { shared: true })`. A board where
each person saw only their own assignments would be useless.

Writes are **split across documents rather than one blob**, because one document
means last-write-wins: two people placing different staff would erase each
other's work.

| collection | doc_id | data | written |
|---|---|---|---|
| `layout` | `b100` | `{groups, basis, version, rev}` | Rooms / seat-count changes (rare) |
| `people` | `<person_id>` | `{name, dept}` | Roster add |
| `assignments` | `<person_id>` | `{roomId, at, by}` | Every placement |

One row per person means concurrent placements never collide. Two guards:

- **`ready` gate** — nothing is written until the first load resolves. Without
  it the initial render would push local defaults over shared server state.
- **`rev` check** — the layout doc carries a revision. A write that finds a
  newer rev on the server refuses and prompts a reload instead of clobbering.
  Seat-count edits are rare enough that optimistic checking is the right amount
  of machinery.

Realtime is on, so a board open on two screens stays in step. Own-write echoes
are debounced and skipped while a write is in flight.

`Save file` / `Open file` remain as an offline fallback and export path.

## Multi-location

Groundwork is in, the editor is not. Dimensions live **on the group**
(`depthFt`, `overallFt`, `stairFt`, `site`, `hangarLabel`), not as globals, so a
second building brings its own footprint, ruler and overall dimension rather
than borrowing B100's. **Add space** takes site, depth and overall, and
verifying this was part of the build: a B200 at 20'-0" deep × 90'-0" overall
renders correctly alongside B100 with its own ruler.

Still to do when the other plans arrive: a location/building picker rather than
one long scroll, and a proper room-table editor instead of adding spaces one at
a time.

`people` carries an optional `dept`. Paste `Casey Tingley, Maintenance` in
**Add names** and the chip gets a department colour band; names without one
degrade to no band. It's in now so the roster doesn't need a migration later.

## Open items for Ted Rawlings — not blockers

1. **End orientation.** Ted's 4/21 comments to Modern reference conference rooms
   at the north end on both levels. In the 4/9 set the end rooms are 201
   Training Room and 100 Vinyl Shop / 101 PJ Swag Store — no conference rooms.
   Either the naming changed after 4/9, or "north end" is the opposite end of
   the board's left-to-right order. A compass was **deliberately left off**
   rather than guessed. Don't add one without confirmation.
2. **Room numbering.** M0.1 uses the 300-series for the first floor against the
   100-series everywhere else. Worth flagging so the permit set is consistent.
3. **Newer plan set exists.** The 4/9 Rev1 set predates Ted's 4/21 corrections
   (Room 100 goes vinyl-only, no paint mixing; the north door at 110 comes out).
   The as-submitted-to-City set is on Dropbox, linked in Ted's 5/22 "B100 Office
   Complex - Contract" email. Worth reconciling the room table against it. It
   won't change the seat count.

## Before the real roster goes in

The board will hold employee names mapped to physical rooms, on a static site
whose publishable key ships in the bundle. Two things to settle first:

- Run `schema-auth-enforce.sql` to drop anonymous access, so the URL alone isn't
  enough to read or write the board.
- Sort the Supabase SMTP sender. Quanta's mail filtering quarantines Supabase's
  default sender, so sign-in currently means releasing an email from quarantine
  — workable for one person, not for a team.

Test with placeholder names until both are done.

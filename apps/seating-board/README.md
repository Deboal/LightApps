# Seating Board

Seating assignment board. Draws each floor to scale and lets you drag people
from a roster into rooms. The point of the visual is the fill-state colouring:
it makes "who is missing a desk" and "which room is over-seated" readable at a
glance.

Floors on the board, in decreasing order of how much the geometry can be
trusted — the board labels each one accordingly and never lets an inferred
dimension pass as a surveyed one:

| Floors | Source |
|---|---|
| B100 1st + 2nd, 903 Langley Rd | Dimensioned plan set (below) |
| Building 100 Bottom Floor, 821 Lawn Way | Dimensioned plan, marked approximate by its own author |
| Building 2 Upper Floor | Traced by eye from a low-resolution image |

Buildings are keyed by site, and the address prints once above each one.

Live at `/<hub>/seating-board/`.

## B100 design basis — don't break this

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

## Building 2 — Upper Floor

Traced by eye from a low-resolution image; **18 numbered spaces + 3 circulation
areas, 28 seats** in an 85'-0" × 64'-0" envelope. Adjacency and rough proportion
are meaningful here; individual dimensions are not.

Codes are `U01–U18`, sequential with no gaps, numbered down each column from the
left. They replaced the old `T..` series, which had grown gaps and A/B/C
suffixes across five revisions. They stay **placeholders** — `201..` is the
obvious "real" numbering and it is already taken on this board by B100's second
floor.

**Circulation carries no number**, by design: the hallways, the stair and the
kitchen (which opens onto the corridor rather than closing off from it, so the
two are one space). Their `C01–C03` codes are internal keys for the migration
and are never drawn.

### Renumbering safely

Codes are the only handle a stored room has, so a revision that renames them
would otherwise read as a floor full of new rooms: every id reminted, every
assignment pointing at nothing. Each room therefore declares the code(s) it used
to carry:

```js
T("U16", "Office", 2, 49, 14, 14, "office", 2, { was: "T14" }),
T("C01", "Hallway", 16, 57, 69, 6, "support", 0, { circ: true, was: ["T20", "T27"] }),
```

`reshape()` matches on the current code first, then walks that list. **Every
retired code must appear in exactly one `was`.**

A list, because a merge has several predecessors. The first keeps its id; the
rest are recorded as *absorbed*, and on load anyone sitting in one is walked
into the room that replaced theirs. That has to be **written back**, not just
fixed on screen — once the new layout is stored the absorbed ids are gone from
it, and the next browser to load has nothing left to work out where those people
went.

A last backstop for a room that vanishes without saying what replaced it: an
assignment pointing at an id the layout no longer has makes that person
*invisible* — in no room, and not in Unplaced either, because their `roomId` is
still set. Those go back in the pool with a console warning, and are deliberately
**not** written back, so the stored assignment survives if a later revision
restores the room.

### Orientation

`rotateDeg` turns the whole floor at build time. Coordinates in `basis.js` stay
in their as-traced orientation so the trace remains comparable to the source
image, and reorienting is a one-number change. Consequence worth knowing: **edits
described as "left", "bottom right" and so on are orientation-dependent** and
have to be mapped back to as-traced coordinates before they go in the file.

## 821 Lawn Way — Building 100, Bottom Floor

Added from *FLOOR PLAN – BOTTOM FLOOR, 821 Lawn Way, Red Bluff, CA (Approximate
Layout)*, 1/8" = 1'-0". **20 spaces, 28 seats, 3,527 sf drawn** inside a
131'-0" × 44'-6" envelope.

This floor sits between B100 and the traced upper floor in how much it can be
trusted, and the board says so in its own words rather than borrowing the traced
floor's "TRACED, NOT DIMENSIONED":

- **Sizes are the plan's**, off its two ROOM DIMENSIONS tables, read as
  width × depth. Only the locked office has no tabulated size.
- **Positions are approximate**, from the drawn adjacency.
- The plan's own note is *"All dimensions are approximate. Not for
  construction,"* so every room stays `est` and the floor stays `approx`.

Two places the plan doesn't close, both left visible:

| | Plan says | Rooms say |
|---|---|---|
| Overall width | 131'-0" (string sums to 130'-6") | 66'-6" left block + 64'-0" right = **130'-6"** |
| Right-hand depth | 36'-0" | **44'-6"** stacked down the right columns |

The width reading is corroborated twice — the left block closes exactly on
9'-6" + 9'-6" + 6'-0" + 11'-6" + 10'-6" + 19'-6" = 66'-6", which is also what
confirms the tables are width × depth. The depth string is 8'-6" short of the
rooms it dimensions; rooms are drawn at their tabulated depths and the envelope
follows them, so the disagreement stays on the drawing.

**Codes are placeholders**, as on the traced floor. `L01–L08` is the plan's
left-hand dimension table, `R01–R12` the right-hand one. Page-relative, **not
compass directions** — this plan has no north arrow either, and the same rule
applies: don't add one without confirmation.

Two faults in the plan, resolved here and worth raising with whoever drew it:

1. **Office 1, 2 and 3 each appear twice**, as different rooms in the two
   tables. That is what the L/R codes are for.
2. **Two rooms are labelled "Dining Room 1."** The dimension table names the
   lower one Dining Room 2 at 18'-0" × 13'-6", which is what is drawn.

Seat counts follow the desks the plan calls out — Reception 4, "1 Office with
Two Desks" 2, Living Room 1 two ("1 Desk" twice), Open Office 4 four. Rooms too
small for two (locked office, R03 at 57 sf, Office 5, Office 6) get one. Dining
rooms, bathrooms, Filing and the Kitchen carry 0, like every other support
space. The unlabelled corner below Filing has furniture drawn but no label and
no tabulated size, so it is left as blank floor rather than invented.

**Open question: is this the same building as "Building 2 · Upper Floor"?** It
may well be — both plans use the same residential room vocabulary (Living Room,
Dining Room, Kitchen), and the traced floor's ~3,890 sf is close to this one's.
The traced envelope's proportions don't agree, but that trace was explicitly
eyeballed from a low-resolution image with only the area figure to anchor it, so
it is the weaker evidence. Nothing was renamed on a guess: confirm it and the two
become one building with one site, or leave them as two.

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

## No sign-in — deliberate

This app does **not** use the shared `AuthGate`. It holds names and office
numbers, which is wall-map information, so the sign-in friction wasn't worth it.

Two consequences to be clear about:

- **The URL permits writing, not just reading.** Anyone with the link can
  reassign or clear the board. `Save file` exports are the only undo.
- **`schema-auth-enforce.sql` must stay UNRUN.** It drops the anonymous
  policies this app depends on and would break it completely. If a future app in
  the hub needs enforcement, this one has to move to its own project or grow a
  sign-in first.

Because there's no signed-in identity, the `by` field on an assignment comes
from a name the user sets via the **Who am I?** button, kept in `localStorage`.
It's a courtesy label so changes are readable later — nothing verifies it, and
it is not a credential. Rows written anonymously have a null `owner`.

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

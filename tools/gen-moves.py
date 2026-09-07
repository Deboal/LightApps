#!/usr/bin/env python3
"""Generate apps/gba/src/moves.js from a pokefirered checkout.

The runner needs to know which of a party member's four moves does damage.
Typing 355 rows by hand is how a table gets one wrong entry that nothing ever
catches, so it is extracted from the game's own source instead.

    python3 tools/gen-moves.py [path-to-pokefirered]
"""
import json, os, re, sys

PRET = sys.argv[1] if len(sys.argv) > 1 else "/home/user/pret/pokefirered"
OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "gba", "src", "moves.js")

def defines(path, prefix):
    out = {}
    for line in open(path):
        m = re.match(rf"#define\s+({prefix}[A-Z0-9_]+)\s+(\d+)\s*$", line)
        if m:
            out[m.group(1)] = int(m.group(2))
    return out

ids = defines(f"{PRET}/include/constants/moves.h", "MOVE_")
types = defines(f"{PRET}/include/constants/pokemon.h", "TYPE_")
text = open(f"{PRET}/src/data/battle_moves.h").read()

moves = {}
for m in re.finditer(r"\[(MOVE_[A-Z0-9_]+)\]\s*=\s*\{(.*?)\n\s*\},", text, re.S):
    name, body = m.group(1), m.group(2)
    if name not in ids:
        continue
    def field(f, default=0):
        g = re.search(rf"\.{f}\s*=\s*([A-Z0-9_]+)", body)
        if not g:
            return default
        v = g.group(1)
        return int(v) if v.isdigit() else types.get(v, default)
    moves[ids[name]] = {"n": name[5:].replace("_", " "), "p": field("power"),
                        "t": field("type", 0), "pp": field("pp", 0)}

rows = [moves.get(i, {"n": "", "p": 0, "t": 0, "pp": 0}) for i in range(max(moves) + 1)]
with open(OUT, "w") as f:
    f.write("""// moves.js -- generated from pokefirered's battle_moves.h. Do not hand-edit.
//
// What the runner needs in order to stop using Growl on a wild Pokemon: which
// of a party member's four moves actually does damage. Power is the point;
// type and PP come along because they cost nothing here and the next
// increment -- type effectiveness -- will want them.
//
// Regenerate with `python3 tools/gen-moves.py <pokefirered>`.

/** One row per move id, index 0 being "no move". `p` is base power, zero for
 *  a status move; `t` is the type id; `pp` is the maximum PP. */
export const MOVES = """)
    f.write(json.dumps(rows, separators=(",", ":")))
    f.write(""";

export const moveName = (id) => (id && MOVES[id] ? MOVES[id].n : "");
""")
print(f"wrote {len(rows)} moves to {os.path.normpath(OUT)}")

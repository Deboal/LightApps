// theme.js — the visual system for the crew and pacer brief.
//
// Old West, but a working one. The reference is not a costume: it is a lantern-lit
// waybill in a leather folder — oiled dark ground, brass and amber for signal,
// oxblood for a stop, desert sage for clear. Read at 2 AM at an aid station, so it
// stays dark by design: a white flash there costs night vision, which is a real
// cost, not an aesthetic preference.
//
// Period feel comes from structure rather than from webfonts, which the repo does
// not carry: double rules, wide-tracked small caps for labels, a serif display
// face, and monospaced figures for anything a crew reads off in a hurry — the
// ledger-and-telegraph register the era actually used.

export const C = {
  bg: "#14100c",       // oiled leather, near-black with warmth
  panel: "#1e1811",
  panel2: "#261e15",
  line: "#3d3122",     // worn edge
  rule: "#59462f",     // heavier rule, for the double-rule dividers
  text: "#f2e6cf",     // lamplit parchment
  dim: "#b09b7e",
  faint: "#7a684f",

  accent: "#c8873f",   // brass lantern — the one warm signal colour
  warm: "#d9a544",     // amber, for caution
  danger: "#a8402f",   // oxblood, for a stop
  good: "#7d8f4e",     // desert sage, for clear

  A: "#6b7f9e",        // faded denim
  B: "#9a6b8c",        // dusty plum
};

export const display = 'Georgia,"Iowan Old Style","Times New Roman",serif';
export const font = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
export const mono = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';

// A double rule. Thick over thin is the handbill convention, and it reads as a
// deliberate divider rather than a default border.
export const doubleRule = {
  borderTop: `2px solid ${C.rule}`,
  borderBottom: `1px solid ${C.line}`,
  height: 3,
  boxSizing: "content-box",
};

// Wide-tracked small caps. Used for every label and eyebrow.
export const eyebrow = {
  fontSize: 10,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: C.faint,
};

// Tabular figures everywhere a column of numbers has to line up.
export const figures = { fontFamily: mono, fontVariantNumeric: "tabular-nums" };

// Severity colour for a cutoff margin, in hours. The bands come from what a crew
// can actually act on: under 2 h there is no room for a bad patch, under 6 h a
// single long sleep spends it.
export function marginColor(hours) {
  if (hours == null) return C.faint;
  if (hours < 2) return C.danger;
  if (hours < 6) return C.warm;
  return C.good;
}

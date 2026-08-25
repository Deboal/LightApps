// The oracle's vocabulary. Everything here is baked into the bundle — no
// network, no backend, works in a hangar with zero bars.

// Classic 8-ball proportions: 10 affirmative, 5 non-committal, 5 negative.
// We keep the same 2:1:1 feel so the ball still *mostly* says yes, which is
// exactly how capital requests get approved in real life.
export const TONES = {
  approve: { label: "FUND IT", color: "#3ddc97", note: "Capitalize it." },
  defer: { label: "HOLD", color: "#ffc857", note: "Not a no. Not a yes." },
  deny: { label: "DENIED", color: "#ff5d73", note: "Take it to OPEX." },
};

export const WEIGHTS = { approve: 10, defer: 5, deny: 5 };

export const ANSWERS = [
  // --- approve ---------------------------------------------------------
  { t: "approve", s: "Signs point to approved." },
  { t: "approve", s: "Fund it. The payback pencils." },
  { t: "approve", s: "Yes — it's already in the plan." },
  { t: "approve", s: "IRR clears the hurdle. Go." },
  { t: "approve", s: "Approved, contingent on a real quote." },
  { t: "approve", s: "Buy it. The rental line is bleeding you." },
  { t: "approve", s: "The asset outlives the debt. Proceed." },
  { t: "approve", s: "Yes, and do it before the lead time doubles." },
  { t: "approve", s: "Without a doubt. This one pays for itself." },
  { t: "approve", s: "Sign the AFE. You had me at 'utilization'." },
  { t: "approve", s: "Yes — cheaper than the downtime it prevents." },
  { t: "approve", s: "Green light. The budget owner already nodded." },
  { t: "approve", s: "It is decidedly so. Book it as growth capital." },
  { t: "approve", s: "Approved. Depreciate it and never think of it again." },

  // --- defer -----------------------------------------------------------
  { t: "defer", s: "Ask again after month-end close." },
  { t: "defer", s: "Reply hazy — send the quote." },
  { t: "defer", s: "Concentrate and re-run the model." },
  { t: "defer", s: "Cannot predict now. Where is the AFE?" },
  { t: "defer", s: "Better not tell you until the Q3 reforecast." },
  { t: "defer", s: "Depends: is this maintenance or growth?" },
  { t: "defer", s: "Phase it. Ask me again about phase two." },
  { t: "defer", s: "Get a second bid, then shake me." },
  { t: "defer", s: "Honestly? That smells like OPEX. Check again." },
  { t: "defer", s: "Defer one year. Next fiscal has room." },
  { t: "defer", s: "Unclear. Nobody has priced the install." },
  { t: "defer", s: "Ask your controller. Then ask me." },

  // --- deny ------------------------------------------------------------
  { t: "deny", s: "Don't count on it." },
  { t: "deny", s: "My sources say the budget is spent." },
  { t: "deny", s: "Very doubtful. The useful life is three years." },
  { t: "deny", s: "No. That is a lease wearing a purchase costume." },
  { t: "deny", s: "Outlook not so good — utilization is 40%." },
  { t: "deny", s: "The hurdle rate says no. Loudly." },
  { t: "deny", s: "No. You'll be maintaining that thing forever." },
  { t: "deny", s: "Corporate claws this back in Q4. Pass." },
  { t: "deny", s: "Absolutely not this quarter." },
  { t: "deny", s: "That's a want, not a need." },
  { t: "deny", s: "My reply is no. So is the bank's." },
  { t: "deny", s: "No — the maintenance tail eats the savings." },
];

export const FINE_PRINT = [
  "Not financial advice. Obviously.",
  "Estimates unaudited and cheerfully invented.",
  "Subject to board approval and the mood of the CFO.",
  "The ball has never seen your cash flow statement.",
  "Any resemblance to your actual capital plan is coincidental.",
  "Rounding differences are the ball's love language.",
  "Consult a human before wiring money.",
  "The ball does not accept purchase orders.",
];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Three throwaway metrics that make the verdict feel researched. They are
// pure theater, but they lean the right way for the tone so the card reads
// consistently instead of approving something with a 3% IRR.
const BANDS = {
  approve: { irr: [17, 34], payback: [1.1, 3.2], conf: [74, 96] },
  defer: { irr: [9, 16], payback: [3.4, 6.0], conf: [42, 66] },
  deny: { irr: [-5, 8], payback: [7.5, 14], conf: [8, 34] },
};

export function metricsFor(tone) {
  const b = BANDS[tone] || BANDS.defer;
  return [
    { k: "IRR", v: `${rnd(b.irr[0], b.irr[1]).toFixed(1)}%` },
    { k: "Payback", v: `${rnd(b.payback[0], b.payback[1]).toFixed(1)} yrs` },
    { k: "Confidence", v: `${Math.round(rnd(b.conf[0], b.conf[1]))}%` },
  ];
}

// Weighted tone first, then a line from that tone — avoiding whatever the ball
// said last, so back-to-back shakes never echo.
export function rollAnswer(lastLine) {
  const bag = [];
  for (const t of Object.keys(WEIGHTS)) for (let i = 0; i < WEIGHTS[t]; i++) bag.push(t);

  for (let attempt = 0; attempt < 8; attempt++) {
    const tone = pick(bag);
    const choice = pick(ANSWERS.filter((a) => a.t === tone));
    if (choice.s !== lastLine) {
      return { tone, line: choice.s, metrics: metricsFor(tone), print: pick(FINE_PRINT) };
    }
  }
  const fallback = pick(ANSWERS);
  return {
    tone: fallback.t,
    line: fallback.s,
    metrics: metricsFor(fallback.t),
    print: pick(FINE_PRINT),
  };
}

export const SAMPLE_QUESTIONS = [
  "Should we buy the second aircraft?",
  "Do we replace the fleet trucks this year?",
  "Is it time to upgrade the avionics?",
  "Should we lease or buy the new hangar?",
  "Can the shop equipment wait another year?",
  "Do we fund the ERP upgrade now?",
  "Should we overhaul it or replace it?",
];

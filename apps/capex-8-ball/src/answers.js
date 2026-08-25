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

// The house specials: verdicts that come down from a specific desk instead of
// from the ether. Roughly a quarter of shakes land here (SPECIAL_RATE), and
// the card badges them with `via` so you can see who ruled.
//
// Ground rule for anything added below: every line should be something the
// named person would laugh at, because this deploys to a public URL and they
// will eventually see it. Ribbing, never a real accusation.
export const SPECIAL_RATE = 0.25;

export const SPECIALS = [
  // --- Seth: finds the money -------------------------------------------
  { t: "approve", via: "Seth", s: "Seth found it in another bucket. Go." },
  { t: "approve", via: "Seth", s: "Seth says yes — and he'll act surprised at the review." },
  { t: "approve", via: "Seth", s: "Approved. Seth owes you one and is finally paying up." },
  { t: "approve", via: "Seth", s: "Seth already signed it. Don't make him regret it." },
  { t: "defer", via: "Seth", s: "Seth wants it in writing first. Then yes." },
  { t: "deny", via: "Seth", s: "Seth spent this year's favor on somebody else. Sorry." },

  // --- Kyle: knows a guy ------------------------------------------------
  { t: "approve", via: "Kyle", s: "Kyle knows a guy. The price just dropped." },
  { t: "approve", via: "Kyle", s: "Kyle's pulling it from a job that slipped. Yours now." },
  { t: "approve", via: "Kyle", s: "Kyle says buy it before the price list resets." },
  { t: "approve", via: "Kyle", s: "Kyle green-lit it somewhere between the shop and the airport." },
  { t: "defer", via: "Kyle", s: "Kyle can make this work — after the shutdown." },
  { t: "deny", via: "Kyle", s: "Kyle has one of these in a conex already. Go look." },
  { t: "approve", via: "Seth & Kyle", s: "Seth and Kyle both nodded. That's a quorum." },

  // --- Daren: guards the plan -------------------------------------------
  { t: "deny", via: "Daren", s: "Daren capped the plan. You're over it." },
  { t: "deny", via: "Daren", s: "Not in Daren's budget. Not in Daren's mood." },
  { t: "deny", via: "Daren", s: "Daren wants the old one run one more season." },
  { t: "deny", via: "Daren", s: "Over Daren's threshold — which means corporate, which means no." },
  { t: "defer", via: "Daren", s: "Daren asks what falls off the list to make room." },
  { t: "defer", via: "Daren", s: "Daren wants payback under three years. Sharpen it." },
  { t: "defer", via: "Daren", s: "Daren will look at it in the next planning cycle. He will." },
  { t: "approve", via: "Daren", s: "Daren approved it. Print the email. Frame the email." },

  // --- The rest of the building -----------------------------------------
  { t: "defer", via: "Corporate", s: "Corporate wants it on the five-year plan first." },
  { t: "deny", via: "Corporate", s: "Houston reclassified it. It's OPEX now. Congratulations." },
  { t: "deny", via: "Corporate", s: "Capex is frozen through quarter-end. You know this." },
  { t: "approve", via: "Corporate", s: "It cleared corporate on a technicality. Move quickly." },
  { t: "defer", via: "Houston", s: "Build the AFE deck. Present it in Houston. Then we'll talk." },
  { t: "defer", via: "FP&A", s: "It isn't real until it's in the forecast." },
  { t: "deny", via: "FP&A", s: "FP&A pulled your last three estimates. Bold of you to come back." },
  { t: "defer", via: "The board", s: "Above the threshold. That's a board slide now." },
  { t: "approve", via: "Safety", s: "Safety wants it, so nobody will argue. Buy it." },
  { t: "approve", via: "Maintenance", s: "Maintenance has been asking for this for years. Yes." },
  { t: "deny", via: "Ops", s: "Ops swears they'll make the old one work. They always swear that." },
  { t: "defer", via: "Procurement", s: "Procurement wants three bids. You have zero." },
  { t: "approve", via: "Tax", s: "Bonus depreciation makes this look brilliant. Go." },
  { t: "deny", via: "Treasury", s: "Treasury is watching the cash line. Not this month." },
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
  "No one named here was consulted. They'd tell you the same thing.",
  "The ball is not on the approval matrix. Yet.",
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
//
// The specials roll *inside* the chosen tone rather than replacing it, so
// adding a pile of Daren denials never quietly turns the ball pessimistic:
// the 10/5/5 split holds no matter how the special pools are stocked.
function drawFor(tone) {
  const house = SPECIALS.filter((a) => a.t === tone);
  if (house.length && Math.random() < SPECIAL_RATE) return pick(house);
  return pick(ANSWERS.filter((a) => a.t === tone));
}

export function rollAnswer(lastLine) {
  const bag = [];
  for (const t of Object.keys(WEIGHTS)) for (let i = 0; i < WEIGHTS[t]; i++) bag.push(t);

  let choice = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    choice = drawFor(pick(bag));
    if (choice.s !== lastLine) break;
  }
  return {
    tone: choice.t,
    line: choice.s,
    via: choice.via || null,
    metrics: metricsFor(choice.t),
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

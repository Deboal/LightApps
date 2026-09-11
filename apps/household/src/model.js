// model.js — the money math for the household ledger.
//
// One rule makes everything else fall out: an entry records who paid and how
// many dollars of it each person owed. A settlement is not a special case —
// it is an entry paid by one person and owed 100% by the other, which is
// exactly what handing over cash does to the balance.

export const PEOPLE = [
  { key: "alex", name: "Alex", color: "#33c2b0" },
  { key: "jackie", name: "Jackie", color: "#e08a4a" },
];

export const OTHER = { alex: "jackie", jackie: "alex" };

export const nameOf = (key) => (PEOPLE.find((p) => p.key === key) || {}).name || key;
export const colorOf = (key) => (PEOPLE.find((p) => p.key === key) || {}).color || "#8b97a3";

// Household categories, ordered roughly by how often they come up.
export const CATEGORIES = [
  "Groceries",
  "Dining out",
  "Rent / mortgage",
  "Utilities",
  "Internet / phone",
  "Household supplies",
  "Home maintenance",
  "Transportation",
  "Insurance",
  "Health",
  "Pets",
  "Kids",
  "Entertainment",
  "Travel",
  "Gifts",
  "Other",
];

export const SPLITS = [
  { key: "even", label: "50 / 50" },
  { key: "alex", label: "All Alex" },
  { key: "jackie", label: "All Jackie" },
  { key: "custom", label: "Custom" },
];

export const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (n) => usd.format(cents(n));

// Dollars each person owes on an entry. `custom` is Alex's dollar share; the
// remainder is Jackie's, so a split always adds back to the amount exactly and
// an odd cent can never go missing.
export function sharesFor(amount, mode, custom) {
  const total = cents(amount);
  if (mode === "alex") return { alex: total, jackie: 0 };
  if (mode === "jackie") return { alex: 0, jackie: total };
  if (mode === "custom") {
    const a = Math.min(Math.max(cents(custom), 0), total);
    return { alex: a, jackie: cents(total - a) };
  }
  const a = cents(total / 2);
  return { alex: a, jackie: cents(total - a) };
}

const shareOf = (e) => e.share || sharesFor(e.amount, e.splitMode, e.custom);

// Net position across every entry ever: paid minus owed. A positive net for a
// person means the other one owes them that much.
export function balance(entries) {
  const paid = { alex: 0, jackie: 0 };
  const owed = { alex: 0, jackie: 0 };
  for (const e of entries) {
    const amt = cents(e.amount);
    if (paid[e.paidBy] === undefined) continue;
    paid[e.paidBy] = cents(paid[e.paidBy] + amt);
    const s = shareOf(e);
    owed.alex = cents(owed.alex + (s.alex || 0));
    owed.jackie = cents(owed.jackie + (s.jackie || 0));
  }
  const net = { alex: cents(paid.alex - owed.alex), jackie: cents(paid.jackie - owed.jackie) };
  // Who is owed, and how much. net.alex > 0 => Jackie owes Alex.
  const creditor = net.alex > 0 ? "alex" : net.jackie > 0 ? "jackie" : null;
  return { paid, owed, net, creditor, amount: creditor ? net[creditor] : 0 };
}

export const monthKey = (date) => String(date || "").slice(0, 7);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Labels are built from the string parts, never parsed as a Date — "2026-09-01"
// through a Date constructor lands in August for anyone west of UTC.
export function monthLabel(key) {
  const [y, m] = String(key || "").split("-");
  const i = Number(m) - 1;
  return MONTHS[i] ? `${MONTHS[i]} ${y}` : key;
}

export function dayLabel(date) {
  const [y, m, d] = String(date || "").split("-");
  const i = Number(m) - 1;
  return MONTHS[i] ? `${MONTHS[i].slice(0, 3)} ${Number(d)}, ${y}` : date;
}

export function shiftMonth(key, delta) {
  const [y, m] = String(key).split("-").map(Number);
  const t = (y * 12 + (m - 1)) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const isSettle = (e) => e.kind === "settle";

// What a month cost the household, and who fronted it. Settlements move money
// between the two of us without spending anything, so they are left out.
export function monthSummary(entries, key) {
  const inMonth = entries.filter((e) => monthKey(e.date) === key);
  const spend = inMonth.filter((e) => !isSettle(e));
  const fronted = { alex: 0, jackie: 0 };
  const byCategory = new Map();
  let total = 0;
  for (const e of spend) {
    const amt = cents(e.amount);
    total = cents(total + amt);
    if (fronted[e.paidBy] !== undefined) fronted[e.paidBy] = cents(fronted[e.paidBy] + amt);
    const cat = e.category || "Other";
    byCategory.set(cat, cents((byCategory.get(cat) || 0) + amt));
  }
  return {
    entries: inMonth,
    count: spend.length,
    total,
    fronted,
    byCategory: [...byCategory.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  };
}

// Every month that has activity, newest first, with the current month always
// present so a fresh ledger still has somewhere to put the first entry.
export function monthsWithActivity(entries, current) {
  const keys = new Set(entries.map((e) => monthKey(e.date)).filter(Boolean));
  keys.add(current);
  return [...keys].sort().reverse();
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || "") < (a.createdAt || "") ? -1 : 1;
  });
}

// export.js — the ledger as a spreadsheet.
//
// The standing-balance lines are balance(), the same function the banner
// uses, so the sheet and the screen cannot drift. Expense totals leave
// settle-ups out, the same way a month's "fronted" figure does: handing
// over cash is not spend.

import {
  nameOf, OTHER, SPLITS, cents, sharesFor, balance, isSettle,
  sortEntries, dayLabel, money, todayISO,
} from "./model.js";
import { toXlsx, downloadXlsx } from "./xlsx.js";

function header(text) {
  return { v: text, t: "header" };
}

function moneyCell(n) {
  return { v: cents(n), t: "money" };
}

function splitLabel(mode) {
  const key = mode || "even";
  const hit = SPLITS.find((s) => s.key === key);
  return hit ? hit.label : String(mode || "");
}

function kindOf(entry) {
  return isSettle(entry) ? "settle" : "expense";
}

// Oldest first. The screen lists a month newest-first because that is what
// you just typed; a spreadsheet is a record you read from the top.
function ledgerOrder(entries) {
  return [...entries].sort((a, b) => {
    const da = String(a.date || "");
    const db = String(b.date || "");
    if (da !== db) return da < db ? -1 : 1;
    const ca = a.createdAt || "";
    const cb = b.createdAt || "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    const ia = String(a.id || "");
    const ib = String(b.id || "");
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

function expensesPaid(entries) {
  const paid = { alex: 0, jackie: 0 };
  for (const entry of entries) {
    if (isSettle(entry)) continue;
    if (paid[entry.paidBy] === undefined) continue;
    paid[entry.paidBy] = cents(paid[entry.paidBy] + cents(entry.amount));
  }
  return paid;
}

function ledgerHeaders() {
  return [
    "Date", "Kind", "Description", "Category", "Paid by", "Amount", "Split mode",
    `${nameOf("alex")} share`, `${nameOf("jackie")} share`, "Note",
  ];
}

function ledgerRow(entry) {
  const share = entry.share || sharesFor(entry.amount, entry.splitMode, entry.custom);
  return [
    entry.date ? { v: entry.date, t: "date" } : "",
    kindOf(entry),
    entry.desc || "",
    entry.category || "",
    nameOf(entry.paidBy) || "",
    moneyCell(entry.amount),
    splitLabel(entry.splitMode),
    moneyCell(share.alex || 0),
    moneyCell(share.jackie || 0),
    entry.note || "",
  ];
}

export function ledgerFilename(date = todayISO()) {
  return `household-ledger-${date}.xlsx`;
}

export function ledgerSheets(entries, opts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const asOf = opts.asOf || todayISO();
  const bal = balance(list);
  const spent = expensesPaid(list);
  const owedTo = bal.creditor;
  const status = owedTo ? `${nameOf(OTHER[owedTo])} owes ${nameOf(owedTo)}` : "All square";
  const summary = [
    [header("To-date balance"), ""],
    ["Who owes whom", status],
    ["Amount", moneyCell(bal.amount)],
  ];
  const last = sortEntries(list.filter(isSettle))[0];
  if (last) summary.push(["Last settled", `${dayLabel(last.date)} · ${money(last.amount)}`]);
  summary.push(
    ["Exported", { v: asOf, t: "date" }],
    [],
    [header("Expenses paid, excluding settle-ups"), header("Total paid")],
    [nameOf("alex"), moneyCell(spent.alex)],
    [nameOf("jackie"), moneyCell(spent.jackie)],
    ["Total", moneyCell(cents(spent.alex + spent.jackie))],
  );
  return [
    {
      name: "Ledger",
      freezeHeader: true,
      autoFilter: true,
      widths: [14, 12, 36, 22, 14, 14, 16, 14, 16, 36],
      rows: [ledgerHeaders().map(header), ...ledgerOrder(list).map(ledgerRow)],
    },
    {
      name: "Summary",
      widths: [44, 32],
      rows: summary,
    },
  ];
}

export function ledgerBytes(entries, opts = {}) {
  return toXlsx(ledgerSheets(entries, opts));
}

export function downloadLedger(entries) {
  const asOf = todayISO();
  downloadXlsx(ledgerFilename(asOf), ledgerSheets(entries, { asOf }));
}

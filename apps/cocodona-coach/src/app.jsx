import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { store } from "../../../shared/store.js";
import { AuthGate, signOut } from "../../../shared/auth.js";
import { WEEKS, DAY_ROLES, weekFor, mondayOf, daysToRace, zones, HR, RACE_DATE, TOTAL_TARGET_HOURS } from "./plan.js";
import { weekPlannedHours, PLAN_DAY_COUNT, PLAN_FIRST_DAY, PLAN_LAST_DAY } from "./daily.js";
import { loadLimits, LIMIT_DOCS, HARD_RULES, DEFAULTS } from "./limits.js";
import { advise, VERDICTS } from "./advise.js";
import { SOURCES, STATUS_LABEL, FIELDS, mergeDay } from "./sources.js";

// Cocodona Coach — private training log and next-day recommendation.
//
// Per-user PRIVATE data behind AuthGate. This is the opposite posture from the
// crew app next door: that one is offline and shareable, this one holds health
// data and is signed in.
//
// The engine does not invent coaching. It evaluates the plan's own §8
// autoregulation table against the day's numbers and shows which rules fired.

const db = store("cocodona-coach");
const CHECKINS = "checkins";       // typed by hand; the ingestion job never writes here
const FEED_WHOOP = "feed-whoop";   // written by .github/workflows/ingest-wearables.yml
const FEED_GARMIN = "feed-garmin";
const FEED_STATUS = "feed-status";
const SETTINGS = "settings";

// A feed that quietly stops is worse than one that visibly breaks, because the
// recommendation keeps looking authoritative while running on stale numbers.
const STALE_DAYS = 2;
const staleness = (iso) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400e3) : null;

const C = {
  bg: "#0f1318", panel: "#161c23", panel2: "#1b232b", line: "#2a333d",
  text: "#e7edf2", dim: "#8b97a3", faint: "#5c6670",
  accent: "#33c2b0", warm: "#e0a94d", danger: "#e5604d", good: "#4caf7d", blue: "#4d8fe5",
};
const TONE = { good: C.good, neutral: C.blue, warn: C.warm, bad: C.danger };
const font = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
const mono = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

function Card({ children, style }) {
  return <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>;
}
function Pill({ children, color = C.dim }) {
  return <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
    color, border: `1px solid ${color}55`, borderRadius: 5, padding: "2px 6px", whiteSpace: "nowrap" }}>{children}</span>;
}
function SectionTitle({ children, note }) {
  return (
    <div style={{ margin: "24px 0 12px" }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>{children}</h2>
      {note && <div style={{ fontSize: 12, color: C.dim, marginTop: 4, lineHeight: 1.55 }}>{note}</div>}
    </div>
  );
}
const inputStyle = {
  background: C.bg, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8,
  padding: "9px 11px", fontSize: 15, width: "100%", outline: "none", fontFamily: mono,
};

// ---------------------------------------------------------------------------
// Morning check-in
// ---------------------------------------------------------------------------
function CheckIn({ date, existing, onSave, busy }) {
  const [f, setF] = useState(() => ({
    rhr: "", hrv: "", sleepHrs: "", energy: "", soreness: "",
    pain: "none", illness: "none", lifeLoad: "normal", actualHrs: "", ...(existing || {}),
  }));
  useEffect(() => {
    setF({ rhr: "", hrv: "", sleepHrs: "", energy: "", soreness: "",
           pain: "none", illness: "none", lifeLoad: "normal", actualHrs: "", ...(existing || {}) });
  }, [date, existing]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const num = (v) => (v === "" || v === null ? undefined : Number(v));

  const save = () => onSave({
    date,
    rhr: num(f.rhr), hrv: num(f.hrv), sleepHrs: num(f.sleepHrs),
    energy: num(f.energy), soreness: num(f.soreness), actualHrs: num(f.actualHrs),
    pain: f.pain, illness: f.illness, lifeLoad: f.lifeLoad,
  });

  const fields = [
    { k: "rhr", label: "Resting HR", unit: "bpm", ph: "45" },
    { k: "hrv", label: "HRV", unit: "ms", ph: "—" },
    { k: "sleepHrs", label: "Sleep", unit: "hr", ph: "7.5" },
    { k: "energy", label: "Energy", unit: "/10", ph: "7" },
    { k: "soreness", label: "Soreness", unit: "/5", ph: "2" },
    { k: "actualHrs", label: "Logged yesterday", unit: "hr", ph: "0" },
  ];
  const selects = [
    { k: "pain", label: "Pain", opts: [["none", "None"], ["dull", "Dull ache / niggle"], ["sharp", "Sharp or localized"]] },
    { k: "illness", label: "Illness", opts: [["none", "None"], ["above-neck", "Above the neck"], ["systemic", "Chest / fever / body aches"]] },
    { k: "lifeLoad", label: "Work + life load", opts: [["normal", "Normal"], ["spike", "Spiking"]] },
  ];

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Morning check-in</div>
        {existing && <Pill color={C.good}>SAVED</Pill>}
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 4, lineHeight: 1.55 }}>
        Leave a field blank and the rules that need it simply do not fire — nothing is guessed on your behalf.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(104px,1fr))", gap: 10, marginTop: 14 }}>
        {fields.map((x) => (
          <label key={x.k} style={{ display: "block" }}>
            <div style={{ fontSize: 10, letterSpacing: ".1em", color: C.faint, fontWeight: 700, marginBottom: 4, textTransform: "uppercase" }}>
              {x.label} <span style={{ color: C.line }}>{x.unit}</span>
            </div>
            <input style={inputStyle} inputMode="decimal" placeholder={x.ph} value={f[x.k] ?? ""} onChange={set(x.k)} />
          </label>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 12 }}>
        {selects.map((x) => (
          <label key={x.k} style={{ display: "block" }}>
            <div style={{ fontSize: 10, letterSpacing: ".1em", color: C.faint, fontWeight: 700, marginBottom: 4, textTransform: "uppercase" }}>{x.label}</div>
            <select style={{ ...inputStyle, fontFamily: font }} value={f[x.k]} onChange={set(x.k)}>
              {x.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        ))}
      </div>
      <button onClick={save} disabled={busy} style={{
        marginTop: 14, width: "100%", background: C.accent, color: "#06231f", border: "none",
        borderRadius: 10, padding: "12px 16px", fontWeight: 700, fontSize: 15, cursor: "pointer",
      }}>{busy ? "Saving…" : existing ? "Update check-in" : "Save check-in"}</button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Where today's numbers came from. Shown because a recommendation built partly
// on a scrape and partly on typed values should say which is which.
// ---------------------------------------------------------------------------
const SRC_COLOR = { manual: C.accent, whoop: C.blue, garmin: C.warm };

function Provenance({ reading }) {
  if (!reading) return null;
  const shown = FIELDS.filter((f) => typeof reading[f.key] === "number");
  if (!shown.length) return null;
  const conflicts = reading.conflicts || [];
  const conflicted = new Set(conflicts.map((c) => c.field));
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {shown.map((f) => {
          const src = (reading.source || {})[f.key] || "manual";
          const clash = conflicted.has(f.key);
          return (
            <div key={f.key} style={{ background: C.panel2,
                                      border: `1px solid ${clash ? C.warm + "88" : C.line}`,
                                      borderRadius: 8, padding: "6px 9px", minWidth: 76 }}>
              <div style={{ fontSize: 9.5, letterSpacing: ".08em", color: C.faint, fontWeight: 700,
                            textTransform: "uppercase" }}>{f.label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {reading[f.key]}<span style={{ fontSize: 10, color: C.faint }}> {f.unit}</span>
                {clash && <span style={{ color: C.warm, fontSize: 12 }}> ⚠</span>}
              </div>
              <div style={{ fontSize: 9.5, color: SRC_COLOR[src] || C.faint, fontWeight: 700,
                            textTransform: "uppercase", letterSpacing: ".06em" }}>{src}</div>
            </div>
          );
        })}
      </div>
      {conflicts.length > 0 && (
        <div style={{ background: "#2a1f12", border: `1px solid ${C.warm}55`, borderRadius: 9,
                      padding: "10px 12px", marginTop: 10, fontSize: 12, color: "#f0d9a8", lineHeight: 1.6 }}>
          <b style={{ color: C.warm }}>Sources disagree.</b>{" "}
          {conflicts.map((c) =>
            `${c.label}: kept ${c.kept}${c.unit ? " " + c.unit : ""} from ${c.keptFrom}, ` +
            `${c.otherFrom} said ${c.other}`).join("; ")}.
          {" "}The kept value is what the rules ran on. Worth a look before trusting the verdict —
          a wearable reading you typed over is still a reading.
        </div>
      )}
    </div>
  );
}

function StaleBanner({ feedStatus }) {
  const providers = (feedStatus && feedStatus.providers) || {};
  const problems = Object.entries(providers)
    .filter(([, st]) => st.configured !== false)
    .map(([name, st]) => {
      const age = staleness(st.lastSuccess);
      if (!st.ok) return { name, msg: st.error ? `last run errored: ${st.error}` : "last run errored", st };
      if (age != null && age >= STALE_DAYS) return { name, msg: `no successful sync for ${age} days`, st };
      return null;
    })
    .filter(Boolean);
  if (!problems.length) return null;
  return (
    <div style={{ background: "#2a1f12", border: `1px solid ${C.warm}55`, borderRadius: 10,
                  padding: "11px 13px", marginBottom: 12, fontSize: 12.5, color: "#f0d9a8", lineHeight: 1.6 }}>
      <b style={{ color: C.warm }}>Feed problem.</b>{" "}
      {problems.map((p) => `${p.name} — ${p.msg}`).join("; ")}.
      {" "}Numbers below may be stale or missing. The morning check-in still works and takes priority,
      so nothing is blocked{problems.some((p) => p.st.unofficial)
        ? " — and Garmin has no official API, so it breaks on their schedule, not yours." : "."}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Today
// ---------------------------------------------------------------------------
function Today({ rec, date, setDate, existing, onSave, busy, history, reading, feedStatus }) {
  const tone = TONE[rec.verdictInfo.tone];
  const wk = rec.week;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
               style={{ ...inputStyle, width: "auto", fontSize: 13, padding: "7px 10px" }} />
        <button onClick={() => setDate(todayISO())} style={{
          background: C.panel, border: `1px solid ${C.line}`, color: C.dim, borderRadius: 8,
          padding: "7px 11px", fontSize: 12.5, cursor: "pointer" }}>Today</button>
        <div style={{ marginLeft: "auto", fontSize: 12, color: C.dim, fontFamily: mono }}>
          {daysToRace(date)} days to Cocodona
        </div>
      </div>

      <StaleBanner feedStatus={feedStatus} />

      <Card style={{ borderLeft: `4px solid ${tone}`, background: `linear-gradient(160deg,${tone}12,${C.panel})` }}>
        <div style={{ fontSize: 11, letterSpacing: ".14em", color: C.faint, fontWeight: 700 }}>
          {fmtDate(date).toUpperCase()}
        </div>
        <div style={{ fontSize: 15, fontWeight: 650, color: C.text, marginTop: 3 }}>
          {rec.role.role}
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: tone, marginTop: 6, letterSpacing: "-.02em" }}>
          {rec.verdictInfo.label}
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: ".1em", color: C.faint, fontWeight: 700 }}>SESSION</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {rec.session.hrs === 0 ? "Rest" : rec.session.hrs ? `${rec.session.hrs} hr` : "—"}
            </div>
            <div style={{ fontSize: 11.5, color: C.dim, textTransform: "capitalize" }}>{rec.session.effort}</div>
          </div>
          {rec.plannedHrs != null && rec.session.hrs !== rec.plannedHrs && (
            <div>
              <div style={{ fontSize: 10, letterSpacing: ".1em", color: C.faint, fontWeight: 700 }}>WAS PLANNED</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.dim, textDecoration: "line-through",
                            fontVariantNumeric: "tabular-nums" }}>{rec.plannedHrs} hr</div>
            </div>
          )}
          {wk && (
            <div>
              <div style={{ fontSize: 10, letterSpacing: ".1em", color: C.faint, fontWeight: 700 }}>WEEK {wk.wk}</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {rec.weekActualHrs.toFixed(1)}<span style={{ color: C.faint, fontSize: 14 }}>/{wk.target ?? "—"} hr</span>
              </div>
              <div style={{ fontSize: 11.5, color: C.dim }}>{wk.block}</div>
            </div>
          )}
        </div>
        {rec.session.note && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
            {rec.plan && (
              <div style={{ fontSize: 10, letterSpacing: ".1em", color: C.faint, fontWeight: 700,
                            textTransform: "uppercase", marginBottom: 5 }}>
                From your plan · week {rec.plan.wk} · {rec.plan.block}
              </div>
            )}
            <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.65 }}>{rec.session.note}</div>
          </div>
        )}
        {rec.plannedEstimated && (
          <div style={{ fontSize: 12, color: C.warm, marginTop: 10, lineHeight: 1.6 }}>
            This date is outside the plan window ({PLAN_FIRST_DAY} to {PLAN_LAST_DAY}), so the session
            shown is inferred from the weekly architecture rather than read from the plan.
          </div>
        )}
        <Provenance reading={reading} />
        {!rec.checkedIn && (
          <div style={{ fontSize: 12.5, color: C.warm, marginTop: 12, lineHeight: 1.6 }}>
            Nothing recorded for this date from any source, so only the structural rules could be evaluated.
            Enter the morning numbers below to run the full autoregulation table.
          </div>
        )}
        {rec.checkedIn && reading && !reading.source?.energy && (
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 12, lineHeight: 1.6 }}>
            Wearable data is in, but energy, soreness, pain and load are yours to type — no device measures them,
            and three of the plan's §8 rules depend on them.
          </div>
        )}
      </Card>

      {rec.findings.length > 0 && (
        <>
          <SectionTitle note="Every line traces to a rule in your own plan. Nothing here is the app's opinion.">
            Why
          </SectionTitle>
          <div style={{ display: "grid", gap: 8 }}>
            {rec.findings.map((f, i) => (
              <Card key={i} style={{ borderLeft: `3px solid ${f.hard ? C.danger : TONE[VERDICTS[f.verdict].tone]}`, padding: 13 }}>
                <div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap", alignItems: "baseline" }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{f.rule}</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {f.hard && <Pill color={C.danger}>HARD STOP</Pill>}
                    {f.advisory && <Pill color={C.blue}>HEADS UP</Pill>}
                    {f.interpreted && <Pill color={C.faint}>INTERPRETED</Pill>}
                    <Pill color={C.faint}>{f.source}</Pill>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: C.text, marginTop: 7, lineHeight: 1.6 }}>{f.says}</div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 6, lineHeight: 1.6, fontFamily: mono }}>{f.evidence}</div>
                {f.action === "iron-panel" && (
                  <div style={{ marginTop: 9, background: "#2a1f12", border: `1px solid ${C.warm}55`, borderRadius: 8,
                                padding: "9px 11px", fontSize: 12, color: "#f0d9a8", lineHeight: 1.55 }}>
                    Iron and ferritin are a standing watch item in this plan, not a hypothetical: high volume on top of a
                    prior low-iron history and the iron cost of the Ecuador altitude block. Test before assuming overtraining.
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      {rec.findings.length === 0 && rec.checkedIn && (
        <Card style={{ marginTop: 12, borderLeft: `3px solid ${C.good}` }}>
          <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6 }}>
            No guardrail fired. Numbers are inside your own thresholds and the week is a build week.
            Run the session as written.
          </div>
        </Card>
      )}

      <SectionTitle>{fmtDate(date)}</SectionTitle>
      <CheckIn date={date} existing={existing} onSave={onSave} busy={busy} />

      {wk && (
        <>
          <SectionTitle>This week's focus</SectionTitle>
          <Card>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 9 }}>
              <Pill color={C.accent}>WEEK {wk.wk} OF 48</Pill>
              <Pill color={C.dim}>{wk.wksToRace} WEEKS OUT</Pill>
              {wk.down && <Pill color={wk.mandatoryDown ? C.danger : C.warm}>{wk.mandatoryDown ? "MANDATORY DOWN WEEK" : "DOWN WEEK"}</Pill>}
              {wk.race && <Pill color={C.blue}>RACE WEEK</Pill>}
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>{wk.focus}</div>
            <div style={{ display: "flex", gap: 18, marginTop: 13, flexWrap: "wrap", fontSize: 12.5, color: C.dim }}>
              <span>target <b style={{ color: C.text }}>{wk.target ?? "—"} hr</b></span>
              <span>planned <b style={{ color: C.text }}>{weekPlannedHours(wk.weekOf)} hr</b></span>
              <span>long <b style={{ color: C.text }}>{wk.longHr ?? "—"} hr</b></span>
              <span>B2B <b style={{ color: C.text }}>{wk.b2bHr ?? "—"} hr</b></span>
            </div>
          </Card>
        </>
      )}

      <SectionTitle note="Karvonen, from resting 45 and max 200 as the heat-acclimation notes specify.">
        Heart-rate zones
      </SectionTitle>
      <Card>
        {zones().map((z, i) => (
          <div key={z.name} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0",
                                     borderBottom: i < 4 ? `1px solid ${C.line}` : "none", fontSize: 13 }}>
            <span style={{ color: i === 1 ? C.accent : C.dim, fontWeight: i === 1 ? 700 : 400 }}>{z.name}</span>
            <span style={{ fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>{z.range[0]}–{z.range[1]}</span>
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: C.warm, marginTop: 11, lineHeight: 1.6 }}>
          <b>Unresolved conflict in your own documents.</b> The heat notes set Karvonen at resting 45 / max 200,
          which puts Zone 2 at 138–153. The Brokeoff log instead used an age-predicted max of 184 and called an
          average of 126 bpm "solid Zone 2" — by Karvonen that same 126 is Zone 1. Both readings cannot be right,
          and the gap changes what every easy run should feel like. A tested max would settle it.
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Plan
// ---------------------------------------------------------------------------
function PlanView({ date, history }) {
  const cur = weekFor(date);
  const byWeek = useMemo(() => {
    const m = {};
    for (const h of history) {
      const mo = mondayOf(h.date);
      m[mo] = (m[mo] || 0) + (h.actualHrs || 0);
    }
    return m;
  }, [history]);

  const maxHrs = Math.max(...WEEKS.map((w) => Math.max(w.target || 0, w.planned || 0)));

  return (
    <div>
      <SectionTitle note={`47 training weeks, 7 blocks, ${TOTAL_TARGET_HOURS.toFixed(0)} target hours from June 2026 to race day, across ${PLAN_DAY_COUNT} planned days. Logged hours come from your check-ins.`}>
        The whole plan
      </SectionTitle>
      <div style={{ display: "grid", gap: 3 }}>
        {WEEKS.map((w) => {
          const actual = byWeek[w.weekOf] || 0;
          const isCur = cur && cur.wk === w.wk;
          const past = new Date(w.weekOf) < new Date(mondayOf(date));
          return (
            <div key={w.wk} style={{
              background: isCur ? C.panel2 : C.panel, border: `1px solid ${isCur ? C.accent : C.line}`,
              borderRadius: 8, padding: "9px 11px", opacity: past && !isCur ? 0.62 : 1,
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: C.faint, minWidth: 22 }}>{w.wk}</span>
                <span style={{ fontSize: 12, color: C.dim, fontFamily: mono, minWidth: 74 }}>{w.weekOf}</span>
                <span style={{ fontSize: 12.5, flex: "1 1 120px", color: isCur ? C.text : C.dim }}>{w.block}</span>
                {w.mandatoryDown && <Pill color={C.danger}>MANDATORY</Pill>}
                {w.down && !w.mandatoryDown && <Pill color={C.warm}>DOWN</Pill>}
                <span style={{ fontFamily: mono, fontSize: 12, fontVariantNumeric: "tabular-nums",
                               color: actual > 0 ? C.accent : C.faint, minWidth: 62, textAlign: "right" }}>
                  {actual > 0 ? actual.toFixed(1) : "—"}/{w.target ?? "—"}
                </span>
              </div>
              <div style={{ height: 4, background: C.line, borderRadius: 2, marginTop: 7, overflow: "hidden", display: "flex" }}>
                <div style={{ width: `${((w.target || 0) / maxHrs) * 100}%`, background: C.line + "cc" }} />
              </div>
              <div style={{ height: 4, marginTop: 2, borderRadius: 2, overflow: "hidden", background: "transparent" }}>
                <div style={{ width: `${Math.min(((actual || 0) / maxHrs) * 100, 100)}%`, height: "100%",
                              background: actual > (w.target || Infinity) ? C.warm : C.accent, borderRadius: 2 }} />
              </div>
              {isCur && <div style={{ fontSize: 12.5, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>{w.focus}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 12, lineHeight: 1.6 }}>
        The grey bar is the week's target; the teal bar is what you logged. Teal turning amber means you went past
        the ceiling, which the plan treats as a miss in the same way as coming up short.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Limits
// ---------------------------------------------------------------------------
function LimitsView({ limits, setLimits }) {
  const set = (k) => (e) => {
    const v = e.target.value;
    setLimits({ ...limits, [k]: v === "" ? DEFAULTS[k] : Number(v) });
  };
  const dirty = Object.keys(DEFAULTS).some((k) => limits[k] !== DEFAULTS[k]);

  return (
    <div>
      <SectionTitle note="These are your plan's numbers, not the app's. Section 8 is already a rule table; this is that table made executable. Change a threshold and the recommendation recomputes.">
        Limits and guardrails
      </SectionTitle>

      {dirty && (
        <Card style={{ marginBottom: 12, borderLeft: `3px solid ${C.warm}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: C.dim }}>Some thresholds differ from the plan's defaults.</span>
            <button onClick={() => setLimits({ ...DEFAULTS })} style={{
              background: "none", border: `1px solid ${C.line}`, color: C.warm, borderRadius: 8,
              padding: "6px 11px", fontSize: 12.5, cursor: "pointer" }}>Reset to plan defaults</button>
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gap: 9 }}>
        {LIMIT_DOCS.map((d) => (
          <Card key={d.key} style={{ padding: 13 }}>
            <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 190px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 650 }}>{d.label}</div>
                <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                  <Pill color={C.faint}>{d.source}</Pill>
                  {d.interpreted && <Pill color={C.warm}>INTERPRETED</Pill>}
                  {limits[d.key] !== DEFAULTS[d.key] && <Pill color={C.blue}>CHANGED</Pill>}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <input value={limits[d.key]} onChange={set(d.key)} inputMode="decimal"
                       style={{ ...inputStyle, width: 72, textAlign: "right", padding: "7px 9px" }} />
                <span style={{ fontSize: 12, color: C.faint, minWidth: 26 }}>{d.unit}</span>
              </div>
            </div>
            {d.verbatim && (
              <div style={{ fontSize: 12, color: C.dim, marginTop: 9, lineHeight: 1.6, paddingLeft: 10,
                            borderLeft: `2px solid ${C.line}`, fontStyle: "italic" }}>
                "{d.verbatim}"
              </div>
            )}
          </Card>
        ))}
      </div>

      <SectionTitle note="Not thresholds. These cannot be tuned, and a good number elsewhere will not override them.">
        Hard stops
      </SectionTitle>
      <div style={{ display: "grid", gap: 8 }}>
        {HARD_RULES.map((r) => (
          <Card key={r.id} style={{ borderLeft: `3px solid ${C.danger}`, padding: 13 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.label}</div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 5, lineHeight: 1.6 }}>{r.verbatim}</div>
          </Card>
        ))}
        <Card style={{ padding: 13, borderLeft: `3px solid ${C.danger}` }}>
          <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.65 }}>
            <b style={{ color: C.text }}>Why hard stops are structural here.</b> The race plan records that quitting
            is not in your mental framework — only failure from physical incapacitation or disqualification. That
            eliminates the most common DNF cause and removes the internal safety valve at the same time. Pre-committed
            objective criteria are the replacement, in training as much as on course.
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Feeds
// ---------------------------------------------------------------------------
function Feeds({ feedStatus, feeds }) {
  const baseColor = { live: C.good, "available-not-wired": C.warm, "unofficial-only": C.danger };
  const providers = (feedStatus && feedStatus.providers) || {};

  // Live status from the ingestion job overrides the static description. Before
  // the job has ever run there is nothing to override with, which is itself the
  // honest answer.
  const liveFor = (id) => {
    const st = providers[id];
    if (!st || st.configured === false) return null;
    const age = staleness(st.lastSuccess);
    return {
      ok: !!st.ok, error: st.error, days: st.days, age,
      stale: age != null && age >= STALE_DAYS,
      label: st.ok ? (age === 0 ? "Synced today" : age === 1 ? "Synced yesterday" : `Synced ${age} days ago`)
                   : "Last run failed",
    };
  };

  return (
    <div>
      <SectionTitle note="What the recommendation reads from, and the live state of each feed.">
        Data sources
      </SectionTitle>

      {feedStatus && feedStatus.ranAt && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.6 }}>
            Ingestion job last ran <b style={{ color: C.text }}>{new Date(feedStatus.ranAt).toLocaleString()}</b>
            {feedStatus.window && <> over {feedStatus.window.from} to {feedStatus.window.to}</>}.
            {" "}Rows held: {Object.keys(feeds.whoop || {}).length} WHOOP, {Object.keys(feeds.garmin || {}).length} Garmin.
          </div>
        </Card>
      )}
      {!feedStatus && (
        <Card style={{ marginBottom: 12, borderLeft: `3px solid ${C.warm}` }}>
          <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.65 }}>
            <b style={{ color: C.warm }}>The ingestion job has never reported in.</b> Either it has not run yet or
            the secrets are not set. See <span style={{ fontFamily: mono }}>ingest/README.md</span> for the one-time
            setup. The morning check-in works regardless.
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {SOURCES.map((s) => {
          const live = liveFor(s.id);
          const color = live ? (live.ok && !live.stale ? C.good : live.ok ? C.warm : C.danger)
                             : baseColor[s.status];
          return (
            <Card key={s.id} style={{ borderLeft: `3px solid ${color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{s.label}</div>
                <Pill color={color}>{live ? live.label : STATUS_LABEL[s.status]}</Pill>
              </div>
              {live && live.ok && (
                <div style={{ fontSize: 12, color: C.dim, marginTop: 7, fontFamily: mono }}>
                  {live.days} day(s) written on the last run
                </div>
              )}
              {live && !live.ok && (
                <div style={{ fontSize: 12, color: C.danger, marginTop: 7, lineHeight: 1.6, fontFamily: mono,
                              wordBreak: "break-word" }}>
                  {live.error || "no error recorded"}
                </div>
              )}
              <div style={{ fontSize: 13, color: C.dim, marginTop: 8, lineHeight: 1.65 }}>{s.detail}</div>
              {s.blockedBy && !live && (
                <div style={{ fontSize: 12, color: baseColor[s.status], marginTop: 9, lineHeight: 1.6 }}>
                  <b>Next step:</b> {s.blockedBy}
                </div>
              )}
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>
                {s.provides.map((p) => {
                  const f = FIELDS.find((x) => x.key === p);
                  return <Pill key={p} color={C.faint}>{f ? f.label : p}</Pill>;
                })}
              </div>
            </Card>
          );
        })}
      </div>

      <SectionTitle>How this works</SectionTitle>
      <Card>
        <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.7 }}>
          This app is a static bundle on Netlify: no server to hold an OAuth secret, no scheduler, no browser to
          automate. So a scheduled GitHub Action (<span style={{ fontFamily: mono }}>ingest-wearables.yml</span>)
          runs daily at 06:10 Arizona time, refreshes WHOOP on its documented API, attempts the Garmin scrape, and
          writes both into separate feed collections here.
        </div>
        <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.7, marginTop: 11 }}>
          Your typed check-ins live in their own collection and are never written by the job.
          <b style={{ color: C.text }}> Manual values win every field they supply</b>, so a scrape can fill in what
          you did not type but can never overwrite what you did. A Garmin break costs one field, not the
          recommendation.
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
const TABS = [
  { id: "today", label: "Today" },
  { id: "plan", label: "Plan" },
  { id: "limits", label: "Limits" },
  { id: "feeds", label: "Feeds" },
];

function Coach({ user }) {
  const [tab, setTab] = useState("today");
  const [date, setDate] = useState(todayISO);
  const [manual, setManual] = useState([]);
  const [feeds, setFeeds] = useState({ whoop: {}, garmin: {} });
  const [feedStatus, setFeedStatus] = useState(null);
  const [limits, setLimits] = useState(() => loadLimits());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // Feeds are additive: a missing or empty feed collection is normal before
        // the ingestion job has ever run, and must not break the page.
        const [rows, w, g, st, s] = await Promise.all([
          db.list(CHECKINS),
          db.list(FEED_WHOOP).catch(() => []),
          db.list(FEED_GARMIN).catch(() => []),
          db.get(FEED_STATUS, "status").catch(() => null),
          db.get(SETTINGS, "limits"),
        ]);
        setManual(rows.filter((r) => r.date).sort((a, b) => a.date.localeCompare(b.date)));
        const byDate = (arr) => Object.fromEntries((arr || []).filter((r) => r.date).map((r) => [r.date, r]));
        setFeeds({ whoop: byDate(w), garmin: byDate(g) });
        setFeedStatus(st);
        if (s) setLimits(loadLimits(s));
      } catch (e) { setErr(e.message || String(e)); }
      setLoading(false);
    })();
  }, []);

  // One reading per day, merged across all three sources. Manual wins every
  // field it supplies — see mergeDay's priority order. A scrape can add what you
  // did not type but can never overwrite what you did.
  const history = useMemo(() => {
    const manualByDate = Object.fromEntries(manual.map((m) => [m.date, m]));
    const dates = [...new Set([
      ...Object.keys(manualByDate), ...Object.keys(feeds.whoop), ...Object.keys(feeds.garmin),
    ])].sort();
    return dates.map((d) => ({
      date: d,
      ...mergeDay({ manual: manualByDate[d], whoop: feeds.whoop[d], garmin: feeds.garmin[d] }),
    }));
  }, [manual, feeds]);

  const saveLimits = async (next) => {
    setLimits(next);
    const { id, ...clean } = next;
    try { await db.set(SETTINGS, clean, "limits"); } catch (e) { setErr(e.message || String(e)); }
  };

  const saveCheckIn = async (entry) => {
    setBusy(true); setErr(null);
    try {
      await db.set(CHECKINS, entry, entry.date); // one row per day, keyed by date
      setManual((h) => {
        const rest = h.filter((x) => x.date !== entry.date);
        return [...rest, { id: entry.date, ...entry }].sort((a, b) => a.date.localeCompare(b.date));
      });
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  // Only history up to and including the selected date feeds the engine, so
  // looking back at a past day shows what would have been advised then, not a
  // verdict contaminated by data recorded afterwards.
  const upto = useMemo(() => history.filter((h) => h.date <= date), [history, date]);
  // The form edits MANUAL data only. Prefilling it from a feed would turn scraped
  // values into typed ones on the next save and destroy the provenance.
  const existing = manual.find((h) => h.date === date);
  const reading = history.find((h) => h.date === date);
  const weekActualHrs = useMemo(() => {
    const mo = mondayOf(date);
    return history.filter((h) => mondayOf(h.date) === mo && h.date <= date)
                  .reduce((a, h) => a + (h.actualHrs || 0), 0);
  }, [history, date]);

  const rec = useMemo(() => advise({ date, history: upto, limits, weekActualHrs }),
                      [date, upto, limits, weekActualHrs]);

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.text, fontFamily: font }}>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: C.bg + "f2", backdropFilter: "blur(8px)",
                    borderBottom: `1px solid ${C.line}`, paddingTop: "env(safe-area-inset-top)" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "10px 16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: ".2em", color: C.accent, fontWeight: 700 }}>COCODONA COACH</div>
            <button onClick={signOut} style={{ background: "none", border: "none", color: C.faint,
                                               fontSize: 11.5, cursor: "pointer" }}>Sign out</button>
          </div>
          <div style={{ display: "flex", gap: 3, overflowX: "auto", marginTop: 8 }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                background: "none", border: "none", cursor: "pointer",
                color: tab === t.id ? C.accent : C.dim, fontSize: 13.5,
                fontWeight: tab === t.id ? 700 : 500, padding: "8px 11px",
                borderBottom: `2px solid ${tab === t.id ? C.accent : "transparent"}`, whiteSpace: "nowrap",
              }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "16px 16px calc(48px + env(safe-area-inset-bottom))" }}>
        {err && (
          <div style={{ background: "#2b1614", border: `1px solid ${C.danger}`, borderRadius: 10, padding: 12,
                        fontSize: 12.5, color: "#f4bdb4", marginBottom: 12 }}>{err}</div>
        )}
        {loading ? (
          <div style={{ color: C.dim, padding: 24, textAlign: "center" }}>Loading…</div>
        ) : (
          <>
            {tab === "today" && <Today rec={rec} date={date} setDate={setDate} existing={existing}
                                       onSave={saveCheckIn} busy={busy} history={upto}
                                       reading={reading} feedStatus={feedStatus} />}
            {tab === "plan" && <PlanView date={date} history={history} />}
            {tab === "limits" && <LimitsView limits={limits} setLimits={saveLimits} />}
            {tab === "feeds" && <Feeds feedStatus={feedStatus} feeds={feeds} />}
          </>
        )}
        <div style={{ marginTop: 34, paddingTop: 14, borderTop: `1px solid ${C.line}`,
                      fontSize: 11.5, color: C.faint, lineHeight: 1.7 }}>
          Private to {user.email}. Recommendations evaluate your plan's own §8 autoregulation table — they are not
          medical advice, and the hard stops exist because they are the ones most easily talked out of.
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <AuthGate>{(user) => <Coach user={user} />}</AuthGate>
);

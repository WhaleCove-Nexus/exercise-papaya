import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  addDays,
  copayText,
  formatDate,
  formatMoney,
  limitEntries,
  limitLabel,
  summarize,
  titleCase,
  waitingPeriods,
} from "../src/lib.js";

const data = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const acme = JSON.parse(readFileSync(join(data, "policy-acme.json"), "utf8"));
const family = JSON.parse(readFileSync(join(data, "policy-family.json"), "utf8"));

test("formatMoney renders symbol + thousand separators", () => {
  assert.equal(formatMoney(2000000, "THB"), "฿2,000,000");
  assert.equal(formatMoney(1500, "USD"), "$1,500");
});

test("formatDate renders readable dates", () => {
  assert.equal(formatDate("2024-01-01"), "1 Jan 2024");
});

test("limitLabel humanizes limit keys", () => {
  assert.equal(limitLabel("limit_per_day"), "per day");
  assert.equal(limitLabel("visits_per_year"), "visits per year");
  assert.equal(limitLabel("max_days"), "max days");
});

test("limitEntries picks up arbitrary limit keys", () => {
  const entries = limitEntries(
    { name: "ICU", limit_per_day: 16000, max_days: 30 },
    "THB"
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, "฿16,000 per day");
  assert.equal(entries[1].text, "30 max days");
  // non-numeric fields are skipped
  assert.equal(limitEntries({ name: "X", note: "hi" }, "THB").length, 0);
});

test("limitEntries can skip already-rendered keys", () => {
  const e = limitEntries({ annual_limit: 100, waiting_period_days: 90 }, "THB", ["annual_limit", "waiting_period_days"]);
  assert.equal(e.length, 0);
});

test("copayText handles percentage, caps, and fixed shapes", () => {
  assert.equal(copayText({ percentage: 20, max_per_visit: 500 }, "THB"), "20% · max ฿500/visit");
  assert.equal(copayText({ percentage: 0 }, "THB"), "0%");
  assert.equal(copayText({ fixed_per_visit: 100 }, "USD"), "$100 per visit");
});

test("summarize aggregates across benefit types", () => {
  const s = summarize(acme);
  assert.equal(s.totalAnnual, 2000000 + 100000 + 30000); // lifetime_limit excluded
  assert.equal(s.benefitCount, 4);
  assert.equal(s.memberTotal, 250);
  assert.equal(s.hospitals, 450);
  assert.deepEqual(s.lifetimeLimits, [{ type: "MATERNITY", limit: 200000 }]);
});

test("summarize works on the second policy shape", () => {
  const s = summarize(family);
  assert.equal(s.totalAnnual, 250000 + 5000 + 20000 + 800);
  assert.equal(s.lifetimeLimits.length, 0);
});

test("waitingPeriods extracts benefits with waits + end dates", () => {
  const w = waitingPeriods(acme);
  assert.deepEqual(
    w.map((x) => [x.type, x.days]),
    [["DENTAL", 90], ["MATERNITY", 270]]
  );
  assert.equal(w[0].until, addDays("2024-01-01", 90));
  assert.equal(w[0].until, "2024-03-31");
});

test("waitingPeriods returns empty when none apply", () => {
  const p = { plan: { effective_date: "2025-01-01" }, benefits: [{ type: "X" }] };
  assert.equal(waitingPeriods(p).length, 0);
});

test("titleCase formats enum-ish strings", () => {
  assert.equal(titleCase("INPATIENT"), "Inpatient");
  assert.equal(titleCase("PREFERRED_PROVIDER"), "Preferred Provider");
});

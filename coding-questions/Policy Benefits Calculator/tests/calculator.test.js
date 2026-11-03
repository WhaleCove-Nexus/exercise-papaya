/**
 * Unit tests for the benefits calculator (Node.js port).
 * Expected numbers are hand-computed from data/policy.json + data/expenses.json.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { processExpenses } from "../src/calculator.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const policy = JSON.parse(readFileSync(join(DATA, "policy.json"), "utf8"));
const expenses = JSON.parse(readFileSync(join(DATA, "expenses.json"), "utf8"));

const output = processExpenses(policy, expenses);
const results = Object.fromEntries(output.results.map((r) => [r.expense_id, r]));

test("deductible fully absorbs a small expense", () => {
  const r = results["EXP-001"]; // 800 < 2000 deductible
  assert.equal(r.decision, "DENIED");
  assert.equal(r.covered_amount, 0);
  assert.equal(r.member_pays, 800);
  assert.match(r.reason, /deductible/);
});

test("deductible remainder then percent copay", () => {
  const r = results["EXP-002"]; // 1800: 1200 deductible, 600 eligible, 20% copay
  assert.equal(r.decision, "PARTIALLY_COVERED");
  assert.equal(r.covered_amount, 480);
  assert.equal(r.copay_amount, 120);
  assert.equal(r.member_pays, 1320);
});

test("waiting period denial", () => {
  const r = results["EXP-003"]; // dental 2024-01-20, waiting until 2024-03-31
  assert.equal(r.decision, "DENIED");
  assert.match(r.reason, /waiting period/);
  assert.match(r.reason, /2024-03-31/);
});

test("same benefit is covered after the waiting period ends", () => {
  const r = results["EXP-020"]; // maternity 2024-10-15, after 2024-09-27
  assert.equal(r.decision, "FULLY_COVERED"); // 0% copay
  assert.equal(r.covered_amount, 5000);
});

test("exclusion denial", () => {
  const r = results["EXP-009"]; // dental whitening excluded
  assert.equal(r.decision, "DENIED");
  assert.match(r.reason, /whitening/);
});

test("uncovered benefit type", () => {
  const r = results["EXP-013"]; // VISION not in policy
  assert.equal(r.decision, "DENIED");
  assert.match(r.reason, /not a covered benefit/);
});

test("percent copay on a normal expense", () => {
  const r = results["EXP-004"]; // 2500, deductible already met
  assert.equal(r.covered_amount, 2000);
  assert.equal(r.copay_amount, 500);
  assert.equal(r.member_pays, 500);
});

test("fixed copay", () => {
  const r = results["EXP-010"]; // dental filling 2000, fixed copay 300
  assert.equal(r.covered_amount, 1700);
  assert.equal(r.copay_amount, 300);
});

test("sub-benefit per-visit amount cap", () => {
  const r = results["EXP-006"]; // physio 2000 capped at 1500, then 20% copay
  assert.equal(r.covered_amount, 1200);
  assert.match(r.reason, /per-visit limit/);
});

test("benefit-level per-visit cap", () => {
  const r = results["EXP-016"]; // 4000 capped at benefit-level 3000
  assert.equal(r.covered_amount, 2400);
});

test("visit count limit", () => {
  const r = results["EXP-017"]; // 7th Doctor Visit, limit is 6
  assert.equal(r.decision, "DENIED");
  assert.match(r.reason, /visit limit/);
  assert.equal(r.remaining_visit_limit, 0);
});

test("remaining annual limit partially covers, next claim denied", () => {
  const r = results["EXP-018"]; // MEDICATION: 2000 limit, 900 used -> 1100 left
  assert.equal(r.decision, "PARTIALLY_COVERED");
  assert.equal(r.covered_amount, 1100);
  assert.equal(r.remaining_annual_limit, 0);
  const r2 = results["EXP-019"];
  assert.equal(r2.decision, "DENIED");
  assert.match(r2.reason, /annual limit exhausted/);
});

test("expenses are processed chronologically, not in input order", () => {
  const out2 = processExpenses(policy, [...expenses].reverse());
  const r = out2.results.find((x) => x.expense_id === "EXP-001");
  assert.equal(r.covered_amount, 0); // still takes the deductible hit
});

test("summary aggregates per benefit", () => {
  const s = output.summary;
  assert.equal(s.OUTPATIENT.annual_used, 13280);
  assert.equal(s.OUTPATIENT.annual_remaining, 1720);
  assert.equal(s.OUTPATIENT.deductible_remaining, 0);
  assert.equal(s.OUTPATIENT.visit_limits["Doctor Visit"].used, 6);
  assert.equal(s.MEDICATION.annual_remaining, 0);
  assert.equal(s.INPATIENT.annual_remaining, 320000);
});

test("inpatient large claim", () => {
  const r = results["EXP-005"]; // 200k appendectomy, 10% copay
  assert.equal(r.covered_amount, 180000);
  assert.equal(r.member_pays, 20000);
});

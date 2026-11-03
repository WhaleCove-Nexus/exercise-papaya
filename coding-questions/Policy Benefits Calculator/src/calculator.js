/**
 * Policy benefits calculator (Node.js port).
 *
 * Reusable module: given a policy definition and a list of medical expenses,
 * decide per expense what the insurer covers, what the member pays, and why.
 *
 * Rule order per expense (short-circuits on the first DENIED):
 *   1. benefit type must exist in the policy          -> DENIED "not covered"
 *   2. exclusion keyword (sub_benefit or diagnosis)    -> DENIED
 *   3. waiting period (coverage_start + N days)        -> DENIED
 *   4. annual visit-count limit for the sub_benefit    -> DENIED
 *   5. deductible: member pays it down first; a fully-absorbed expense is
 *      DENIED but still consumes the deductible (real out-of-pocket spend)
 *   6. caps: benefit-level per_visit_limit, sub-benefit per_visit_amount
 *   7. remaining annual limit for the benefit type
 *   8. copay (percent or fixed) on the eligible remainder
 *
 * Annual limits are consumed by covered_amount (what the insurer pays);
 * visit counts only increment when the insurer pays something.
 */

export const FULLY_COVERED = "FULLY_COVERED";
export const PARTIALLY_COVERED = "PARTIALLY_COVERED";
export const DENIED = "DENIED";

const round2 = (n) => Math.round(n * 100) / 100;

const money = (policy, amount) =>
  `${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${policy.currency}`;

function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function exclusionHit(benefit, expense) {
  const hay = `${expense.sub_benefit ?? ""} ${expense.diagnosis ?? ""}`.toLowerCase();
  return (benefit.exclusions ?? []).find((k) => hay.includes(k.toLowerCase())) ?? null;
}

function perVisitCap(benefit, subBenefit) {
  const caps = [
    benefit.per_visit_limit,
    benefit.sub_limits?.[subBenefit]?.per_visit_amount,
  ].filter((c) => c != null);
  return caps.length ? Math.min(...caps) : null;
}

function initialState(policy) {
  const state = {};
  for (const btype of Object.keys(policy.benefits)) {
    state[btype] = { annual_used: 0, deductible_used: 0, visits: {} };
  }
  return state;
}

function processOne(policy, state, expense) {
  const cur = policy.currency;
  const btype = expense.benefit_type;
  const sub = expense.sub_benefit ?? "";
  const amount = Number(expense.amount);
  const reasons = [];

  const result = {
    expense_id: expense.expense_id,
    benefit_type: btype,
    submitted_amount: amount,
    covered_amount: 0,
    copay_amount: 0,
    member_pays: amount,
    decision: DENIED,
    reason: "",
    remaining_annual_limit: null,
    remaining_visit_limit: null,
  };

  let benefit = null;
  let st = null;
  const deny = (reason) => {
    if (benefit != null) {
      result.remaining_annual_limit = round2(benefit.annual_limit - st.annual_used);
    }
    result.reason = [...reasons, reason].join("; ");
    return result;
  };

  benefit = policy.benefits[btype];
  if (benefit == null) {
    return deny(`${btype} is not a covered benefit under ${policy.plan_name}`);
  }
  st = state[btype];

  const keyword = exclusionHit(benefit, expense);
  if (keyword) {
    return deny(`denied: '${keyword}' is on the ${btype} exclusion list`);
  }

  const waitingDays = benefit.waiting_period_days ?? 0;
  if (waitingDays) {
    const waitUntil = addDays(policy.coverage_start, waitingDays);
    if (expense.date < waitUntil) {
      return deny(
        `denied: ${btype} is in waiting period until ${waitUntil} ` +
          `(${waitingDays} days from ${policy.coverage_start})`
      );
    }
  }

  const visitLimit = benefit.sub_limits?.[sub]?.visit_count_limit ?? null;
  const visitsUsed = st.visits[sub] ?? 0;
  if (visitLimit != null) {
    result.remaining_visit_limit = Math.max(visitLimit - visitsUsed, 0);
    if (visitsUsed >= visitLimit) {
      return deny(
        `denied: annual visit limit for '${sub}' reached ` +
          `(${visitsUsed}/${visitLimit} visits used)`
      );
    }
  }

  const deductible = benefit.deductible ?? 0;
  const dedRemaining = Math.max(deductible - st.deductible_used, 0);
  const dedApplied = Math.min(amount, dedRemaining);
  st.deductible_used += dedApplied;
  let eligible = amount - dedApplied;
  if (dedApplied) {
    reasons.push(
      `${money(policy, dedApplied)} applied to ${btype} deductible ` +
        `(${money(policy, deductible)}/yr)`
    );
  }
  if (eligible <= 0) {
    return deny(`denied: ${money(policy, amount)} fully absorbed by deductible`);
  }

  const cap = perVisitCap(benefit, sub);
  if (cap != null && eligible > cap) {
    reasons.push(
      `per-visit limit capped eligible at ${money(policy, cap)} ` +
        `(submitted ${money(policy, amount)})`
    );
    eligible = cap;
  }

  const annualRemaining = benefit.annual_limit - st.annual_used;
  if (annualRemaining <= 0) {
    return deny(`denied: ${btype} annual limit exhausted (0 ${cur} remaining)`);
  }
  if (eligible > annualRemaining) {
    reasons.push(
      `annual limit nearly exhausted: eligible reduced to ` +
        `${money(policy, annualRemaining)} remaining`
    );
    eligible = annualRemaining;
  }

  const copay = benefit.copay ?? { type: "percent", value: 0 };
  let copayAmount;
  if (copay.type === "percent") {
    copayAmount = (eligible * copay.value) / 100;
    if (copay.value) reasons.push(`${copay.value}% copay applied`);
  } else {
    copayAmount = Math.min(copay.value, eligible);
    if (copay.value) reasons.push(`fixed copay ${money(policy, copayAmount)} applied`);
  }
  const covered = round2(eligible - copayAmount);
  if (covered <= 0) {
    return deny(
      `denied: nothing payable - ${money(policy, eligible)} eligible is ` +
        `fully consumed by copay`
    );
  }

  st.annual_used += covered;
  st.visits[sub] = visitsUsed + 1;

  result.covered_amount = covered;
  result.copay_amount = round2(copayAmount);
  result.member_pays = round2(amount - covered);
  result.decision = covered === amount ? FULLY_COVERED : PARTIALLY_COVERED;
  result.remaining_annual_limit = round2(benefit.annual_limit - st.annual_used);
  if (visitLimit != null) {
    result.remaining_visit_limit = visitLimit - st.visits[sub];
  }
  reasons.push(
    `covered ${money(policy, covered)}, member pays ${money(policy, result.member_pays)}`
  );
  result.reason = reasons.join("; ");
  return result;
}

function summarize(policy, state) {
  const out = {};
  for (const [btype, benefit] of Object.entries(policy.benefits)) {
    const st = state[btype];
    const visitLimits = {};
    for (const [sub, rules] of Object.entries(benefit.sub_limits ?? {})) {
      if ("visit_count_limit" in rules) {
        visitLimits[sub] = {
          limit: rules.visit_count_limit,
          used: st.visits[sub] ?? 0,
          remaining: rules.visit_count_limit - (st.visits[sub] ?? 0),
        };
      }
    }
    out[btype] = {
      annual_limit: benefit.annual_limit,
      annual_used: round2(st.annual_used),
      annual_remaining: round2(benefit.annual_limit - st.annual_used),
      deductible_remaining: round2(Math.max((benefit.deductible ?? 0) - st.deductible_used, 0)),
      visit_limits: visitLimits,
    };
  }
  return out;
}

/**
 * Process expenses chronologically; earlier claims consume limits that
 * affect later ones. Returns per-expense decisions plus a benefit summary.
 */
export function processExpenses(policy, expenses) {
  const state = initialState(policy);
  const ordered = [...expenses].sort(
    (a, b) => a.date.localeCompare(b.date) || a.expense_id.localeCompare(b.expense_id)
  );
  return {
    policy_id: policy.policy_id,
    currency: policy.currency,
    results: ordered.map((e) => processOne(policy, state, e)),
    summary: summarize(policy, state),
  };
}

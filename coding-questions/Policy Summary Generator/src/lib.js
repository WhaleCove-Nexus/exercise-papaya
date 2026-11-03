/**
 * Pure helpers for the policy summary generator.
 * No DOM access here so everything is unit-testable with `node --test`.
 */

const LOCALE_BY_CURRENCY = { THB: "th-TH", USD: "en-US", VND: "vi-VN", SGD: "en-SG" };

export function formatMoney(amount, currency) {
  const locale = LOCALE_BY_CURRENCY[currency] ?? "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function titleCase(s) {
  return String(s)
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Human label for a limit-ish key: "limit_per_day" -> "per day",
 * "visits_per_year" -> "visits per year", "annual_limit" -> "annual limit".
 */
export function limitLabel(key) {
  return key.replace(/^limit_/, "").replace(/_/g, " ");
}

/** Keys that hold money values vs. plain counts. */
function isMoneyKey(key) {
  return /limit|amount|^fixed/.test(key);
}

/**
 * Turn a benefit/sub-benefit object into [{label, text}] render entries.
 * Handles any limit key shape (per_day, per_event, per_visit, per_year,
 * per_pregnancy, visits_per_year, max_days, lifetime_limit, ...).
 */
export function limitEntries(obj, currency, skip = []) {
  const entries = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "number" || skip.includes(key)) continue;
    const text = isMoneyKey(key)
      ? `${formatMoney(value, currency)} ${limitLabel(key)}`.replace("  ", " ")
      : `${value} ${limitLabel(key)}`;
    entries.push({ key, label: limitLabel(key), text });
  }
  return entries;
}

/** Copay entry -> readable string, tolerant of different shapes. */
export function copayText(entry, currency) {
  const parts = [];
  if (entry.percentage != null) parts.push(`${entry.percentage}%`);
  if (entry.fixed_per_visit != null) parts.push(`${formatMoney(entry.fixed_per_visit, currency)} per visit`);
  if (entry.fixed_amount != null) parts.push(`${formatMoney(entry.fixed_amount, currency)}`);
  if (entry.max_per_visit != null) parts.push(`max ${formatMoney(entry.max_per_visit, currency)}/visit`);
  if (entry.max_per_year != null) parts.push(`max ${formatMoney(entry.max_per_year, currency)}/year`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Aggregate numbers for the quick-reference card. */
export function summarize(policy) {
  const benefits = policy.benefits ?? [];
  return {
    totalAnnual: benefits.reduce((sum, b) => sum + (b.annual_limit ?? 0), 0),
    lifetimeLimits: benefits
      .filter((b) => b.lifetime_limit != null)
      .map((b) => ({ type: b.type, limit: b.lifetime_limit })),
    benefitCount: benefits.length,
    memberTotal: policy.members?.total ?? null,
    hospitals: policy.network?.hospital_count ?? null,
    copayCount: Object.keys(policy.copay ?? {}).length,
  };
}

/** [{type, days, until}] for benefits carrying a waiting period. */
export function waitingPeriods(policy) {
  return (policy.benefits ?? [])
    .filter((b) => b.waiting_period_days)
    .map((b) => ({
      type: b.type,
      days: b.waiting_period_days,
      until: addDays(policy.plan.effective_date, b.waiting_period_days),
    }));
}

export function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Escape pasted-JSON strings before they hit innerHTML. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

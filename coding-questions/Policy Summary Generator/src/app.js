import {
  copayText,
  esc,
  formatDate,
  formatMoney,
  limitEntries,
  summarize,
  titleCase,
  waitingPeriods,
} from "./lib.js";

const POLICIES = [
  { id: "policy-acme", label: "Acme Corporation — Corporate Health Plus (THB)" },
  { id: "policy-family", label: "Nguyen Family — Family Shield (USD)" },
];

const $ = (sel) => document.querySelector(sel);

async function loadPolicy(id) {
  const res = await fetch(`data/${id}.json`);
  if (!res.ok) throw new Error(`failed to load ${id}: ${res.status}`);
  return res.json();
}

function chipList(items) {
  return items.map((i) => `<span class="chip">${esc(i)}</span>`).join("");
}

function render(policy) {
  const cur = policy.plan.currency;
  const s = summarize(policy);
  const waits = waitingPeriods(policy);

  const quickCard = `
    <section class="quickref">
      <h2>Quick Reference</h2>
      <div class="quick-grid">
        <div class="quick-item"><span class="quick-label">Total annual limit</span><span class="quick-value">${formatMoney(s.totalAnnual, cur)}</span></div>
        <div class="quick-item"><span class="quick-label">Benefit types</span><span class="quick-value">${s.benefitCount}</span></div>
        <div class="quick-item"><span class="quick-label">Members covered</span><span class="quick-value">${s.memberTotal ?? "—"}</span></div>
        <div class="quick-item"><span class="quick-label">Network hospitals</span><span class="quick-value">${s.hospitals ?? "—"}</span></div>
        <div class="quick-item"><span class="quick-label">Copay schedules</span><span class="quick-value">${s.copayCount}</span></div>
        ${s.lifetimeLimits.map((l) => `
        <div class="quick-item"><span class="quick-label">${esc(titleCase(l.type))} lifetime limit</span><span class="quick-value">${formatMoney(l.limit, cur)}</span></div>`).join("")}
      </div>
    </section>`;

  const overview = `
    <section class="card">
      <h2>Policy Overview</h2>
      <dl class="kv">
        <dt>Policy number</dt><dd>${esc(policy.policy_number)}</dd>
        <dt>Policyholder</dt><dd>${esc(policy.policyholder.name)} <span class="chip">${esc(titleCase(policy.policyholder.type))}</span></dd>
        ${policy.policyholder.industry ? `<dt>Industry</dt><dd>${esc(policy.policyholder.industry)}</dd>` : ""}
        <dt>Plan</dt><dd>${esc(policy.plan.name)} — ${esc(policy.plan.tier)} tier</dd>
        <dt>Coverage period</dt><dd>${formatDate(policy.plan.effective_date)} → ${formatDate(policy.plan.expiry_date)}</dd>
      </dl>
    </section>`;

  const memberRows = Object.entries(policy.members ?? {})
    .map(([k, v]) => `<tr><td>${esc(titleCase(k))}</td><td class="num">${v.toLocaleString()}</td></tr>`)
    .join("");
  const members = `
    <section class="card">
      <h2>Members</h2>
      <table class="table">${memberRows}</table>
    </section>`;

  const benefits = (policy.benefits ?? []).map((b) => {
    const headline = [
      b.annual_limit != null ? `<span class="limit-badge">${formatMoney(b.annual_limit, cur)} / year</span>` : "",
      b.lifetime_limit != null ? `<span class="limit-badge">${formatMoney(b.lifetime_limit, cur)} lifetime</span>` : "",
      b.waiting_period_days ? `<span class="warn-badge">${b.waiting_period_days}-day waiting period</span>` : "",
    ].join(" ");
    const rows = (b.sub_benefits ?? []).map((sb) => `
      <tr>
        <td>${esc(sb.name)}</td>
        <td>${chipList(limitEntries(sb, cur).map((e) => e.text))}</td>
      </tr>`).join("");
    return `
      <div class="benefit">
        <h3>${esc(titleCase(b.type))} ${headline}</h3>
        <table class="table">${rows}</table>
      </div>`;
  }).join("");

  const benefitsSection = `
    <section class="card">
      <h2>Benefits</h2>
      ${benefits || "<p>No benefits in this policy.</p>"}
    </section>`;

  const copayRows = Object.entries(policy.copay ?? {})
    .map(([type, entry]) => `<tr><td>${esc(titleCase(type))}</td><td>${esc(copayText(entry, cur))}</td></tr>`)
    .join("");
  const copay = copayRows ? `
    <section class="card">
      <h2>Copay Schedule</h2>
      <table class="table">${copayRows}</table>
    </section>` : "";

  const waitSection = waits.length ? `
    <section class="card warn-card">
      <h2>Waiting Periods</h2>
      <table class="table">
        <tr><th>Benefit</th><th>Wait</th><th>Usable from</th></tr>
        ${waits.map((w) => `<tr><td>${esc(titleCase(w.type))}</td><td>${w.days} days</td><td>${formatDate(w.until)}</td></tr>`).join("")}
      </table>
    </section>` : "";

  const exclusions = (policy.exclusions ?? []).length ? `
    <section class="card warn-card">
      <h2>Exclusions</h2>
      <ul class="exclusions">
        ${policy.exclusions.map((x) => `<li>${esc(x)}</li>`).join("")}
      </ul>
    </section>` : "";

  const network = policy.network ? `
    <section class="card">
      <h2>Network</h2>
      <dl class="kv">
        <dt>Type</dt><dd>${esc(titleCase(policy.network.type))}</dd>
        ${policy.network.hospital_count != null ? `<dt>Hospitals</dt><dd>${policy.network.hospital_count.toLocaleString()}</dd>` : ""}
        <dt>Countries</dt><dd>${chipList(policy.network.countries ?? [])}</dd>
      </dl>
    </section>` : "";

  $("#summary").innerHTML = `
    ${quickCard}
    <div class="grid">
      ${overview}
      ${members}
      ${network}
    </div>
    ${benefitsSection}
    <div class="grid">
      ${copay}
      ${waitSection}
    </div>
    ${exclusions}`;
}

async function init() {
  const picker = $("#policy-picker");
  for (const p of POLICIES) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    picker.appendChild(opt);
  }
  picker.addEventListener("change", () => renderPromise(loadPolicy(picker.value)));

  $("#toggle-json").addEventListener("click", () => {
    const panel = $("#json-panel");
    panel.open = !panel.open;
  });
  $("#render-json").addEventListener("click", () => {
    const err = $("#json-error");
    try {
      const policy = JSON.parse($("#json-input").value);
      err.textContent = "";
      render(policy);
    } catch (e) {
      err.textContent = `Invalid JSON: ${e.message}`;
    }
  });
  $("#print-btn").addEventListener("click", () => window.print());

  renderPromise(loadPolicy(POLICIES[0].id));
}

function renderPromise(promise) {
  promise.then(render).catch((e) => {
    $("#summary").innerHTML = `<section class="card warn-card"><h2>Error</h2><p>${esc(e.message)}</p></section>`;
  });
}

init();

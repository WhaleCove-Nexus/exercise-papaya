/** CLI: node src/run.js [policy.json] [expenses.json] [out.json] */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { processExpenses } from "./calculator.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

const [policyPath, expensesPath, outPath] = [
  process.argv[2] ?? join(DATA, "policy.json"),
  process.argv[3] ?? join(DATA, "expenses.json"),
  process.argv[4] ?? join(DATA, "expected_outputs.json"),
];

const output = processExpenses(
  JSON.parse(readFileSync(policyPath, "utf8")),
  JSON.parse(readFileSync(expensesPath, "utf8"))
);
writeFileSync(outPath, JSON.stringify(output, null, 2));

for (const r of output.results) {
  const covered = r.covered_amount.toLocaleString("en-US", { minimumFractionDigits: 2 }).padStart(12);
  const member = r.member_pays.toLocaleString("en-US", { minimumFractionDigits: 2 }).padStart(12);
  console.log(`${r.expense_id}  ${r.decision.padEnd(18)} covered=${covered}  member=${member}`);
}
console.log(`\nwrote ${outPath}`);

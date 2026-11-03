# Policy Benefits Calculator

Challenge 06 benefits calculator

## Structure

```
src/
  calculator.js   reusable engine: processExpenses(policy, expenses)
  run.js          thin CLI wrapper
data/
  policy.json     annual limits, per-visit caps, copay (percent + fixed),
                  deductibles, waiting periods, sub-benefit limits, exclusions
  expenses.json   20 expenses exercising every rule path
  expected_outputs.json  generated committed results
tests/calculator.test.js  15 unit tests (node:test)
```

## Run

```bash
npm run run     # node src/run.js -> prints table, writes expected_outputs.json
npm test        # 15 tests
# or directly: node src/run.js policy.json expenses.json out.json
```
// Tests for the Planning page's date helpers (docs/assets/planning.js), run with: node tests/planning.test.js
"use strict";
const assert = require("assert");
const P = require("../docs/assets/planning.js");

const TODAY = "2026-11-16";
const req = (o) => Object.assign({ status: "not-started", due: "", leaf: true }, o);

// today's date comes from the viewer's own clock, as YYYY-MM-DD
assert.strictEqual(P.todayIso(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
assert.strictEqual(P.days("2026-11-16", "2026-12-01"), 15);
assert.strictEqual(P.days("2026-03-28", "2026-03-30"), 2, "across a clock change");
assert.strictEqual(P.addDays("2026-12-25", 10), "2027-01-04");
assert.strictEqual(P.addDays("2026-03-01", -1), "2026-02-28");
assert.strictEqual(P.fmtDate("2026-12-01"), "1 Dec 2026");

// overdue, due soon (within 14 days), later, no date, and finished
assert.deepStrictEqual(P.dueState(req({ due: "2026-11-15" }), TODAY), { state: "overdue", days: -1 });
assert.deepStrictEqual(P.dueState(req({ due: "2026-11-16" }), TODAY), { state: "soon", days: 0 });
assert.deepStrictEqual(P.dueState(req({ due: "2026-11-30" }), TODAY), { state: "soon", days: 14 });
assert.deepStrictEqual(P.dueState(req({ due: "2026-12-01" }), TODAY), { state: "later", days: 15 });
assert.strictEqual(P.dueState(req({}), TODAY).state, "none");
assert.strictEqual(P.dueState(req({ due: "2026-01-01", status: "complete" }), TODAY).state, "done", "a completed requirement is never overdue");
assert.strictEqual(P.dueState(req({ due: "2026-01-01", status: "reopened" }), TODAY).state, "overdue", "a reopened one is");
assert.strictEqual(P.dueText(req({ due: "2026-11-15" }), TODAY), "1 day overdue");
assert.strictEqual(P.dueText(req({ due: "2026-11-10" }), TODAY), "6 days overdue");
assert.strictEqual(P.dueText(req({ due: "2026-11-16" }), TODAY), "due today");
assert.strictEqual(P.dueText(req({ due: "2026-11-17" }), TODAY), "due tomorrow");
assert.strictEqual(P.dueText(req({ due: "2026-12-01" }), TODAY), "due in 15 days");
assert.strictEqual(P.dueText(req({}), TODAY), "");

// the month grid: Monday first, whole weeks, the right number of days
function check(year, month, weeks, firstCell, daysIn) {
  const g = P.monthGrid(year, month);
  assert.strictEqual(g.length, weeks, `${year}-${month + 1} weeks`);
  assert.ok(g.every((w) => w.length === 7));
  assert.strictEqual(g[0][0].date, firstCell, `${year}-${month + 1} first cell`);
  assert.strictEqual(g.flat().filter((c) => c.inMonth).length, daysIn, `${year}-${month + 1} days`);
}
check(2026, 10, 6, "2026-10-26", 30);   // November 2026 starts on a Sunday
check(2027, 1, 4, "2027-02-01", 28);    // February 2027 starts on a Monday: exactly four weeks
check(2028, 1, 5, "2028-01-31", 29);    // leap year
check(2026, 11, 5, "2026-11-30", 31);   // December
{
  const g = P.monthGrid(2026, 10);
  assert.deepStrictEqual([g[0][6].date, g[0][6].day, g[0][6].inMonth], ["2026-11-01", 1, true]);
  assert.strictEqual(g[0][5].inMonth, false);
  assert.strictEqual(g[5][0].date, "2026-11-30");
  assert.strictEqual(g[5][1].date, "2026-12-01");
}

// the tally counts pieces of work: a requirement that has been broken down is counted through its parts
{
  const t = P.tally([
    req({ leaf: false, due: "2026-01-01" }),                 // a parent: not counted itself
    req({ status: "complete" }), req({ status: "complete", due: "2026-01-01" }),
    req({ due: "2026-11-01" }),                               // overdue
    req({ status: "taken-out", due: "2026-11-20" }),          // soon
    req({ status: "reopened", due: "2027-01-01" }),           // later
    req({}),                                                  // no date
    req({ status: "dropped", due: "2026-01-01" })             // left out
  ], TODAY);
  assert.deepStrictEqual(t, { pieces: 6, complete: 2, open: 4, overdue: 1, soon: 1, reopened: 1, needsDate: 1, pct: 33.3 });
  assert.strictEqual(P.tally([], TODAY).pct, 0);
}

console.log("planning: all tests passed");

// Tests for the jetski game's physics (docs/assets/jetski.js), run with: node tests/jetski.test.js
// The physics has no browser dependencies, so it runs here with scripted players.
"use strict";
const assert = require("assert");
const J = require("../docs/assets/jetski.js");

function play(policy, opts) {
  opts = opts || {};
  const seen = { land: {}, events: [] };
  const sim = J.createSim((type, d) => {
    seen.events.push(type);
    if (type === "land" && d.kind !== "hop") seen.land[d.kind] = (seen.land[d.kind] || 0) + 1;
  });
  sim.multiplier = opts.multiplier === undefined ? 1 : opts.multiplier;
  for (let n = 0; n < 60 * 60 && !sim.result; n++) sim.update(1 / 60, policy(sim));
  return { sim, seen };
}

// holds the throttle and, in the air, turns the nose to the slope it will land on
function levelBot(sim) {
  if (!sim.air) return { throttle: 1 };
  const fall = (sim.vy + Math.sqrt(sim.vy * sim.vy + 2 * J.G * Math.max(0, sim.y - J.height(sim.x)))) / J.G;
  const d = J.surfaceAngle(sim.x + sim.vx * fall) - sim.angle;
  return { throttle: 1, tilt: Math.abs(d) > 0.04 ? Math.sign(d) : 0 };
}

// the countdown holds the jetski still, then the race starts
{
  const sim = J.createSim();
  sim.update(1.9, { throttle: 1 });
  assert.strictEqual(sim.phase, "countdown");
  assert.strictEqual(sim.x, 0, "throttle does nothing during Ready and Set");
  sim.update(0.2, { throttle: 1 });
  assert.strictEqual(sim.phase, "race");
}

// the water is the sum of two sine waves, and grows along the course
{
  assert.ok(Math.abs(J.height(0)) < 40);
  const peak = (a, b) => { let m = 0; for (let x = a; x < b; x += 5) m = Math.max(m, Math.abs(J.height(x))); return m; };
  assert.ok(peak(5000, 6000) > peak(0, 1000) * 1.3, "waves get bigger towards the finish");
}

// a level player finishes, leaves the water, and lands clean at least sometimes
{
  const { sim, seen } = play(levelBot);
  assert.ok(sim.result, "finishes");
  assert.ok(sim.result.time > 8 && sim.result.time < 25, "a sensible time: " + sim.result.time);
  assert.ok(seen.events.includes("launch"), "jumps off the waves");
  assert.ok((seen.land.clean || 0) >= 3, "lands clean: " + JSON.stringify(seen.land));
  assert.ok(!seen.land.crash, "no crashes when levelling out");
  assert.ok(sim.result.points > 300);
}

// flying nose-up or nose-down is a crash every time, and a crash scores nothing
for (const tilt of [1, -1]) {
  const { sim, seen } = play(s => ({ throttle: 1, tilt: s.air ? tilt : 0 }));
  assert.ok((seen.land.crash || 0) >= 3, "crashes with tilt " + tilt);
  assert.ok(!seen.land.clean && !seen.land.ok);
  assert.strictEqual(sim.result.points, 0);
}

// no throttle, no progress; the brake stops a rider
{
  const sim = J.createSim();
  sim.update(2.1, {});
  sim.update(5, {});
  assert.ok(sim.x < 5, "does not move without throttle");
  const b = play(s => ({ throttle: 1, brake: s.x > 1500 ? 1 : 0 }));
  assert.ok(!b.sim.result && b.sim.x < 2600, "brakes hold the rider back");
}

// the score is points (plus a time bonus) times the documentation coverage
{
  const a = play(levelBot, { multiplier: 1 }).sim.result, b = play(levelBot, { multiplier: 0.5 }).sim.result;
  assert.strictEqual(a.time, b.time, "the multiplier does not change the race");
  assert.strictEqual(a.score, Math.round(a.total));
  assert.strictEqual(b.score, Math.round(a.total * 0.5));
  assert.strictEqual(Math.round(a.bonus), Math.round(Math.max(0, 120 - a.time) * 20));
}

// the result stays up, then the course restarts by itself, forever
{
  const types = [];
  const sim = J.createSim(t => types.push(t));
  sim.multiplier = 1;
  for (let n = 0; n < 60 * 90; n++) sim.update(1 / 60, levelBot(sim));
  assert.ok(types.filter(t => t === "finish").length >= 3, "finishes again and again: " + types.filter(t => t === "finish").length);
  assert.ok(types.filter(t => t === "restart").length >= 2, "restarts by itself");
  assert.ok(types.indexOf("finish") < types.indexOf("restart"));
}

console.log("jetski: all tests passed");

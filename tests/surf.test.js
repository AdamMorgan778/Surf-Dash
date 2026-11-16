// Tests for the Surf forecast page's scoring (docs/assets/surf.js) and its spots file, run with: node tests/surf.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const S = require("../docs/assets/surf.js");

const level = (id) => S.LEVELS.find((l) => l.id === id);
const WEST = 270;   // a beach that looks due west
// a clean day: swell straight in, light wind off the land
const sea = (o) => Object.assign({ swellHeight: 1, swellDirection: 270, swellPeriod: 10, windWaveHeight: 0, windWaveDirection: 270, windSpeed: 4, windDirection: 90 }, o);
const score = (o, id) => S.assess(sea(o), WEST, level(id || "intermediate"));

// compass bearings
assert.strictEqual(S.angleDiff(350, 10), 20, "across north");
assert.strictEqual(S.angleDiff(90, 270), 180);
assert.strictEqual(S.compass(0), "N");
assert.strictEqual(S.compass(247), "WSW");
assert.strictEqual(S.compass(359), "N");

// how much swell reaches the beach: all of it straight in, less at an angle, almost none from behind
assert.strictEqual(S.directionFactor(270, WEST), 1);
assert.ok(S.directionFactor(225, WEST) < 1 && S.directionFactor(225, WEST) > 0.6, "45 degrees off still gets most of it");
assert.ok(Math.abs(S.directionFactor(180, WEST) - 0.15) < 1e-9, "side-on swell wraps in a little");
assert.ok(S.directionFactor(90, WEST) < 0.05, "swell from behind the beach");
assert.strictEqual(S.directionFactor(null, WEST), 0, "no direction in the forecast");
for (let d = 0; d < 180; d += 5) assert.ok(S.directionFactor(270 + d + 5, WEST) <= S.directionFactor(270 + d, WEST), "never grows as the swell turns away");

// surf height: 1 m of 10 second swell straight in is about 1 m (3 ft) of surf; long period is bigger, short is smaller
assert.ok(Math.abs(S.surfHeight(sea(), WEST) - 1) < 0.01);
assert.ok(S.surfHeight(sea({ swellPeriod: 15 }), WEST) > S.surfHeight(sea(), WEST));
assert.ok(S.surfHeight(sea({ swellPeriod: 6 }), WEST) < S.surfHeight(sea(), WEST));
assert.ok(S.surfHeight(sea({ swellDirection: 90 }), WEST) < 0.1, "swell heading away from the beach gives little surf");
assert.ok(S.surfHeight(sea({ swellHeight: 0, windWaveHeight: 1.5 }), WEST) > 0.5, "wind chop makes waves too");
assert.strictEqual(S.surfRange(0.2), "Flat");
assert.strictEqual(S.surfRange(0.8), "Under 1 ft");
assert.strictEqual(S.surfRange(3.3), "3–4 ft");

// wind: from the land is offshore, from the sea is onshore
assert.strictEqual(S.windSide(90, WEST), "offshore");
assert.strictEqual(S.windSide(270, WEST), "onshore");
assert.strictEqual(S.windSide(180, WEST), "cross-shore");
assert.strictEqual(S.windFactor(4, 270, WEST, level("beginner")), 1, "light wind does no harm from any direction");
assert.ok(S.windFactor(18, 90, WEST, level("advanced")) > 0.85, "a fresh offshore wind is fine");
assert.ok(S.windFactor(18, 270, WEST, level("advanced")) < 0.5, "the same wind onshore is not");
assert.ok(S.windFactor(25, 90, WEST, level("beginner")) < S.windFactor(25, 90, WEST, level("advanced")), "beginners are marked down more for strong wind");

// the score: offshore beats onshore; each level has its own size
assert.ok(score({ windSpeed: 15, windDirection: 90 }).score > score({ windSpeed: 15, windDirection: 270 }).score + 3, "offshore beats onshore");
assert.ok(score({ swellPeriod: 13 }).score > score({ swellPeriod: 6 }).score, "long-period swell scores higher");
{
  const big = { swellHeight: 1.85 };   // about 6 ft of surf
  assert.ok(Math.abs(score(big).feet - 6.07) < 0.05);
  const b = score(big, "beginner"), a = score(big, "advanced");
  assert.strictEqual(b.score, 0);
  assert.ok(b.tooBig && b.label === "Too big" && b.reason === "Too big for beginners");
  assert.ok(a.score >= 7.5 && a.band === 4 && a.label === "Epic", "6 ft and clean is epic for advanced: " + a.score);
  assert.strictEqual(a.reason, "Good size, light wind");
}
{
  const small = { swellHeight: 0.5 };   // about 1.6 ft
  assert.ok(score(small, "beginner").score > 7, "small and clean suits beginners");
  assert.ok(score({ swellHeight: 0.28 }, "beginner").score < 5, "ankle-high surf is not good, even for beginners");
  assert.strictEqual(score(small, "pro").score, 0);
  assert.strictEqual(score(small, "pro").label, "Too small");
}
S.LEVELS.forEach((l) => {
  const flat = S.assess(sea({ swellHeight: 0.05 }), WEST, l);
  assert.deepStrictEqual([flat.score, flat.band, flat.label, flat.reason], [0, 0, "Flat", "Flat"], "a flat sea scores zero for " + l.id);
  for (let h = 0; h <= 8; h += 0.25) {
    const x = S.assess(sea({ swellHeight: h, windSpeed: 30, windDirection: 250 }), WEST, l);
    assert.ok(x.score >= 0 && x.score <= 10 && x.band >= 0 && x.band <= 4, "score stays between 0 and 10");
  }
});
assert.strictEqual(score({ windSpeed: 20, windDirection: 270 }).reason, "Good size, blown out by onshore wind");
assert.strictEqual(score({ windSpeed: 12, windDirection: 90, swellPeriod: 12 }).reason, "Good size, clean offshore wind, long-period swell");
assert.deepStrictEqual(S.LEVELS.map((l) => l.label), ["Beginner", "Intermediate", "Advanced", "Pro"], "the model's skill levels");
assert.strictEqual(S.BANDS.length, 5);

// time: the forecast's hours are in Wales' local time
assert.strictEqual(S.londonHour(new Date(Date.UTC(2026, 10, 16, 14, 30))), "2026-11-16T14:00", "winter: the same as UTC");
assert.strictEqual(S.londonHour(new Date(Date.UTC(2026, 6, 1, 23, 5))), "2026-07-02T00:00", "summer: an hour ahead");
assert.strictEqual(S.dayName("2026-11-16T14:00"), "Mon 16");
assert.strictEqual(S.fmtHour("2026-11-16T14:00"), "Mon 16 Nov, 14:00");
// the tide in words, from the heights either side of the hour
{
  const tide = [0, 1, 1.8, 2, 1.7, 1, 0, -1, -1.8, -2, -1.7, -1, 0, 1];
  assert.deepStrictEqual(S.tideState(tide, 3), { level: "High", trend: "falling" });
  assert.deepStrictEqual(S.tideState(tide, 9), { level: "Low", trend: "rising" });
  assert.deepStrictEqual(S.tideState(tide, 6), { level: "Mid", trend: "falling" });
  assert.deepStrictEqual(S.tideState(tide, 13), { level: "Mid", trend: "rising" }, "the last hour looks back for its trend");
  assert.deepStrictEqual(S.tideState([null, null], 0), { level: "", trend: "" }, "no tide in the forecast");
}
// the best hour of a day is the best one in daylight
assert.strictEqual(S.bestHour([9, 2, 5, 7, 1], [0, 1, 1, 1, 0], 0, 5), 3);
assert.strictEqual(S.bestHour([9, 2, 5, 7, 1], [0, 0, 0, 0, 0], 0, 5), 0, "no daylight in the run: the best of any hour");
assert.strictEqual(S.bestHour([9, 2, 5, 7, 1], [1, 1, 1, 1, 1], 1, 3), 2, "only the hours asked for");

// the map and its spots
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "assets", name), "utf8"));
const places = read("surf-spots.json"), coast = read("surf-coast.json");
const [west, south, east, north] = coast.bbox;
const proj = S.projection(coast.bbox, 1000);
assert.deepStrictEqual(proj.point(west, north), [0, 0]);
assert.ok(Math.abs(proj.point(east, south)[0] - 1000) < 1e-9 && Math.abs(proj.point(east, south)[1] - proj.height) < 1e-9);
assert.ok(proj.height > 800 && proj.height < 1100, "the map is roughly square: " + proj.height);
assert.strictEqual(coast.land[0].name, "Pembrokeshire");
assert.ok(/Open Government Licence/.test(coast.credit), "the coastline credit is kept with the data");

const KX = Math.cos((south + north) / 2 * Math.PI / 180), M = 111200;
const xy = (p) => [p[0] * KX * M, p[1] * M];
function metresFromCoast(lon, lat) {
  const [px, py] = xy([lon, lat]);
  let best = Infinity;
  coast.land.forEach((c) => c.rings.forEach((r) => r.forEach((b, i) => {
    const [ax, ay] = xy(r[(i || r.length) - 1]), [bx, by] = xy(b), dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  })));
  return best;
}
assert.ok(places.spots.length >= 10);
assert.strictEqual(new Set(places.spots.map((s) => s.id)).size, places.spots.length, "spot ids are unique");
places.spots.forEach((s) => {
  ["id", "name", "type", "about"].forEach((k) => assert.ok(typeof s[k] === "string" && s[k], s.id + " has " + k));
  assert.ok(/^[a-z]+$/.test(s.id), s.id + " is a plain id, for the page address");
  assert.ok(s.faces >= 0 && s.faces < 360, s.name + " faces a compass bearing");
  assert.ok(s.lon > west + 0.03 && s.lon < east - 0.03 && s.lat > south + 0.03 && s.lat < north - 0.03, s.name + " is inside the map");
  assert.ok(metresFromCoast(s.lon, s.lat) < 500, s.name + " is on the coast: " + Math.round(metresFromCoast(s.lon, s.lat)) + " m away");
  const out = S.seaPoint(s, 3);   // where the wave forecast is read: 3 km out the way the beach faces, unless the spot says otherwise
  const km = Math.hypot((out.lon - s.lon) * Math.cos(s.lat * Math.PI / 180), out.lat - s.lat) * 111.2;
  assert.ok(Math.abs(km - (s.seaKm || 3)) < 0.01, s.name + " sea point is " + (s.seaKm || 3) + " km out");
  assert.ok(metresFromCoast(out.lon, out.lat) > 400, s.name + " sea point is clear of the coast");
});
places.towns.concat(places.seas).forEach((t) => assert.ok(t.name && t.lon > west && t.lon < east && t.lat > south && t.lat < north, t.name + " is inside the map"));

console.log("surf: all tests passed");

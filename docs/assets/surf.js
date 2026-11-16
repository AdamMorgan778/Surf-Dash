// Surf forecast page: live surf conditions for Pembrokeshire on a map, scored for four ability levels, with a
// time bar from three days back to a week ahead.
//   - The spots and place names are in assets/surf-spots.json (hand-written); the land shapes are in
//     assets/surf-coast.json (built once by tools/art/surf_coast.py).
//   - The forecast is fetched by the browser from Open-Meteo each time the page is opened (no key needed), so it is
//     always current. That is why the scoring is here and not in Python: it has to run on live data.
// The scoring functions at the top have no browser dependencies, so tests/surf.test.js runs them in Node.
(function () {
  "use strict";

  // ---- ability levels: the model's own skill levels (DimSurfer[SkillLevel]).
  //   size: surf height in feet [too small below, ideal from, ideal to, too big above]
  //   period: how much the swell period matters (0 to 1); wind: mph above which strong wind costs extra
  var LEVELS = [
    { id: "beginner", label: "Beginner", plural: "beginners", size: [0.5, 1.5, 2.5, 4], period: 0.25, wind: 18 },
    { id: "intermediate", label: "Intermediate", plural: "intermediates", size: [1, 2, 4, 6.5], period: 0.4, wind: 24 },
    { id: "advanced", label: "Advanced", plural: "advanced surfers", size: [2, 3, 7, 11], period: 0.5, wind: 30 },
    { id: "pro", label: "Pro", plural: "pros", size: [3, 5, 12, 20], period: 0.55, wind: 35 }
  ];
  var BANDS = [{ label: "Flat", from: 0 }, { label: "Poor", from: 0 }, { label: "Fair", from: 3 }, { label: "Good", from: 5 }, { label: "Epic", from: 7.5 }];
  var FT = 3.281, RAD = Math.PI / 180;
  var POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function ramp(x, from, to) { return clamp((x - from) / (to - from), 0, 1); }   // 0 at `from`, 1 at `to`
  function norm(deg) { return ((deg % 360) + 360) % 360; }
  function angleDiff(a, b) { var d = Math.abs(norm(a) - norm(b)); return d > 180 ? 360 - d : d; }
  function compass(deg) { return POINTS[Math.round(norm(deg) / 22.5) % 16]; }
  function num(v) { return typeof v === "number" && isFinite(v); }

  // How much of a swell coming from `from` reaches a beach that looks out towards `faces` (both compass bearings).
  // Straight in is 1; side-on is 0.15 (waves bend round headlands); from behind the beach, almost nothing.
  function directionFactor(from, faces) {
    if (!num(from)) return 0;
    var d = angleDiff(from, faces);
    return d < 90 ? 0.15 + 0.85 * Math.pow(Math.cos(d * RAD), 1.3) : 0.15 - 0.12 * ramp(d, 90, 180);
  }
  // Long-period swell stands up taller on the beach than short-period swell of the same height.
  function periodFactor(seconds) { return clamp(0.55 + 0.045 * (seconds || 0), 0.7, 1.35); }
  // Estimated height of the breaking waves at the beach, in metres: the swell that gets in, plus some wind chop.
  function surfHeight(c, faces) {
    var swell = (c.swellHeight || 0) * directionFactor(c.swellDirection, faces) * periodFactor(c.swellPeriod);
    var chop = 0.6 * (c.windWaveHeight || 0) * directionFactor(c.windWaveDirection, faces);
    return Math.sqrt(swell * swell + chop * chop);
  }
  // Wind blowing from the sea is onshore (messy waves); from the land is offshore (clean waves).
  function windSide(from, faces) { var d = angleDiff(from, faces); return d <= 60 ? "onshore" : d >= 120 ? "offshore" : "cross-shore"; }
  function windFactor(speed, from, faces, level) {
    if (!num(speed) || speed <= 5) return 1;                               // light wind: glassy whichever way it blows
    var on = (Math.cos(angleDiff(from, faces) * RAD) + 1) / 2;            // 1 dead onshore, 0 dead offshore
    var f = 1 - (0.008 + 0.042 * Math.pow(on, 1.2)) * (speed - 5);
    if (speed > level.wind) f *= 1 - 0.04 * (speed - level.wind);         // too windy for this level, whatever the direction
    return clamp(f, 0.1, 1);
  }
  function sizeFactor(feet, level) {
    var s = level.size;
    if (feet < s[0] || feet > s[3]) return 0;
    return Math.min(ramp(feet, s[0], s[1]), 1 - ramp(feet, s[2], s[3]));
  }
  function surfRange(feet) {
    if (feet < 0.5) return "Flat";
    if (feet < 1) return "Under 1 ft";
    var lo = Math.floor(feet);
    return lo + "–" + (lo + 1) + " ft";
  }

  // The verdict for one spot, hour and level.
  //   c: {swellHeight (m), swellDirection, swellPeriod (s), windWaveHeight (m), windWaveDirection, windSpeed (mph), windDirection}
  //   -> {score 0-10, band 0-4, label, tooBig, feet, side, reason}
  function assess(c, faces, level) {
    var feet = surfHeight(c, faces) * FT, s = level.size, size = sizeFactor(feet, level);
    var periodScore = (1 - level.period) + level.period * ramp(c.swellPeriod || 0, 5, 11);
    var wind = windFactor(c.windSpeed, c.windDirection, faces, level), side = windSide(c.windDirection, faces);
    var score = Math.round(100 * size * periodScore * wind) / 10;
    var tooBig = feet > s[3], band = feet < s[0] || tooBig ? 0 : score >= 7.5 ? 4 : score >= 5 ? 3 : score >= 3 ? 2 : 1;
    var reason;
    if (feet < 0.5) reason = "Flat";
    else if (feet < s[0]) reason = "Too small for " + level.plural;
    else if (tooBig) reason = "Too big for " + level.plural;
    else {
      var v = c.windSpeed || 0;
      reason = (feet < s[1] ? "Small" : feet > s[2] ? "Big" : "Good size") + ", " +
        (v <= 5 ? "light wind" :
         side === "offshore" ? (v > level.wind ? "strong offshore wind" : "clean offshore wind") :
         side === "cross-shore" ? (v >= 15 ? "strong cross-shore wind" : "cross-shore wind") :
         v >= 14 ? "blown out by onshore wind" : "onshore breeze") +
        (c.swellPeriod >= 11 ? ", long-period swell" : c.swellPeriod <= 6 ? ", short weak swell" : "");
    }
    return { score: score, band: band, label: tooBig ? "Too big" : feet < s[0] && feet >= 0.5 ? "Too small" : BANDS[band].label,
             tooBig: tooBig, feet: feet, side: side, reason: reason };
  }

  // ---- places and time
  // The point `km` out to sea from a spot, the way its beach faces: where the wave forecast is read.
  // A spot can set its own distance (seaKm) where an island is in the way.
  function seaPoint(spot, km) {
    km = spot.seaKm || km;
    var b = spot.faces * RAD, kx = Math.cos(spot.lat * RAD);
    return { lat: spot.lat + km * Math.cos(b) / 111.2, lon: spot.lon + km * Math.sin(b) / (111.2 * kx) };
  }
  // Map position of a longitude and latitude: a flat map `width` wide, with north up. bbox is [west, south, east, north].
  function projection(bbox, width) {
    var kx = Math.cos((bbox[1] + bbox[3]) / 2 * RAD), lon = bbox[2] - bbox[0], lat = bbox[3] - bbox[1];
    var height = width * lat / (lon * kx);
    return { width: width, height: height,
             point: function (lo, la) { return [(lo - bbox[0]) / lon * width, (bbox[3] - la) / lat * height]; } };
  }
  // The hour it is now in Wales, as the forecast writes it: "2026-11-16T14:00".
  function londonHour(date) {
    var p = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day + "T" + (p.hour === "24" ? "00" : p.hour) + ":00";
  }
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dayName(stamp) {   // "2026-11-16T14:00" -> "Mon 16"
    var d = new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(5, 7) - 1, +stamp.slice(8, 10)));
    return DAYS[d.getUTCDay()] + " " + d.getUTCDate();
  }
  function fmtHour(stamp) { return dayName(stamp) + " " + MONTHS[+stamp.slice(5, 7) - 1] + ", " + stamp.slice(11, 16); }
  // The best hour of a run of hours: the highest score in daylight, or failing that at any time. -> index or -1
  function bestHour(scores, daylight, from, to) {
    var best = -1, any = -1;
    for (var i = from; i < to; i++) {
      if (any < 0 || scores[i] > scores[any]) any = i;
      if (daylight[i] && (best < 0 || scores[i] > scores[best])) best = i;
    }
    return best < 0 ? any : best;
  }

  // Where the tide stands at hour t, from the heights around it: Low, Mid or High, and whether it is rising or falling.
  function tideState(heights, t) {
    if (!num(heights[t])) return { level: "", trend: "" };
    var lo = Infinity, hi = -Infinity, from = clamp(t - 6, 0, Math.max(0, heights.length - 13));   // 13 hours: one whole tide
    for (var i = from; i <= Math.min(heights.length - 1, from + 12); i++) if (num(heights[i])) { lo = Math.min(lo, heights[i]); hi = Math.max(hi, heights[i]); }
    var f = hi > lo ? (heights[t] - lo) / (hi - lo) : 0.5, next = heights[t + 1], prev = heights[t - 1];
    return { level: f < 0.25 ? "Low" : f > 0.75 ? "High" : "Mid",
             trend: num(next) ? (next > heights[t] ? "rising" : "falling") : num(prev) ? (heights[t] > prev ? "rising" : "falling") : "" };
  }

  var pure = { LEVELS: LEVELS, BANDS: BANDS, angleDiff: angleDiff, compass: compass, directionFactor: directionFactor, periodFactor: periodFactor,
               surfHeight: surfHeight, windSide: windSide, windFactor: windFactor, sizeFactor: sizeFactor, surfRange: surfRange, assess: assess,
               tideState: tideState, seaPoint: seaPoint, projection: projection, londonHour: londonHour, dayName: dayName, fmtHour: fmtHour, bestHour: bestHour };
  if (typeof module === "object" && module.exports) module.exports = pure;
  if (typeof document === "undefined") return;

  // =====================================================================================================  the page
  var M = window.ModelDocs, el = M.el, clear = M.clear;
  var MARINE = "https://marine-api.open-meteo.com/v1/marine", WEATHER = "https://api.open-meteo.com/v1/forecast";
  var PAST_DAYS = 3, AHEAD_DAYS = 8, SEA_KM = 3, CACHE = "surf-forecast-v1", CACHE_MINUTES = 30, W = 1000;
  var app, root, spots, coast, places, proj;
  var data = null;            // {hours: [...], now, days: [{label, from, to}], spots: [{c: [per hour], daylight, sea, tide, air, gust, a: {level: [assessments]}}]}
  var state = { level: "beginner", spot: null, t: 0, timeSet: false };
  var view = { x: 0, y: 0, w: W, h: 0, zoom: 1 }, ui = {}, timer = null;

  function svg(tag, attrs, children) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") node.textContent = attrs[k]; else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function level() { return LEVELS.filter(function (l) { return l.id === state.level; })[0]; }
  function spotIndex(id) { for (var i = 0; i < spots.length; i++) if (spots[i].id === id) return i; return -1; }
  function at(i) { return data ? data.spots[i].a[state.level][state.t] : null; }
  function ft(m) { return (m * FT).toFixed(1) + " ft"; }

  // ---- the address keeps the level, spot and time, so a view can be bookmarked or shared
  function readState() {
    var p = new URLSearchParams(location.search);
    if (LEVELS.some(function (l) { return l.id === p.get("level"); })) state.level = p.get("level");
    else { try { var saved = localStorage.getItem("surf-level"); if (LEVELS.some(function (l) { return l.id === saved; })) state.level = saved; } catch (e) { /* no storage */ } }
    if (spotIndex(p.get("spot")) !== -1) state.spot = p.get("spot");
    state.wantTime = p.get("t");
  }
  function writeState() {
    var p = new URLSearchParams();
    p.set("level", state.level);
    if (state.spot) p.set("spot", state.spot);
    if (data && state.timeSet) p.set("t", data.hours[state.t]);
    history.replaceState(null, "", location.pathname + "?" + p.toString());
    try { localStorage.setItem("surf-level", state.level); } catch (e) { /* no storage */ }
  }

  // ---- forecast: two requests for all the spots at once, kept for half an hour so a reload does not ask again
  function query(base, points, fields, extra) {
    return base + "?latitude=" + points.map(function (p) { return p.lat.toFixed(4); }).join(",") +
      "&longitude=" + points.map(function (p) { return p.lon.toFixed(4); }).join(",") + "&hourly=" + fields.join(",") +
      "&past_days=" + PAST_DAYS + "&forecast_days=" + AHEAD_DAYS + "&timezone=Europe%2FLondon" + (extra || "");
  }
  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("the forecast service answered " + r.status);
      return r.json();
    });
  }
  function fetchForecast() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(CACHE) || "null");
      if (saved && Date.now() - saved.at < CACHE_MINUTES * 60000 && saved.ids === spots.map(function (s) { return s.id; }).join()) return Promise.resolve(saved);
    } catch (e) { /* no storage, or not ours */ }
    return Promise.all([
      getJson(query(MARINE, spots.map(function (s) { return seaPoint(s, SEA_KM); }),
        ["swell_wave_height", "swell_wave_direction", "swell_wave_period", "wind_wave_height", "wind_wave_direction", "sea_surface_temperature", "sea_level_height_msl"])),
      getJson(query(WEATHER, spots, ["wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "temperature_2m", "is_day"], "&wind_speed_unit=mph"))
    ]).then(function (d) {
      var out = { at: Date.now(), ids: spots.map(function (s) { return s.id; }).join(), marine: [].concat(d[0]), weather: [].concat(d[1]) };
      try { sessionStorage.setItem(CACHE, JSON.stringify(out)); } catch (e) { /* too big or no storage: fetch again next time */ }
      return out;
    });
  }
  function digest(raw) {
    var hours = raw.marine[0].hourly.time, n = Math.min(hours.length, raw.weather[0].hourly.time.length);
    hours = hours.slice(0, n);
    var days = [];
    hours.forEach(function (h, i) {
      var last = days[days.length - 1];
      if (last && last.date === h.slice(0, 10)) last.to = i + 1; else days.push({ date: h.slice(0, 10), from: i, to: i + 1 });
    });
    var now = hours.indexOf(londonHour(new Date()));
    if (now < 0) now = Math.min(n - 1, PAST_DAYS * 24);
    days.forEach(function (d) { d.label = now >= d.from && now < d.to ? "Today" : dayName(d.date); d.past = d.to <= now; });
    return { hours: hours, now: now, days: days, fetched: raw.at, spots: spots.map(function (s, i) {
      var m = raw.marine[i].hourly, w = raw.weather[i].hourly, c = [], a = {};
      for (var h = 0; h < n; h++) {
        c.push({ swellHeight: m.swell_wave_height[h], swellDirection: m.swell_wave_direction[h], swellPeriod: m.swell_wave_period[h],
                 windWaveHeight: m.wind_wave_height[h], windWaveDirection: m.wind_wave_direction[h],
                 windSpeed: w.wind_speed_10m[h], windDirection: w.wind_direction_10m[h] });
      }
      LEVELS.forEach(function (l) { a[l.id] = c.map(function (x) { return assess(x, s.faces, l); }); });
      return { c: c, a: a, daylight: w.is_day, sea: m.sea_surface_temperature, tide: m.sea_level_height_msl, air: w.temperature_2m, gust: w.wind_gusts_10m };
    }) };
  }
  function dayOf(t) { for (var i = 0; i < data.days.length; i++) if (t < data.days[i].to) return data.days[i]; return data.days[data.days.length - 1]; }

  // ---- map
  function landPath(rings) {
    return rings.map(function (r) {
      return "M" + r.map(function (p) { var q = proj.point(p[0], p[1]); return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("L") + "Z";
    }).join("");
  }
  function pinned(x, y, cls, children) {   // a group that stays the same size on screen however far the map is zoomed
    var g = svg("g", { class: "surf-px " + cls }, children);
    g._at = [x, y];
    ui.pinned.push(g);
    return g;
  }
  function buildMap(host) {
    proj = projection(coast.bbox, W);
    view.h = proj.height;
    ui.pinned = [];
    var near = coast.land.slice(1), main = coast.land[0];
    var edge = svg("g", { class: "surf-coast" }, coast.land.map(function (c) { return svg("path", { d: landPath(c.rings) }); }));
    var land = svg("g", { class: "surf-land" }, near.map(function (c) { return svg("path", { class: "is-near", d: landPath(c.rings) }); })
      .concat([svg("path", { d: landPath(main.rings) })]));
    var labels = svg("g", { class: "surf-labels", "aria-hidden": "true" },
      (places.seas || []).map(function (s) { var p = proj.point(s.lon, s.lat); return pinned(p[0], p[1], "surf-sea-name", [svg("text", { text: s.name })]); })
      .concat((places.towns || []).map(function (t) {
        var p = proj.point(t.lon, t.lat);
        return pinned(p[0], p[1], "surf-town", [svg("circle", { r: 2.5 }), svg("text", { x: 7, y: 4, text: t.name })]);
      })));
    ui.markers = spots.map(function (s) {
      var p = proj.point(s.lon, s.lat);
      var g = pinned(p[0], p[1], "surf-marker", [svg("circle", { class: "surf-halo", r: 19 }), svg("circle", { class: "surf-disc", r: 14 }),
        svg("text", { class: "surf-num", y: 4.5, text: "–" }), svg("text", { class: "surf-name", y: -25, text: s.name })]);
      g.setAttribute("tabindex", "0"); g.setAttribute("role", "button");
      g.addEventListener("click", function () { select(s.id); });
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(s.id); } });
      ["pointerenter", "focus"].forEach(function (ev) { g.addEventListener(ev, function () { showTip(s); }); });
      ["pointerleave", "blur"].forEach(function (ev) { g.addEventListener(ev, hideTip); });
      return g;
    });
    ui.svg = svg("svg", { class: "surf-map", role: "group", "aria-label": "Map of the Pembrokeshire coast with " + spots.length + " surf spots" }, [
      svg("defs", {}, [svg("linearGradient", { id: "surf-sea", x1: "0", y1: "0", x2: "1", y2: "1" },
        [svg("stop", { offset: "0", class: "surf-sea-a" }), svg("stop", { offset: "0.55", class: "surf-sea-b" }), svg("stop", { offset: "1", class: "surf-sea-c" })])]),
      svg("rect", { class: "surf-sea", x: -W, y: -W, width: 3 * W, height: 3 * W, fill: "url(#surf-sea)" }),
      edge, land, labels, svg("g", { class: "surf-spots" }, ui.markers)]);
    ui.tip = el("div", { class: "surf-tip", hidden: "" });
    ui.hint = el("div", { class: "surf-hint", hidden: "", text: "Hold Ctrl and scroll to zoom" });
    ui.status = el("div", { class: "surf-status", role: "status", text: "Loading the forecast…" });
    ui.dial = el("div", { class: "surf-dial", hidden: "" });
    function zoomButton(label, text, fn) { return el("button", { type: "button", class: "surf-zoom-btn", "aria-label": label, title: label, text: text, onclick: fn }); }
    ui.wrap = el("div", { class: "surf-map-wrap", style: "aspect-ratio:" + W + "/" + proj.height.toFixed(0) }, [
      ui.svg, ui.dial, ui.status, ui.tip, ui.hint,
      el("div", { class: "surf-zoom" }, [
        zoomButton("Zoom in", "+", function () { zoomBy(1.6); }), zoomButton("Zoom out", "−", function () { zoomBy(1 / 1.6); }),
        zoomButton("Show the whole coast", "⤢", function () { setView(0, 0, 1); })])]);
    host.appendChild(ui.wrap);

    // drag to pan, Ctrl + wheel or double-click to zoom
    var drag = null;
    ui.svg.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest(".surf-marker") || view.zoom === 1) return;
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      ui.svg.setPointerCapture(e.pointerId); ui.wrap.classList.add("is-dragging");
    });
    ui.svg.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var k = view.w / ui.wrap.clientWidth;
      setView(drag.vx - (e.clientX - drag.x) * k, drag.vy - (e.clientY - drag.y) * k, view.zoom);
    });
    ["pointerup", "pointercancel"].forEach(function (ev) { ui.svg.addEventListener(ev, function () { drag = null; ui.wrap.classList.remove("is-dragging"); }); });
    ui.wrap.addEventListener("wheel", function (e) {
      if (!e.ctrlKey) { ui.hint.hidden = false; clearTimeout(ui.hintTimer); ui.hintTimer = setTimeout(function () { ui.hint.hidden = true; }, 1400); return; }
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e);
    }, { passive: false });
    ui.svg.addEventListener("dblclick", function (e) { if (!e.target.closest(".surf-marker")) zoomBy(1.6, e); });
    if (window.ResizeObserver) new ResizeObserver(layout).observe(ui.wrap); else window.addEventListener("resize", layout);
    setView(0, 0, 1);
  }
  function setView(x, y, zoom) {
    view.zoom = clamp(zoom, 1, 8); view.w = W / view.zoom; view.h = proj.height / view.zoom;
    view.x = clamp(x, 0, W - view.w); view.y = clamp(y, 0, proj.height - view.h);
    ui.svg.setAttribute("viewBox", view.x.toFixed(1) + " " + view.y.toFixed(1) + " " + view.w.toFixed(1) + " " + view.h.toFixed(1));
    ui.wrap.classList.toggle("is-zoomed", view.zoom > 1);
    ui.wrap.classList.toggle("show-names", view.zoom >= 2);
    hideTip();
    layout();
  }
  function zoomBy(factor, e) {   // about the pointer if there is one, else the middle of the map
    var r = ui.wrap.getBoundingClientRect(), fx = e ? (e.clientX - r.left) / r.width : 0.5, fy = e ? (e.clientY - r.top) / r.height : 0.5;
    var cx = view.x + fx * view.w, cy = view.y + fy * view.h, zoom = clamp(view.zoom * factor, 1, 8);
    setView(cx - fx * W / zoom, cy - fy * proj.height / zoom, zoom);
  }
  function layout() {
    var k = view.w / (ui.wrap.clientWidth || W);   // map units to one screen pixel
    // markers that would overlap on screen are nudged apart; zooming in brings them back to their true places
    var small = ui.wrap.clientWidth < 420 ? 0.8 : 1;   // smaller markers on a phone
    var gap = 29 * small, off = ui.markers.map(function () { return [0, 0]; });
    for (var pass = 0; pass < 6; pass++) {
      for (var i = 0; i < ui.markers.length; i++) for (var j = i + 1; j < ui.markers.length; j++) {
        var a = ui.markers[i]._at, b = ui.markers[j]._at;
        var dx = (b[0] - a[0]) / k + off[j][0] - off[i][0], dy = (b[1] - a[1]) / k + off[j][1] - off[i][1], d = Math.hypot(dx, dy) || 1;
        if (d >= gap) continue;
        var push = (gap - d) / 2;
        off[i][0] -= dx / d * push; off[i][1] -= dy / d * push; off[j][0] += dx / d * push; off[j][1] += dy / d * push;
      }
    }
    ui.markers.forEach(function (g, i) { g._off = [off[i][0] * k, off[i][1] * k]; });
    ui.pinned.forEach(function (g) {
      var o = g._off || [0, 0];
      g.setAttribute("transform", "translate(" + (g._at[0] + o[0]).toFixed(1) + " " + (g._at[1] + o[1]).toFixed(1) + ") scale(" + (k * small).toFixed(4) + ")");
    });
  }
  function showTip(s) {
    var i = spotIndex(s.id), a = at(i), g = ui.markers[i], k = ui.wrap.clientWidth / view.w;
    clear(ui.tip);
    ui.tip.appendChild(el("strong", { text: s.name }));
    ui.tip.appendChild(el("span", { text: a ? a.score.toFixed(1) + " · " + a.label + " · " + surfRange(a.feet) : s.type }));
    ui.tip.style.left = ((g._at[0] + g._off[0] - view.x) * k) + "px"; ui.tip.style.top = ((g._at[1] + g._off[1] - view.y) * k) + "px";
    ui.tip.hidden = false;
  }
  function hideTip() { if (ui.tip) ui.tip.hidden = true; }

  // ---- drawing the state
  function bandClass(a) { return a ? "band-" + a.band + (a.tooBig ? " is-toobig" : "") : "band-none"; }
  function chip(a) { return el("span", { class: "surf-chip " + bandClass(a) }, [a.tooBig ? el("span", { class: "surf-warn", "aria-hidden": "true", text: "⚠" }) : null, a.label]); }
  function arrow(deg) {   // an arrow pointing the way the swell or wind is travelling (they are named for where they come from)
    var s = svg("svg", { class: "surf-arrow", viewBox: "0 0 24 24", "aria-hidden": "true" }, [svg("path", { d: "M12 2.5l5.5 8.5h-3.6v10.5h-3.8V11H6.5z" })]);
    s.style.transform = "rotate(" + norm(deg + 180) + "deg)";
    return s;
  }
  function renderMap() {
    spots.forEach(function (s, i) {
      var a = at(i), g = ui.markers[i];
      g.setAttribute("class", "surf-px surf-marker " + bandClass(a) + (s.id === state.spot ? " is-selected" : ""));
      g.querySelector(".surf-num").textContent = a ? String(Math.round(a.score)) : "–";
      g.setAttribute("aria-label", s.name + (a ? ": " + a.score.toFixed(1) + " out of 10, " + a.label + ", " + surfRange(a.feet) : ""));
      g.setAttribute("aria-pressed", s.id === state.spot ? "true" : "false");
    });
    var i = spotIndex(state.spot);
    ui.dial.hidden = !data || i < 0;
    if (data && i >= 0) {
      var c = data.spots[i].c[state.t];
      clear(ui.dial);
      ui.dial.appendChild(el("div", { class: "surf-dial-row" }, [arrow(c.swellDirection || 0),
        el("span", {}, [el("strong", { text: "Swell " }), ft(c.swellHeight || 0) + " · " + Math.round(c.swellPeriod || 0) + " s · " + compass(c.swellDirection || 0)])]));
      ui.dial.appendChild(el("div", { class: "surf-dial-row" }, [arrow(c.windDirection || 0),
        el("span", {}, [el("strong", { text: "Wind " }), Math.round(c.windSpeed || 0) + " mph · " + compass(c.windDirection || 0)])]));
    }
  }
  function stat(label, value, note, title) {
    return el("div", { class: "surf-stat", title: title || null }, [el("dt", { text: label }), el("dd", {}, [value, note ? el("small", { text: note }) : null])]);
  }
  function renderPanel() {
    var host = ui.panel, i = spotIndex(state.spot), s = spots[i];
    clear(host);
    if (!s) { host.appendChild(el("p", { class: "dash-empty", text: "Pick a spot on the map." })); return; }
    host.appendChild(el("h3", { class: "surf-spot-name", text: s.name }));
    host.appendChild(el("p", { class: "surf-spot-type", text: s.type + " · faces " + compass(s.faces) }));
    if (!data) { host.appendChild(el("p", { class: "surf-about", text: s.about })); return; }
    var d = data.spots[i], a = at(i), c = d.c[state.t], t = state.t, lv = level();
    host.appendChild(el("div", { class: "surf-verdict " + bandClass(a) }, [
      el("span", { class: "surf-score", text: a.score.toFixed(1) }), el("span", { class: "surf-outof", text: "/ 10" }), chip(a)]));
    host.appendChild(el("p", { class: "surf-reason", text: a.reason }));
    var tide = tideState(d.tide, t);
    host.appendChild(el("dl", { class: "surf-stats" }, [
      stat("Surf", surfRange(a.feet), "", "About " + (a.feet / FT).toFixed(1) + " m, estimated at the beach"),
      stat("Swell", ft(c.swellHeight || 0), Math.round(c.swellPeriod || 0) + " s from " + compass(c.swellDirection || 0), (c.swellHeight || 0).toFixed(1) + " m offshore"),
      stat("Wind", Math.round(c.windSpeed || 0) + " mph", a.side + ", from " + compass(c.windDirection || 0) + ", gusts " + Math.round(d.gust[t] || 0), "Gusts in mph"),
      stat("Tide", tide.level || "–", tide.trend, num(d.tide[t]) ? d.tide[t].toFixed(1) + " m against mean sea level. Shown, but not part of the score." : ""),
      stat("Sea", num(d.sea[t]) ? Math.round(d.sea[t]) + " °C" : "–", "water temperature"),
      stat("Air", num(d.air[t]) ? Math.round(d.air[t]) + " °C" : "–", d.daylight[t] ? "daylight" : "dark")]));

    host.appendChild(el("div", { class: "surf-block-label", text: "Score by level" }));
    var bars = el("div", { class: "surf-levels" });
    host.appendChild(bars);
    M.bars(bars, LEVELS.map(function (l) {
      var x = d.a[l.id][t];
      return { label: l.label, value: x.score, display: x.score.toFixed(1), cls: "surf-fill band-" + x.band, on: l.id === state.level,
               tip: l.label + ": " + x.score.toFixed(1) + ", " + x.label + ". " + x.reason, onClick: function () { setLevel(l.id); } };
    }), { max: 10, track: true });

    // the chosen day, hour by hour
    var day = dayOf(t), scores = d.a[lv.id].map(function (x) { return x.score; }), best = bestHour(scores, d.daylight, day.from, day.to);
    host.appendChild(el("div", { class: "surf-block-label" }, [day.label + ", hour by hour",
      best >= 0 && scores[best] > 0 ? el("span", { class: "surf-best", text: "best " + data.hours[best].slice(11, 16) + " (" + scores[best].toFixed(1) + ")" }) : null]));
    var strip = el("div", { class: "surf-hours", role: "group", "aria-label": "Scores for each hour of " + day.label });
    for (var h = day.from; h < day.to; h++) (function (h) {
      var x = d.a[lv.id][h];
      strip.appendChild(el("button", { type: "button", class: "surf-hour " + bandClass(x) + (h === t ? " is-on" : "") + (d.daylight[h] ? "" : " is-night"),
        title: data.hours[h].slice(11, 16) + " · " + x.score.toFixed(1) + " " + x.label + " · " + surfRange(x.feet),
        "aria-label": data.hours[h].slice(11, 16) + ", " + x.score.toFixed(1) + ", " + x.label, onclick: function () { setTime(h); } },
        [el("span", { style: "height:" + Math.max(6, x.score * 10) + "%" })]));
    })(h);
    host.appendChild(strip);
    host.appendChild(el("div", { class: "surf-hours-axis", "aria-hidden": "true" }, ["00", "06", "12", "18", "23"].map(function (x) { return el("span", { text: x }); })));
    host.appendChild(el("p", { class: "surf-about", text: s.about }));
  }
  function renderTime() {
    var t = state.t, when = t === data.now ? "Now" : t < data.now ? "Past" : "Forecast";
    clear(ui.title);
    ui.title.appendChild(document.createTextNode(fmtHour(data.hours[t]) + " "));
    ui.title.appendChild(el("span", { class: "surf-when is-" + when.toLowerCase(), text: when }));
    ui.slider.value = String(t);
    ui.slider.setAttribute("aria-valuetext", fmtHour(data.hours[t]));
    var day = dayOf(t);
    data.days.forEach(function (d, i) { ui.dayButtons[i].classList.toggle("is-active", d === day); ui.dayButtons[i].setAttribute("aria-pressed", d === day ? "true" : "false"); });
    ui.nowButton.disabled = t === data.now;
  }
  var tableSort = { key: "score", dir: -1 };
  function renderTable() {
    var t = state.t;
    ui.tableTitle.textContent = "Best spots for " + level().plural + ", " + fmtHour(data.hours[t]);
    M.sortable(ui.table, tableSort, [
      { key: "name", label: "Spot", cell: function (r) {
          return el("button", { type: "button", class: "surf-link" + (r.s.id === state.spot ? " is-on" : ""), text: r.s.name, onclick: function () { select(r.s.id, true); } }); } },
      { key: "score", label: "Score", num: true, cell: function (r) { return el("span", { class: "surf-cell-score" }, [r.a.score.toFixed(1) + " ", chip(r.a)]); } },
      { key: "feet", label: "Surf", num: true, cell: function (r) { return el("span", { title: "About " + (r.a.feet / FT).toFixed(1) + " m", text: surfRange(r.a.feet) }); } },
      { key: "swell", label: "Swell", cell: function (r) { return ft(r.c.swellHeight || 0) + " · " + Math.round(r.c.swellPeriod || 0) + " s · " + compass(r.c.swellDirection || 0); } },
      { key: "wind", label: "Wind", cell: function (r) { return Math.round(r.c.windSpeed || 0) + " mph " + compass(r.c.windDirection || 0) + " · " + r.a.side; } },
      { key: "tide", label: "Tide", cell: function (r) { return r.tideText || "–"; } }
    ], spots.map(function (s, i) {
      var a = at(i), c = data.spots[i].c[t];
      var tide = tideState(data.spots[i].tide, t);
      return { s: s, a: a, c: c, tide: data.spots[i].tide[t], tideText: tide.level ? tide.level + ", " + tide.trend : "", _tie: s.name, name: s.name, score: a.score, feet: a.feet, swell: c.swellHeight || 0, wind: c.windSpeed || 0 };
    }), { height: "none", onSort: renderTable, empty: "No spots." });
  }
  function renderWeek() {
    clear(ui.week);
    var days = data.days.filter(function (d) { return !d.past; });
    var head = el("tr", {}, [el("th", { scope: "col", text: "Spot" })].concat(days.map(function (d) { return el("th", { scope: "col", text: d.label }); })));
    var body = el("tbody", {}, spots.map(function (s, i) {
      var d = data.spots[i], scores = d.a[state.level].map(function (x) { return x.score; });
      return el("tr", { class: s.id === state.spot ? "is-on" : null }, [
        el("th", { scope: "row" }, [el("button", { type: "button", class: "surf-link" + (s.id === state.spot ? " is-on" : ""), text: s.name, onclick: function () { select(s.id, true); } })])
      ].concat(days.map(function (day) {
        var h = bestHour(scores, d.daylight, day.from, day.to), x = d.a[state.level][h];
        return el("td", {}, [el("button", { type: "button", class: "surf-cell " + bandClass(x) + (s.id === state.spot && h === state.t ? " is-on" : ""),
          title: s.name + ", " + day.label + ": best at " + data.hours[h].slice(11, 16) + ", " + x.score.toFixed(1) + " " + x.label + ", " + surfRange(x.feet),
          "aria-label": s.name + ", " + day.label + ": " + x.score.toFixed(1) + ", " + x.label, text: String(Math.round(x.score)),
          onclick: function () { state.spot = s.id; setTime(h); ui.wrap.scrollIntoView({ behavior: "smooth", block: "nearest" }); } })]);
      })));
    }));
    ui.week.appendChild(el("div", { class: "surf-week-wrap" }, [el("table", { class: "surf-week" }, [el("thead", {}, [head]), body])]));
  }
  function render() {
    LEVELS.forEach(function (l) { var on = l.id === state.level; ui.levelButtons[l.id].classList.toggle("is-active", on); ui.levelButtons[l.id].setAttribute("aria-pressed", on ? "true" : "false"); });
    renderMap(); renderPanel();
    if (data) { renderTime(); renderTable(); renderWeek(); }
    writeState();
  }
  function select(id, show) { state.spot = id; render(); if (show) ui.wrap.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  function setLevel(id) { state.level = id; render(); }
  function setTime(t, playing) { if (!playing) stop(); state.t = clamp(t, 0, data.hours.length - 1); state.timeSet = state.t !== data.now; render(); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } if (ui.play) { ui.play.textContent = "▶ Play"; ui.play.setAttribute("aria-pressed", "false"); } }
  function play() {
    if (timer) { stop(); return; }
    if (state.t >= data.hours.length - 1) state.t = data.now;
    ui.play.textContent = "❚❚ Pause"; ui.play.setAttribute("aria-pressed", "true");
    timer = setInterval(function () { if (state.t >= data.hours.length - 1) stop(); else setTime(state.t + 1, true); }, 450);
  }

  // ---- page shell
  function build() {
    clear(app);
    var bar = M.heroControls() || app.appendChild(el("div", { class: "surf-hero-controls" }));
    ui.levelButtons = {};
    bar.appendChild(el("div", { class: "rpt-tabs", role: "group", "aria-label": "Ability level" }, LEVELS.map(function (l) {
      return (ui.levelButtons[l.id] = el("button", { type: "button", text: l.label, onclick: function () { setLevel(l.id); } }));
    })));
    var canvas = el("div", { class: "rpt-canvas" });
    app.appendChild(canvas);
    var card = M.visual(canvas, "Loading the forecast…", { span: 12, cls: "surf-card" });
    ui.title = card.parentNode.querySelector("h3");
    var left = el("div", { class: "surf-left" }), main = el("div", { class: "surf-main" }, [left]);
    card.appendChild(main);
    buildMap(left);
    ui.panel = el("aside", { class: "surf-panel", "aria-live": "polite" });
    main.appendChild(ui.panel);
    ui.timebar = el("div", { class: "surf-time", hidden: "" });
    left.appendChild(ui.timebar);
    left.appendChild(el("div", { class: "surf-legend" }, [el("span", { class: "rpt-hint", text: "Score out of 10:" })].concat(BANDS.map(function (b, i) {
      return el("span", { class: "surf-chip band-" + i, text: b.label + (i > 1 ? " " + b.from + "+" : "") });
    })).concat([el("span", { class: "surf-chip band-0 is-toobig" }, [el("span", { class: "surf-warn", "aria-hidden": "true", text: "⚠" }), "Too big"])])));
    ui.tableTitle = null;
    ui.table = M.visual(canvas, "Best spots", { span: 12, sub: "Every spot at the chosen time, best first. Click a heading to sort, or a spot to show it on the map." });
    ui.tableTitle = ui.table.parentNode.querySelector("h3");
    ui.week = M.visual(canvas, "Week ahead", { span: 12, sub: "Each day's best score in daylight for the chosen level. Click a number to jump to that spot and hour." });
    app.appendChild(el("p", { class: "rpt-hint surf-credit" }, [
      "Weather and marine data from ", el("a", { href: "https://open-meteo.com/", target: "_blank", rel: "noopener", text: "Open-Meteo" }), " (CC BY 4.0). ",
      coast.credit + " ", "Scores are a guide worked out from forecast models, not a safety service: check the sea when you get there and follow the lifeguards' advice."]));
  }
  function buildTime() {
    clear(ui.timebar);
    ui.dayButtons = data.days.map(function (d) {
      return el("button", { type: "button", class: "surf-day" + (d.past ? " is-past" : ""), text: d.label, title: d.past ? "Earlier: what the conditions were" : null,
        onclick: function () { var hour = state.t - dayOf(state.t).from; setTime(d.label === "Today" ? data.now : Math.min(d.from + hour, d.to - 1)); } });
    });
    ui.slider = el("input", { type: "range", class: "surf-slider", min: "0", max: String(data.hours.length - 1), step: "1", "aria-label": "Time" });
    ui.slider.addEventListener("input", function () { setTime(+ui.slider.value); });
    ui.nowButton = el("button", { type: "button", class: "rpt-data-btn", text: "Now", onclick: function () { setTime(data.now); } });
    ui.play = el("button", { type: "button", class: "rpt-data-btn", text: "▶ Play", "aria-pressed": "false", title: "Step through the hours", onclick: play });
    ui.timebar.appendChild(el("div", { class: "surf-days", role: "group", "aria-label": "Day" }, ui.dayButtons));
    ui.timebar.appendChild(el("div", { class: "surf-slider-row" }, [ui.nowButton, ui.play, ui.slider]));
    ui.timebar.hidden = false;
  }
  function loadForecast() {
    ui.status.hidden = false; clear(ui.status); ui.status.appendChild(document.createTextNode("Loading the forecast…"));
    fetchForecast().then(function (raw) {
      data = digest(raw);
      var wanted = data.hours.indexOf(state.wantTime);
      state.t = wanted >= 0 ? wanted : data.now; state.timeSet = wanted >= 0 && wanted !== data.now;
      if (!state.spot) {   // start on the best spot right now for the chosen level
        var best = 0;
        spots.forEach(function (s, i) { if (at(i).score > at(best).score) best = i; });
        state.spot = spots[best].id;
      }
      ui.status.hidden = true;
      buildTime(); render();
    }).catch(function (e) {
      clear(ui.status);
      ui.title.textContent = "Forecast not loaded";
      ui.status.appendChild(document.createTextNode("Could not load the forecast: " + (e && e.message ? e.message : "no answer") + ". "));
      ui.status.appendChild(el("button", { type: "button", class: "rpt-data-btn", text: "Try again", onclick: loadForecast }));
    });
  }

  M.ready(function () {
    app = document.getElementById("surf-app");
    if (!app) return;
    root = app.getAttribute("data-root") || "";
    Promise.all(["surf-spots", "surf-coast"].map(function (n) {
      return fetch(root + "assets/" + n + ".json").then(function (r) { if (!r.ok) throw new Error(n + ".json " + r.status); return r.json(); });
    })).then(function (d) {
      places = d[0]; spots = places.spots; coast = d[1];
      readState(); build(); render(); loadForecast();
    }).catch(function (e) { clear(app); app.appendChild(el("p", { class: "dash-empty", text: "Could not load the map: " + e.message })); });
  });
})();

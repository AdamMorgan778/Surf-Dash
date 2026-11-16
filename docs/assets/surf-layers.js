// Surf forecast map layers: wind, swell, rain and temperature drawn over the map (see surf.js, which owns the page).
// The forecast comes as values at a grid of points covering the map; this turns them into a smooth field and draws it
// on canvases that sit between the land and the spot markers:
//   wind         thin streaks that flow the way the wind blows, faster and brighter where it is stronger
//   swell        wave-crest lines rolling the way the swell travels, over the sea only, longer where it is bigger
//   rain         slanted dashes where it is raining, denser where it is heavier
//   temperature  a colour wash over the land from pale (cold) to warm orange (mild)
// It knows nothing about scoring. The field maths at the top has no browser dependencies, so tests/surf.test.js
// runs it in Node.
(function () {
  "use strict";
  var RAD = Math.PI / 180;
  function num(v) { return typeof v === "number" && isFinite(v); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // The grid's points, row by row from the north-west corner. bbox is [west, south, east, north].
  function gridPoints(bbox, cols, rows) {
    var out = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      out.push({ lat: bbox[3] - (bbox[3] - bbox[1]) * r / (rows - 1), lon: bbox[0] + (bbox[2] - bbox[0]) * c / (cols - 1) });
    }
    return out;
  }
  // The value at a place between grid points: fx columns across and fy rows down, blended from the four points
  // around it. A point with no value is left out of the blend; null if none of the four has one.
  function sample(values, cols, rows, fx, fy) {
    fx = clamp(fx, 0, cols - 1); fy = clamp(fy, 0, rows - 1);
    var c0 = Math.min(Math.floor(fx), cols - 2), r0 = Math.min(Math.floor(fy), rows - 2), tx = fx - c0, ty = fy - r0, sum = 0, weight = 0;
    for (var dr = 0; dr < 2; dr++) for (var dc = 0; dc < 2; dc++) {
      var v = values[(r0 + dr) * cols + c0 + dc], w = (dc ? tx : 1 - tx) * (dr ? ty : 1 - ty);
      if (num(v) && w > 0) { sum += v * w; weight += w; }
    }
    return weight > 0 ? sum / weight : null;
  }
  // Wind and swell are named for where they come FROM. This is the way they travel on the map: [east, south].
  function travel(speed, from) { var a = (from + 180) * RAD; return [speed * Math.sin(a), -speed * Math.cos(a)]; }
  // ...and back: the compass bearing something travelling [east, south] comes from.
  function bearing(east, south) { return ((Math.atan2(east, -south) / RAD + 180) % 360 + 360) % 360; }
  // Lowest and highest of some lists of values, ignoring gaps. -> [lo, hi] or null
  function extent(lists) {
    var lo = Infinity, hi = -Infinity;
    lists.forEach(function (list) { for (var i = 0; i < list.length; i++) if (num(list[i])) { if (list[i] < lo) lo = list[i]; if (list[i] > hi) hi = list[i]; } });
    return lo <= hi ? [lo, hi] : null;
  }
  // A steady pseudo-random number from 0 to 1 for a pair of whole numbers, so textures do not flicker between frames.
  function hash(i, j) { var h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h % 10007) / 10007; }
  // The temperature wash: one hue, pale for the cold end to deep orange for the warm end. f is 0 to 1. -> [r, g, b]
  // (Checked with the dataviz palette validator as a one-hue ramp against the map's sea colour.)
  var WASH = [[255, 232, 210], [255, 197, 150], [248, 155, 76], [218, 115, 0], [169, 79, 0]];
  function washColour(f) {
    var x = clamp(f, 0, 1) * (WASH.length - 1), i = Math.min(Math.floor(x), WASH.length - 2), t = x - i;
    return [0, 1, 2].map(function (k) { return Math.round(WASH[i][k] + (WASH[i + 1][k] - WASH[i][k]) * t); });
  }

  var pure = { gridPoints: gridPoints, sample: sample, travel: travel, bearing: bearing, extent: extent, hash: hash, washColour: washColour, WASH: WASH };
  if (typeof module === "object" && module.exports) module.exports = pure;
  if (typeof document === "undefined") return;

  // ===================================================================================================  drawing
  // o: {host (the map's box), before (node the canvases go in front of), width, height (the map's own units),
  //     land: [[[x, y], ...], ...] in map units}
  function create(o) {
    var W = o.width, H = o.height;
    function canvas() { var c = document.createElement("canvas"); c.className = "surf-layer"; c.setAttribute("aria-hidden", "true"); o.host.insertBefore(c, o.before); return c; }
    var fieldC = canvas(), swellC = canvas(), windC = canvas();
    var fctx = fieldC.getContext("2d"), sctx = swellC.getContext("2d"), wctx = windC.getContext("2d");
    var on = { wind: false, swell: false, rain: false, temp: false }, grid = null, snap = null, t = 0;
    var view = { x: 0, y: 0, w: W, h: H }, px = { w: 0, h: 0, dpr: 1, s: 1 };   // s: screen pixels per map unit
    var particles = [], crests = [], frame = 0, last = 0, seen = true, washAt = -1;
    var motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
    var wash = document.createElement("canvas");
    wash.width = 72; wash.height = Math.max(2, Math.round(72 * H / W));

    // the land, as a shape to cut the swell out with and a coarse yes/no map for "is this point on land?"
    var landPath = new Path2D();
    o.land.forEach(function (ring) { ring.forEach(function (p, i) { if (i) landPath.lineTo(p[0], p[1]); else landPath.moveTo(p[0], p[1]); }); landPath.closePath(); });
    var MW = 260, MH = Math.round(MW * H / W), mask = (function () {
      var c = document.createElement("canvas"); c.width = MW; c.height = MH;
      var x = c.getContext("2d"); x.scale(MW / W, MH / H); x.fill(landPath);
      var d = x.getImageData(0, 0, MW, MH).data, m = new Uint8Array(MW * MH);
      for (var i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
      return m;
    })();
    function isLand(x, y) { return mask[clamp(Math.floor(y / H * MH), 0, MH - 1) * MW + clamp(Math.floor(x / W * MW), 0, MW - 1)] === 1; }

    function colours() {   // from the stylesheet, so light and dark each get their own
      var css = getComputedStyle(o.host);
      function rgb(name, fallback) { return (css.getPropertyValue(name) || "").trim() || fallback; }
      return { streakSea: rgb("--layer-streak-sea", "255,255,255"), streakLand: rgb("--layer-streak-land", "11,58,91"),
               rainSea: rgb("--layer-rain-sea", "191,219,254"), rainLand: rgb("--layer-rain-land", "14,116,144"), swell: rgb("--layer-swell", "165,243,252") };
    }
    function value(list, x, y) { return sample(list, grid.cols, grid.rows, x / W * (grid.cols - 1), y / H * (grid.rows - 1)); }
    function mapX(sx) { return view.x + sx / px.s; }
    function mapY(sy) { return view.y + sy / px.s; }

    // the grid's values at hour t: wind and swell as travel components, so they blend without a compass wrapping round
    function snapshot() {
      if (!grid) { snap = null; return; }
      var n = grid.cols * grid.rows, s = { u: [], v: [], rain: [], temp: [], sh: [], su: [], sv: [] };
      for (var p = 0; p < n; p++) {
        var speed = grid.windSpeed[p] && grid.windSpeed[p][t], dir = grid.windDir[p] && grid.windDir[p][t];
        var w = num(speed) && num(dir) ? travel(speed, dir) : [null, null];
        s.u.push(w[0]); s.v.push(w[1]);
        s.rain.push(grid.rain[p] ? grid.rain[p][t] : null); s.temp.push(grid.temp[p] ? grid.temp[p][t] : null);
        var h = grid.swell[p] && grid.swell[p][t], sd = grid.swellDir[p] && grid.swellDir[p][t], d = num(h) && num(sd) ? travel(1, sd) : [null, null];
        s.sh.push(num(h) && num(sd) ? h : null); s.su.push(d[0]); s.sv.push(d[1]);
      }
      snap = s; washAt = -1;
    }

    function size() {
      var w = o.host.clientWidth, h = o.host.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w === px.w && h === px.h && dpr === px.dpr) return false;
      px.w = w; px.h = h; px.dpr = dpr;
      [fieldC, swellC, windC].forEach(function (c) { c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); });
      [fctx, sctx, wctx].forEach(function (c) { c.setTransform(dpr, 0, 0, dpr, 0, 0); });   // resizing a canvas resets its scale
      return true;
    }
    function wipe(ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.setTransform(px.dpr, 0, 0, px.dpr, 0, 0); }

    // ---- the still parts: temperature wash, rain dashes, and arrows in place of movement for reduced motion
    function drawField() {
      wipe(fctx);
      if (!snap || !px.w) return;
      var col = colours();
      if (on.temp && grid.tempRange) {
        if (washAt !== t) {
          var wc = wash.getContext("2d"), img = wc.createImageData(wash.width, wash.height), lo = grid.tempRange[0], span = (grid.tempRange[1] - lo) || 1;
          for (var j = 0; j < wash.height; j++) for (var i = 0; i < wash.width; i++) {
            var v = value(snap.temp, (i + 0.5) / wash.width * W, (j + 0.5) / wash.height * H), k = (j * wash.width + i) * 4;
            if (!num(v)) continue;
            var c = washColour((v - lo) / span);
            img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
          }
          wc.putImageData(img, 0, 0); washAt = t;
        }
        // on the land only: over the sea it muddies the water and hides the coastline
        fctx.save();
        fctx.setTransform(px.dpr * px.s, 0, 0, px.dpr * px.s, -view.x * px.s * px.dpr, -view.y * px.s * px.dpr);
        fctx.clip(landPath);
        fctx.setTransform(px.dpr, 0, 0, px.dpr, 0, 0);
        fctx.globalAlpha = 0.8; fctx.imageSmoothingEnabled = true; fctx.imageSmoothingQuality = "high";
        fctx.drawImage(wash, -view.x * px.s, -view.y * px.s, W * px.s, H * px.s);
        fctx.restore();
      }
      if (on.rain) {
        var step = 11 / px.s;   // one dash position about every 11 screen pixels, fixed to the map so it does not swim
        fctx.lineCap = "round"; fctx.lineWidth = 1.5;
        for (var gy = Math.floor(view.y / step); gy <= Math.ceil((view.y + view.h) / step); gy++) {
          for (var gx = Math.floor(view.x / step); gx <= Math.ceil((view.x + view.w) / step); gx++) {
            var x = (gx + hash(gx, gy) * 0.7) * step, y = (gy + hash(gy, gx) * 0.7) * step, r = value(snap.rain, x, y);
            if (!num(r) || r < 0.1 || hash(gx + 7, gy - 3) > (r < 0.5 ? 0.4 : r < 2 ? 0.75 : 1)) continue;
            var sx = (x - view.x) * px.s, sy = (y - view.y) * px.s, len = 5 + Math.min(6, r * 2);
            fctx.strokeStyle = "rgba(" + (isLand(x, y) ? col.rainLand : col.rainSea) + "," + Math.min(0.95, 0.6 + r * 0.15).toFixed(2) + ")";
            fctx.beginPath(); fctx.moveTo(sx, sy); fctx.lineTo(sx - len * 0.38, sy + len); fctx.stroke();
          }
        }
      }
      if (!motion.matches) return;
      if (on.swell) crestsStill(col);
      if (on.wind) arrowsStill(col);
    }
    function arrowsStill(col) {
      var step = 46;
      fctx.lineCap = "round"; fctx.lineWidth = 1.6;
      for (var sy = step / 2; sy < px.h; sy += step) for (var sx = step / 2; sx < px.w; sx += step) {
        var x = mapX(sx), y = mapY(sy), u = value(snap.u, x, y), v = value(snap.v, x, y);
        if (!num(u) || !num(v)) continue;
        var speed = Math.hypot(u, v), len = 7 + Math.min(20, speed * 0.8), ux = u / (speed || 1), uy = v / (speed || 1);
        var x1 = sx + ux * len / 2, y1 = sy + uy * len / 2;
        fctx.strokeStyle = "rgba(" + (isLand(x, y) ? col.streakLand : col.streakSea) + ",0.85)";
        fctx.beginPath(); fctx.moveTo(sx - ux * len / 2, sy - uy * len / 2); fctx.lineTo(x1, y1);
        fctx.moveTo(x1 - (ux * 5 - uy * 3.5), y1 - (uy * 5 + ux * 3.5)); fctx.lineTo(x1, y1); fctx.lineTo(x1 - (ux * 5 + uy * 3.5), y1 - (uy * 5 - ux * 3.5));
        fctx.stroke();
      }
    }
    function crest(ctx, sx, sy, ux, uy, height, alpha, col) {   // a short bowed line across the way the swell is travelling
      var half = (10 + Math.min(22, height * 9)) / 2, bow = half * 0.42;
      ctx.strokeStyle = "rgba(" + col.swell + "," + alpha.toFixed(2) + ")";
      ctx.beginPath(); ctx.moveTo(sx - uy * half, sy + ux * half);
      ctx.quadraticCurveTo(sx + ux * bow, sy + uy * bow, sx + uy * half, sy - ux * half); ctx.stroke();
    }
    function crestsStill(col) {
      var step = 50;
      fctx.lineCap = "round"; fctx.lineWidth = 1.8;
      for (var sy = step / 2; sy < px.h; sy += step) for (var sx = step / 2; sx < px.w; sx += step) {
        var x = mapX(sx), y = mapY(sy), h = value(snap.sh, x, y), u = value(snap.su, x, y), v = value(snap.sv, x, y);
        if (isLand(x, y) || !num(h) || !num(u) || !num(v)) continue;
        var m = Math.hypot(u, v) || 1;
        crest(fctx, sx, sy, u / m, v / m, h, clamp(0.45 + h * 0.2, 0.45, 0.95), col);
      }
    }

    // ---- the moving parts
    function spawn(p, sea) {
      for (var tries = 0; tries < 12; tries++) {
        p.x = Math.random() * px.w; p.y = Math.random() * px.h;
        if (!sea || !isLand(mapX(p.x), mapY(p.y))) break;
      }
      p.age = 0; p.max = sea ? 150 + Math.random() * 130 : 45 + Math.random() * 70;
      return p;
    }
    function populate() {
      var area = px.w * px.h, nWind = on.wind ? clamp(Math.round(area / 520), 150, 1500) : 0, nSwell = on.swell ? clamp(Math.round(area / 3300), 40, 300) : 0;
      while (particles.length < nWind) { var p = spawn({}, false); p.age = Math.random() * p.max; particles.push(p); }
      particles.length = nWind;
      while (crests.length < nSwell) { var c = spawn({}, true); c.age = Math.random() * c.max; crests.push(c); }
      crests.length = nSwell;
    }
    function tick(now) {
      frame = 0;
      if (!running()) return;
      frame = requestAnimationFrame(tick);
      if (!seen || !snap || !px.w) return;
      var dt = Math.min(3, (now - (last || now)) / 16.7) || 1, col = colours();
      last = now;
      if (on.wind) {
        wctx.globalCompositeOperation = "destination-out"; wctx.fillStyle = "rgba(0,0,0," + Math.min(0.35, 0.085 * dt).toFixed(3) + ")"; wctx.fillRect(0, 0, px.w, px.h);
        wctx.globalCompositeOperation = "source-over"; wctx.lineWidth = 1.25; wctx.lineCap = "round";
        for (var i = 0; i < particles.length; i++) {
          var p = particles[i], x = mapX(p.x), y = mapY(p.y), u = value(snap.u, x, y), v = value(snap.v, x, y);
          if (!num(u) || !num(v) || p.age > p.max || p.x < -4 || p.y < -4 || p.x > px.w + 4 || p.y > px.h + 4) { spawn(p, false); continue; }
          var nx = p.x + u * 0.11 * dt, ny = p.y + v * 0.11 * dt, speed = Math.hypot(u, v);
          wctx.strokeStyle = "rgba(" + (isLand(x, y) ? col.streakLand : col.streakSea) + "," + clamp(0.3 + speed / 28, 0.3, 0.95).toFixed(2) + ")";
          wctx.beginPath(); wctx.moveTo(p.x, p.y); wctx.lineTo(nx, ny); wctx.stroke();
          p.x = nx; p.y = ny; p.age += dt;
        }
      }
      if (on.swell) {
        wipe(sctx); sctx.lineWidth = 1.9; sctx.lineCap = "round";
        for (var j = 0; j < crests.length; j++) {
          var c = crests[j], cx = mapX(c.x), cy = mapY(c.y), h = value(snap.sh, cx, cy), su = value(snap.su, cx, cy), sv = value(snap.sv, cx, cy);
          if (!num(h) || !num(su) || !num(sv) || c.age > c.max || isLand(cx, cy) || c.x < -20 || c.y < -20 || c.x > px.w + 20 || c.y > px.h + 20) { spawn(c, true); continue; }
          var m = Math.hypot(su, sv) || 1, ux = su / m, uy = sv / m;
          crest(sctx, c.x, c.y, ux, uy, h, Math.sin(Math.PI * c.age / c.max) * clamp(0.4 + h * 0.2, 0.4, 0.95), col);
          c.x += ux * 0.36 * dt; c.y += uy * 0.36 * dt; c.age += dt;
        }
        // nothing drawn over the land: crests near the shore are cut at the coast
        sctx.globalCompositeOperation = "destination-out";
        sctx.setTransform(px.dpr * px.s, 0, 0, px.dpr * px.s, -view.x * px.s * px.dpr, -view.y * px.s * px.dpr);
        sctx.fill(landPath);
        sctx.globalCompositeOperation = "source-over"; sctx.setTransform(px.dpr, 0, 0, px.dpr, 0, 0);
      }
    }
    function running() { return !!grid && !motion.matches && (on.wind || on.swell); }
    function refresh() {   // after anything changes: redraw the still parts, and start or stop the movement
      size();
      px.s = px.w / view.w;
      drawField();
      if (!on.wind || motion.matches) wipe(wctx);
      if (!on.swell || motion.matches) wipe(sctx);
      populate();
      if (running()) { if (!frame) { last = 0; frame = requestAnimationFrame(tick); } }
      else if (frame) { cancelAnimationFrame(frame); frame = 0; }
    }
    if (window.IntersectionObserver) new IntersectionObserver(function (e) { seen = e[e.length - 1].isIntersecting; }).observe(o.host);
    if (motion.addEventListener) motion.addEventListener("change", refresh);

    return {
      // g: {cols, rows, windSpeed, windDir, rain, temp, swell, swellDir}, each a list per grid point of a value per hour
      setData: function (g) { grid = g; grid.tempRange = extent(g.temp); snapshot(); refresh(); },
      set: function (flags) { var changed = false; Object.keys(on).forEach(function (k) { if (on[k] !== !!flags[k]) { on[k] = !!flags[k]; changed = true; } }); if (changed) refresh(); },
      setTime: function (hour) { if (hour === t) return; t = hour; snapshot(); refresh(); },
      setView: function (v) {
        var moved = v.x !== view.x || v.y !== view.y || v.w !== view.w;
        view = { x: v.x, y: v.y, w: v.w, h: v.h };
        if (!size() && !moved) return;
        wipe(wctx);   // the old streaks are in the wrong place now
        refresh();
      },
      // what the layers say at a point on the map (map units): {wind: {speed, from}, swell: {height, from}, rain, temp}
      readout: function (x, y) {
        if (!snap) return {};
        var u = value(snap.u, x, y), v = value(snap.v, x, y), h = value(snap.sh, x, y), su = value(snap.su, x, y), sv = value(snap.sv, x, y);
        return { wind: num(u) && num(v) ? { speed: Math.hypot(u, v), from: bearing(u, v) } : null,
                 swell: !isLand(x, y) && num(h) && num(su) && num(sv) ? { height: h, from: bearing(su, sv) } : null,
                 rain: value(snap.rain, x, y), temp: value(snap.temp, x, y) };
      },
      // the spread of each layer across the map at this hour, and of temperature over the whole forecast
      ranges: function () {
        if (!snap) return null;
        var speeds = snap.u.map(function (u, i) { return num(u) && num(snap.v[i]) ? Math.hypot(u, snap.v[i]) : null; });
        return { wind: extent([speeds]), swell: extent([snap.sh]), rain: extent([snap.rain]), temp: extent([snap.temp]), tempAll: grid.tempRange };
      },
      moving: function () { return !!frame; }
    };
  }
  create.gridPoints = gridPoints;
  window.ModelDocs.surfLayers = create;
})();

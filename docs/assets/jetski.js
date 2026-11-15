// Jetski: a small 2D race on a sine-wave sea. Ride the waves, launch off the crests, land level and reach the finish
// line. The course restarts by itself, forever. The final score is the points earned times the model's documentation
// coverage, read from data/summary.json, so a better documented model scores higher.
//
// The physics (createSim) knows nothing about the page, so tests/jetski.test.js runs it in Node. The rest draws the
// game on a canvas and reads the keyboard or touch buttons. Plain JavaScript, no libraries, nothing loaded from outside.
(function () {
  "use strict";

  // ---- the course and the physics
  var COURSE = 6000;        // length of the race, in world pixels
  var G = 1200;             // gravity, px/s^2
  var CFG = {
    throttle: 520,          // acceleration with the throttle held
    brake: 700,             // deceleration with the brake held
    drag: 0.6,              // fraction of speed lost per second
    top: 760,               // top speed on the water
    slopeG: 0.6,            // how much of gravity acts along a slope (the rest would make steep waves unclimbable)
    tilt: 3.2,              // rad/s the nose turns while up or down is held
    assist: 1.0,            // rad/s the nose drifts towards the direction of travel when no key is held
    minAir: 0.35,           // seconds in the air before a landing counts as a jump
    clean: 0.35,            // landing within this angle (rad, about 20 degrees) of the water is clean
    ok: 0.79,               // ...within this (about 45 degrees) is fine, beyond it is a crash
    countdown: 2,           // seconds of Ready and Set before Go
    finishHold: 4,          // seconds the result stays up before the course restarts
    timeBonusFrom: 120      // seconds: finishing quicker than this earns (120 - seconds) * 20 points
  };

  // Water height at x (up is positive): two sine waves that grow along the course.
  function amp(x) { return 0.7 + 0.9 * Math.min(Math.max(x, 0) / COURSE, 1); }
  function height(x) { return amp(x) * (34 * Math.sin(x / 130) + 18 * Math.sin(x / 55 + 1.3)); }
  function slope(x) { return height(x + 0.5) - height(x - 0.5); }
  function surfaceAngle(x) { return Math.atan(slope(x)); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function createSim(onEvent) {
    var sim = { multiplier: 1 };
    function emit(type, data) { if (onEvent) onEvent(type, data || {}); }

    sim.reset = function () {
      sim.phase = "countdown";   // countdown -> race -> finish -> countdown ...
      sim.e = 0;                 // seconds in this phase
      sim.t = 0;                 // race time
      sim.x = 0; sim.y = height(0);
      sim.speed = 0;             // along the water
      sim.vx = 0; sim.vy = 0;    // in the air
      sim.angle = surfaceAngle(0);
      sim.air = false; sim.airTime = 0;
      sim.points = 0;
      sim.counts = { clean: 0, ok: 0, crash: 0 };
      sim.result = null;
    };

    function land() {
      var th = surfaceAngle(sim.x), rel = Math.abs(sim.angle - th);
      var sp = sim.vx * Math.cos(th) + sim.vy * Math.sin(th);
      var kind = "hop", gain = 0;
      sim.y = height(sim.x);
      sim.air = false;
      if (sim.airTime >= CFG.minAir) {
        if (rel <= CFG.clean) { kind = "clean"; sp = sp * 1.08 + 40; gain = 100; }
        else if (rel <= CFG.ok) { kind = "ok"; gain = 40; }
        else { kind = "crash"; sp *= 0.45; }
        if (kind !== "crash") gain += 10 * sim.airTime;
        if (sim.phase === "race") { sim.points += gain; sim.counts[kind]++; }
      }
      sim.speed = clamp(sp, kind === "crash" ? 30 : 60, CFG.top * 1.15);
      emit("land", { kind: kind, rel: rel, airTime: sim.airTime, gain: gain, x: sim.x, y: sim.y, speed: sim.speed });
      sim.airTime = 0;
    }

    function finish() {
      var bonus = Math.max(0, CFG.timeBonusFrom - sim.t) * 20;
      var total = sim.points + bonus;
      sim.phase = "finish"; sim.e = 0;
      sim.result = { time: sim.t, points: sim.points, bonus: bonus, total: total, multiplier: sim.multiplier,
                     score: Math.round(total * sim.multiplier), counts: sim.counts };
      emit("finish", sim.result);
    }

    function physics(dt, input) {
      var racing = sim.phase === "race";
      var thr = racing && input.throttle ? 1 : 0, brk = racing && input.brake ? 1 : 0, tilt = racing ? (input.tilt || 0) : 0;
      if (!sim.air) {
        var th = Math.atan(slope(sim.x));
        sim.speed += (thr * CFG.throttle - brk * CFG.brake - CFG.drag * sim.speed - CFG.slopeG * G * Math.sin(th)) * dt;
        sim.speed = clamp(sim.speed, 0, CFG.top);
        var nx = sim.x + sim.speed * Math.cos(th) * dt;
        var yb = sim.y + sim.speed * Math.sin(th) * dt - 0.5 * G * dt * dt;   // where free fall would put us
        var hs = height(nx);
        if (yb > hs && sim.speed > 0) {                                        // the water falls away faster than we do: take off
          sim.air = true; sim.airTime = 0;
          sim.vx = sim.speed * Math.cos(th); sim.vy = sim.speed * Math.sin(th) - G * dt;
          sim.x = nx; sim.y = yb;
          emit("launch", { speed: sim.speed });
        } else {
          sim.x = nx; sim.y = hs;
          sim.angle += (surfaceAngle(nx) - sim.angle) * Math.min(1, dt * 14);
        }
      } else {
        sim.airTime += dt;
        sim.vy -= G * dt; sim.x += sim.vx * dt; sim.y += sim.vy * dt;
        if (tilt) sim.angle += tilt * CFG.tilt * dt;
        else sim.angle += clamp(Math.atan2(sim.vy, sim.vx) - sim.angle, -CFG.assist * dt, CFG.assist * dt);
        sim.angle = clamp(sim.angle, -2.4, 2.4);
        if (sim.y <= height(sim.x)) land();
      }
      if (racing) {
        sim.t += dt;
        if (sim.x >= COURSE) finish();
      }
    }

    // Advance by dt seconds in fixed small steps. input: {throttle, brake, tilt (+1 nose up, -1 nose down)}.
    sim.update = function (dt, input) {
      input = input || {};
      while (dt > 1e-9) {
        var h = Math.min(dt, 1 / 120);
        dt -= h;
        sim.e += h;
        if (sim.phase === "countdown") {
          if (sim.e >= CFG.countdown) { sim.phase = "race"; sim.e = 0; sim.t = 0; emit("go"); }
        } else {
          physics(h, input);
          if (sim.phase === "finish" && sim.e >= CFG.finishHold) { sim.reset(); emit("restart"); }
        }
      }
    };

    sim.reset();
    return sim;
  }

  if (typeof module === "object" && module.exports) {   // the Node tests
    module.exports = { createSim: createSim, height: height, slope: slope, surfaceAngle: surfaceAngle, COURSE: COURSE, G: G, CFG: CFG };
  }
  if (typeof document === "undefined") return;

  // ---- the page: drawing, input, scoring
  var W = 960, H = 540, AX = 260, AY = 360;   // drawing size, and where the jetski sits on screen
  var KEY = "jetski-best-v1";
  var NAVY = "#0B3954", TEAL = "#3FB8AF", DEEP = "#087E8B", CORAL = "#FF6B6B", SAND = "#F2C57C";

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k]; else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function fmtTime(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(2);
  }
  function fmtNum(n) { return Math.round(n).toLocaleString("en-US"); }
  function loadBest() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function saveBest(b) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) { /* private mode: lasts this visit */ } }

  function start(host) {
    var root = host.getAttribute("data-root") || "";
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var canvas = el("canvas", { class: "jetski-canvas", width: W, height: H, tabindex: "0", role: "img",
      "aria-label": "Jetski race game. Hold the right arrow to throttle, left to brake, up and down to tilt in the air. Land level with the wave to score." });
    var ctx = canvas.getContext("2d");
    var finishBox = el("div", { class: "jetski-finish", role: "status", "aria-live": "polite", hidden: "" });
    var stage = el("div", { class: "jetski-stage" }, [canvas, finishBox]);
    var touch = { throttle: false, brake: false, up: false, down: false };
    function holdButton(label, key, aria) {
      var b = el("button", { type: "button", class: "jetski-btn", "aria-label": aria, text: label });
      function on(e) { e.preventDefault(); touch[key] = true; b.classList.add("is-down"); }
      function off() { touch[key] = false; b.classList.remove("is-down"); }
      b.addEventListener("pointerdown", on);
      ["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { b.addEventListener(n, off); });
      return b;
    }
    var pad = el("div", { class: "jetski-touch" }, [
      el("div", {}, [holdButton("Brake", "brake", "Brake"), holdButton("▲", "up", "Tilt nose up"), holdButton("▼", "down", "Tilt nose down")]),
      el("div", {}, [holdButton("Throttle", "throttle", "Throttle")])]);
    host.textContent = "";
    host.appendChild(stage);
    host.appendChild(pad);

    var best = loadBest(), cov = { pct: null }, scale = 1;
    var particles = [], notes = [], shake = 0, clouds = [];
    for (var i = 0; i < 7; i++) clouds.push({ x: i * 190 + (i % 3) * 40, y: 36 + (i * 37) % 110, s: 0.7 + (i % 4) * 0.25 });

    var sim = createSim(function (type, d) {
      if (type === "land") {
        if (d.kind === "hop") return;
        splash(d.x, d.y, d.kind === "crash" ? 34 : 18, d.speed);
        notes.length = 0;   // one note at a time, so quick landings do not pile up
        notes.push({ text: d.kind === "clean" ? "Clean! +" + Math.round(d.gain) : d.kind === "ok" ? "OK +" + Math.round(d.gain) : "Crash",
                     color: d.kind === "clean" ? DEEP : d.kind === "ok" ? "#B07A00" : "#C93A3A", age: 0 });
        if (d.kind === "crash" && !reduced) shake = 0.3;
      } else if (type === "finish") {
        showFinish(d);
      } else if (type === "restart") {
        finishBox.hidden = true; particles.length = 0; notes.length = 0; cam.x = 0; cam.y = sim.y;
      }
    });
    var cam = { x: 0, y: sim.y, zoom: 1 };

    // the documentation coverage is the score multiplier
    fetch(root + "data/summary.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { cov.pct = j.score.pct; sim.multiplier = j.score.pct / 100; }).catch(function () { cov.pct = null; });

    function showFinish(r) {
      var prev = best.score || 0, newBest = r.score > prev;
      if (newBest) best = { score: r.score, pct: cov.pct, time: Math.min(r.time, best.time || Infinity) };
      else if (r.time < (best.time || Infinity)) best.time = r.time;
      saveBest(best);
      var sum = fmtNum(r.total) + " pts × " + (cov.pct === null ? "1.00 (coverage not loaded)" : cov.pct.toFixed(1) + "% docs") + " = ";
      finishBox.textContent = "";
      [el("strong", { text: "Finish! " + fmtTime(r.time) }), el("div", { class: "jetski-sum" }, [sum, el("strong", { text: fmtNum(r.score) })]),
       el("div", { text: (newBest ? "New best score! " : "Best score " + fmtNum(prev) + ". ") + (r.counts.clean + " clean, " + r.counts.ok + " ok, " + r.counts.crash + " crash.") }),
       el("a", { href: root + "documentation/", text: "Raise your multiplier: see what is missing" })].forEach(function (n) { finishBox.appendChild(n); });
      finishBox.hidden = false;
    }

    // ---- input
    var keys = {};
    var MAP = { ArrowRight: "throttle", KeyD: "throttle", ArrowLeft: "brake", KeyA: "brake", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down" };
    var paused = false;
    function typing(e) { var t = e.target && e.target.tagName; return t === "INPUT" || t === "TEXTAREA" || t === "SELECT"; }
    window.addEventListener("keydown", function (e) {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (MAP[e.code]) { keys[MAP[e.code]] = true; e.preventDefault(); }
      else if (e.code === "KeyP") paused = !paused;
      else if (e.code === "KeyR") { sim.reset(); finishBox.hidden = true; particles.length = 0; notes.length = 0; }
    });
    window.addEventListener("keyup", function (e) { if (MAP[e.code]) keys[MAP[e.code]] = false; });
    window.addEventListener("blur", function () { keys = {}; });
    function readInput() {
      var up = keys.up || touch.up, down = keys.down || touch.down;
      return { throttle: keys.throttle || touch.throttle, brake: keys.brake || touch.brake, tilt: (up ? 1 : 0) - (down ? 1 : 0) };
    }

    // ---- particles and notes
    function splash(x, y, n, speed) {
      var k = reduced ? Math.ceil(n / 3) : n;
      for (var i = 0; i < k; i++) {
        var a = Math.PI * (0.15 + 0.7 * Math.random());
        particles.push({ x: x, y: y, vx: Math.cos(a) * (60 + Math.random() * 160) + speed * 0.2, vy: Math.sin(a) * (120 + Math.random() * 260),
                         age: 0, life: 0.5 + Math.random() * 0.5, r: 2 + Math.random() * 3 });
      }
    }
    var sprayTick = 0;
    function updateParticles(dt) {
      if (!sim.air && sim.phase !== "countdown" && sim.speed > 120 && (++sprayTick % (reduced ? 4 : 2)) === 0) {
        var back = sim.x - Math.cos(sim.angle) * 30;
        particles.push({ x: back, y: height(back) + 4, vx: -sim.speed * 0.25 + (Math.random() - 0.5) * 40, vy: 50 + Math.random() * 110,
                         age: 0, life: 0.35 + Math.random() * 0.3, r: 1.5 + Math.random() * 2.5 });
      }
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.age += dt; p.vy -= 700 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.age >= p.life) particles.splice(i, 1);
      }
      for (var j = notes.length - 1; j >= 0; j--) { notes[j].age += dt; if (notes[j].age > 1.4) notes.splice(j, 1); }
      if (shake > 0) shake -= dt;
    }

    // ---- drawing
    function sx(wx) { return AX + (wx - cam.x) * cam.zoom; }
    function sy(wy) { return AY - (wy - cam.y) * cam.zoom; }

    function drawSky(now) {
      var g = ctx.createLinearGradient(0, 0, 0, 330);
      g.addColorStop(0, "#9FD3F0"); g.addColorStop(1, "#EAF6FB");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var sun = ctx.createRadialGradient(780, 96, 6, 780, 96, 90);
      sun.addColorStop(0, "rgba(255,244,214,1)"); sun.addColorStop(0.25, "rgba(255,236,184,0.9)"); sun.addColorStop(1, "rgba(255,236,184,0)");
      ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(780, 96, 90, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      clouds.forEach(function (c) {
        var x = ((c.x - cam.x * 0.08 - now * 6) % (W + 300) + W + 300) % (W + 300) - 150;
        [[0, 0, 46], [34, -8, 36], [-34, 6, 32], [66, 6, 28]].forEach(function (b) {
          ctx.beginPath(); ctx.ellipse(x + b[0] * c.s, c.y + b[1] * c.s, b[2] * c.s, b[2] * 0.55 * c.s, 0, 0, 7); ctx.fill();
        });
      });
      var hy = AY - 70 + cam.y * cam.zoom * 0.25;
      [[0.12, "rgba(140,201,196,0.55)", 0], [0.2, "rgba(99,176,172,0.6)", 1]].forEach(function (L) {
        ctx.fillStyle = L[1]; ctx.beginPath(); ctx.moveTo(0, H);
        for (var x = 0; x <= W; x += 8) {
          var u = cam.x * L[0] + x + L[2] * 300;
          ctx.lineTo(x, hy - L[2] * 6 - (30 + 24 * Math.sin(u / 140) + 14 * Math.sin(u / 57 + 2)));
        }
        ctx.lineTo(W, H); ctx.fill();
      });
    }
    function backWave(p, off, color, k) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, H);
      for (var x = 0; x <= W + 8; x += 8) {
        var u = cam.x * p + (x - AX) / cam.zoom;
        ctx.lineTo(x, AY + cam.y * cam.zoom * p - off + 12 * Math.sin(u / 95 + k) + 7 * Math.sin(u / 41 + k * 2));
      }
      ctx.lineTo(W, H); ctx.fill();
    }
    function drawWater(now) {
      backWave(0.55, 54, "rgba(63,184,175,0.45)", 1);
      backWave(0.78, 30, "rgba(8,126,139,0.5)", 3);
      var top = [];
      for (var x = -8; x <= W + 8; x += 6) top.push([x, sy(height(cam.x + (x - AX) / cam.zoom))]);
      var g = ctx.createLinearGradient(0, AY - 90, 0, H);
      g.addColorStop(0, "#3FB8AF"); g.addColorStop(0.45, "#087E8B"); g.addColorStop(1, "#0B3954");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(top[0][0], H);
      top.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
      ctx.lineTo(top[top.length - 1][0], H); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 2; ctx.beginPath();
      top.forEach(function (p, i) { var y = p[1] + 12 * cam.zoom + 2 * Math.sin(now * 2 + p[0] * 0.05); if (i) ctx.lineTo(p[0], y); else ctx.moveTo(p[0], y); });
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3; ctx.beginPath();
      top.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.stroke();
    }
    function drawGate(wx, label, checkered) {
      var l = sx(wx - 40), r = sx(wx + 40);
      if (r < -20 || l > W + 20) return;
      var base = sy(height(wx)), top = base - 200 * cam.zoom;
      ctx.strokeStyle = NAVY; ctx.lineWidth = 5; ctx.beginPath();
      ctx.moveTo(l, sy(height(wx - 40))); ctx.lineTo(l, top); ctx.moveTo(r, sy(height(wx + 40))); ctx.lineTo(r, top); ctx.stroke();
      var bw = r - l, bh = 44 * cam.zoom;
      if (checkered) {
        var n = 8, cw = bw / n, ch = bh / 2;
        for (var i = 0; i < n; i++) for (var j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? "#FFFFFF" : NAVY; ctx.fillRect(l + i * cw, top + j * ch, cw, ch); }
      } else { ctx.fillStyle = TEAL; ctx.fillRect(l, top, bw, bh); }
      ctx.fillStyle = checkered ? NAVY : "#FFFFFF"; ctx.font = "bold " + Math.round(15 * cam.zoom) + "px Roboto, system-ui, sans-serif"; ctx.textAlign = "center";
      if (!checkered) ctx.fillText(label, (l + r) / 2, top + bh * 0.68);
      else { ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fillRect((l + r) / 2 - 34 * cam.zoom, top + bh + 4, 68 * cam.zoom, 20 * cam.zoom);
             ctx.fillStyle = NAVY; ctx.fillText(label, (l + r) / 2, top + bh + 19 * cam.zoom); }
    }
    function drawParticles() {
      particles.forEach(function (p) {
        ctx.fillStyle = "rgba(255,255,255," + (0.85 * (1 - p.age / p.life)) + ")";
        ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.r * cam.zoom, 0, 7); ctx.fill();
      });
    }
    function drawJetski() {
      ctx.save();
      ctx.translate(sx(sim.x), sy(sim.y));
      ctx.scale(cam.zoom, cam.zoom);
      ctx.rotate(-sim.angle);
      ctx.fillStyle = NAVY; ctx.beginPath();            // hull
      ctx.moveTo(-30, -2); ctx.quadraticCurveTo(-33, -14, -22, -16); ctx.lineTo(12, -16);
      ctx.quadraticCurveTo(30, -14, 35, -6); ctx.quadraticCurveTo(30, 3, 18, 3); ctx.lineTo(-26, 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = TEAL; ctx.fillRect(-22, -16, 34, 5);   // deck stripe
      ctx.fillStyle = CORAL; ctx.fillRect(-16, -22, 20, 6);  // seat
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(24, -2); ctx.stroke();
      ctx.fillStyle = "rgba(190,230,245,0.9)"; ctx.beginPath(); ctx.moveTo(10, -16); ctx.lineTo(20, -28); ctx.lineTo(24, -27); ctx.lineTo(20, -16); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = NAVY; ctx.lineWidth = 6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-9, -22); ctx.lineTo(-6, -35); ctx.stroke();           // rider
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-6, -31); ctx.lineTo(14, -26); ctx.stroke();
      ctx.fillStyle = SAND; ctx.beginPath(); ctx.arc(-5, -42, 6.5, 0, 7); ctx.fill();
      ctx.restore();
    }
    function pill(x, y, w, h, align) {
      ctx.fillStyle = "rgba(255,255,255,0.72)"; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(align === "right" ? x - w : x, y, w, h, 10); else ctx.rect(align === "right" ? x - w : x, y, w, h);
      ctx.fill();
    }
    var hudScale = 1;   // the HUD is drawn larger when the canvas is shown small, so it stays readable on a phone
    function drawHud() {
      var k = hudScale, w = W / k, h = H / k;
      ctx.save(); ctx.scale(k, k);
      ctx.textBaseline = "alphabetic";
      pill(14, 12, 210, 64, "left");
      ctx.fillStyle = NAVY; ctx.textAlign = "left";
      ctx.font = "bold 22px Roboto, system-ui, sans-serif"; ctx.fillText(fmtTime(sim.t), 26, 40);
      ctx.font = "13px Roboto, system-ui, sans-serif";
      ctx.fillText(fmtNum(sim.points) + " pts × " + (cov.pct === null ? "1.00 docs (not loaded)" : (cov.pct / 100).toFixed(2) + " docs"), 26, 60);
      pill(w - 14, 12, 188, 64, "right");
      ctx.fillStyle = NAVY; ctx.textAlign = "right"; ctx.font = "13px Roboto, system-ui, sans-serif";
      ctx.fillText("Best " + (best.score ? fmtNum(best.score) + " pts" : "none yet"), w - 26, 36);
      ctx.fillText("Speed " + Math.round(sim.air ? Math.hypot(sim.vx, sim.vy) : sim.speed), w - 26, 58);
      var bx = w * 0.2, bwid = w * 0.6, frac = clamp(sim.x / COURSE, 0, 1);
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillRect(bx, h - 22, bwid, 8);
      ctx.fillStyle = TEAL; ctx.fillRect(bx, h - 22, bwid * frac, 8);
      ctx.fillStyle = NAVY; ctx.beginPath(); ctx.arc(bx + bwid * frac, h - 18, 7, 0, 7); ctx.fill();
      ctx.restore();
    }
    function bigText(text, color) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold 76px Roboto, system-ui, sans-serif";
      ctx.lineWidth = 8; ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.strokeText(text, W / 2, 190);
      ctx.fillStyle = color; ctx.fillText(text, W / 2, 190);
    }
    function draw(now) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      drawSky(now);
      drawWater(now);
      drawGate(0, "START", false);
      drawGate(COURSE, "FINISH", true);
      drawParticles();
      drawJetski();
      notes.forEach(function (n) {
        ctx.globalAlpha = 1 - n.age / 1.4; ctx.font = "bold 24px Roboto, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.lineWidth = 5; ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.strokeText(n.text, sx(sim.x), sy(sim.y) - 70 - n.age * 50); ctx.fillStyle = n.color; ctx.fillText(n.text, sx(sim.x), sy(sim.y) - 70 - n.age * 50);
        ctx.globalAlpha = 1;
      });
      ctx.restore();
      drawHud();
      if (sim.phase === "countdown") bigText(sim.e < 1 ? "Ready" : "Set", NAVY);
      else if (sim.phase === "race" && sim.t < 0.8) bigText("Go!", DEEP);
      if (paused) bigText("Paused", NAVY);
    }

    // ---- the loop: forever
    function resize() {
      var w = canvas.getBoundingClientRect().width || W, dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr * H / W); scale = canvas.width / W;
      hudScale = clamp(W / w * 0.62, 1, 1.9);
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener("resize", resize);

    var debug = { sim: sim, keys: keys, cam: cam, height: height, frozen: false };   // for the tests and screenshots
    var last = null;
    function frame(ts) {
      var now = ts / 1000, dt = last === null ? 0 : Math.min(0.05, now - last);
      last = now;
      if (!paused && !debug.frozen) {
        sim.update(dt, readInput());
        updateParticles(dt);
        var lift = sim.air ? sim.y - height(sim.x) : 0;
        var zoomTo = 1 - clamp(lift / 700, 0, 0.35), k = Math.min(1, dt * 4);
        cam.x = sim.x; cam.y += (sim.y - cam.y) * k; cam.zoom += (zoomTo - cam.zoom) * k;
      }
      draw(now);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.__jetski = debug;
  }

  function init() { var host = document.getElementById("jetski-game"); if (host) start(host); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

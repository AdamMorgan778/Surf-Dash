// Home page: a ride through the barrel of a wave. Scrolling forward carries the surfer down the line; at each of
// six stops a card shows one headline number about the project and links to the page behind it.
// The scene is drawn on a canvas from the scroll position (0 at the top, 1 at the end); nothing is stored and no
// libraries are used. Numbers come from data/summary.json. With reduced motion on, it is one still scene and a list.
(function () {
  "use strict";
  var NAVY = "#0B3954", DEEP = "#087E8B", FOAM = "#3FB8AF", SAND = "#F2C57C", CORAL = "#FF6B6B";
  var TAU = Math.PI * 2;

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k]; else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function mix(c1, c2, t) {   // "#rrggbb" x 2 -> "rgb()"
    var a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
    function ch(s) { return Math.round(lerp((a >> s) & 255, (b >> s) & 255, t)); }
    return "rgb(" + ch(16) + "," + ch(8) + "," + ch(0) + ")";
  }
  function num(n) { return Math.round(n).toLocaleString("en-US"); }

  // ---- the six stops
  function stops(s, issues, root) {
    var t = s.tables || [], sum = function (k) { return t.reduce(function (n, x) { return n + x[k]; }, 0); };
    var f = s.failures || { error: 0, warning: 0, info: 0 }, fails = f.error + f.warning + f.info;
    var bp = s.bestPractice || { pct: 0 }, w = s.work || { items: 0, people: 0, overlaps: 0 };
    var open = ((issues && issues.issues) || []).filter(function (i) { return i.state === "open"; }).length;
    var built = document.querySelector("time.site-built");
    return [
      { kicker: "The model", value: num(t.length), unit: "tables", text: num(sum("columns")) + " columns and " + num(sum("measures")) + " measures.",
        cta: "Open the data dictionary", href: root + "documentation/dictionary/" },
      { kicker: "Documentation", value: s.score.pct + "%", unit: "described", text: num(s.score.total - s.score.described) + " of " + num(s.score.total) + " tables, columns and measures still need a description.",
        cta: "See what is missing", href: root + "documentation/" },
      { kicker: "Best practice", value: bp.pct + "%", unit: "of checks pass", text: num(fails) + " failing: " + f.error + " error, " + f.warning + " warning, " + f.info + " info.",
        cta: "Open the best practice report", href: root + "rules/" },
      { kicker: "Work in progress", value: num(w.items), unit: w.items === 1 ? "item in hand" : "items in hand", text: num(w.people) + (w.people === 1 ? " person" : " people") + " working, " + num(w.overlaps) + (w.overlaps === 1 ? " overlap" : " overlaps") + " to sort out.",
        cta: "See who is changing what", href: root + "work/" },
      { kicker: "Issues", value: num(open), unit: open === 1 ? "open issue" : "open issues", text: "Requests, housekeeping and claims raised on GitHub.",
        cta: "Open the overview", href: root + "overview/" },
      { kicker: "Made it out", value: "Play", unit: "", text: "Paddle back out and race a jetski. " + (built ? "Site updated " + built.textContent + "." : ""),
        cta: "Play the game", href: root + "play/" }
    ];
  }

  // ---- drawing. Everything is laid out in a 1600 x 900 space and scaled to cover the canvas.
  var VW = 1600, VH = 900;
  var A0 = 1.22 * Math.PI, A1 = 2.76 * Math.PI;   // the water runs from the lip (upper left), over the top and right, to the floor
  var RINGS = 16;

  function scene(ctx, w, h, p, time, still) {
    var k = Math.max(w / VW, h / VH);
    // cover the canvas; on a narrow screen keep the surfer (around x = 960) in the middle instead of the scene's centre
    var tx = Math.min(0, Math.max(w - VW * k, w / 2 - 960 * k));
    ctx.setTransform(k, 0, 0, k, tx, (h - VH * k) / 2);
    var out = ease((p - 0.86) / 0.14);                 // 0 inside the barrel, 1 out in the open
    var wob = still ? 0 : Math.sin(time * 0.9);

    // what you see out of the open side: sky, sun, horizon, sea
    var sky = ctx.createLinearGradient(0, 0, 0, 520);
    sky.addColorStop(0, "#BFE3F5"); sky.addColorStop(1, "#F4FAFD");
    ctx.fillStyle = sky; ctx.fillRect(-200, -200, VW + 400, 760);
    var sun = ctx.createRadialGradient(300, 210, 10, 300, 210, 190);
    sun.addColorStop(0, "rgba(255,246,220,1)"); sun.addColorStop(0.3, "rgba(255,236,186,0.85)"); sun.addColorStop(1, "rgba(255,236,186,0)");
    ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(300, 210, 190, 0, TAU); ctx.fill();
    var sea = ctx.createLinearGradient(0, 500, 0, VH);
    sea.addColorStop(0, "#7CCFCB"); sea.addColorStop(0.5, DEEP); sea.addColorStop(1, NAVY);
    ctx.fillStyle = sea; ctx.fillRect(-200, 500, VW + 400, VH);
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 3;
    for (var i = 0; i < 7; i++) {
      var y = 540 + i * 52, shift = (p * 900 * (0.3 + i * 0.12) + time * 12) % 240;
      ctx.beginPath();
      for (var x = -240; x < VW + 240; x += 240) { ctx.moveTo(x - shift, y); ctx.quadraticCurveTo(x - shift + 60, y - 9, x - shift + 120, y); }
      ctx.stroke();
    }

    // the barrel: rings of water from the far end (small, light) to the near end (large, dark), sliding towards you
    var ex = lerp(1120, 860, out), ey = lerp(430, 400, out);          // the far end of the tube, where the light is
    var cx = 760, cy = 470;                                            // centre of the nearest ring
    var slide = (p * 9 + (still ? 0 : time * 0.05)) % 1;
    var open = 0.16 + 0.5 * p * p + 2.2 * out;                         // how big the far opening looks
    ctx.globalAlpha = 1 - out;
    function ring(z) {   // z: 0 far .. 1 near
      var s = open + (1 - open) * Math.pow(z, 1.35) * 1.0;
      return { x: lerp(ex, cx, z), y: lerp(ey, cy, z) + wob * 4 * z, rx: 1050 * s, ry: 640 * s };
    }
    for (var n = 0; n < RINGS; n++) {
      var z0 = (n + slide) / RINGS, z1 = (n + 1 + slide) / RINGS;
      if (z0 > 1.2) continue;
      var a = ring(z0), b = ring(z1);
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.rx, b.ry, 0, A0, A1);
      ctx.ellipse(a.x, a.y, a.rx, a.ry, 0, A1, A0, true);
      ctx.closePath();
      var shade = clamp(z0, 0, 1);
      ctx.fillStyle = mix(n % 2 ? "#8FDAD3" : "#6CCBC6", n % 2 ? "#0A4A63" : NAVY, Math.pow(shade, 0.8));
      ctx.fill();
    }
    // streaks of light running down the tube wall
    ctx.lineCap = "round";
    for (var sN = 0; sN < 22; sN++) {
      var ang = A0 + (A1 - A0) * (sN + 0.5) / 22 + 0.03 * Math.sin(sN * 12.9);
      var zA = ((sN * 0.37 + slide * 1.0) % 1) * 0.75 + 0.1, zB = zA + 0.16;
      var ra = ring(zA), rb = ring(zB);
      ctx.strokeStyle = "rgba(255,255,255," + (0.1 + 0.16 * (1 - zA)) + ")"; ctx.lineWidth = 2 + 5 * zA;
      ctx.beginPath(); ctx.moveTo(ra.x + ra.rx * Math.cos(ang), ra.y + ra.ry * Math.sin(ang));
      ctx.lineTo(rb.x + rb.rx * Math.cos(ang), rb.y + rb.ry * Math.sin(ang)); ctx.stroke();
    }
    // foam along the lip and the curtain of water falling from it
    var near = ring(1);
    for (var d = 0; d < 46; d++) {
      var zf = d / 46, r = ring(zf * 0.9 + 0.1), lx = r.x + r.rx * Math.cos(A0), ly = r.y + r.ry * Math.sin(A0);
      var fall = ((d * 0.61 + (still ? 0.3 : time * 0.5) + p * 6) % 1);
      ctx.fillStyle = "rgba(255,255,255," + (0.75 - 0.5 * fall) + ")";
      ctx.beginPath(); ctx.arc(lx - 10 * zf + Math.sin(d) * 8, ly + fall * (60 + 240 * zf), 3 + 9 * zf * (1 - fall * 0.5), 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(lx + Math.sin(d * 2.1) * 6, ly + Math.cos(d * 1.7) * 6, 5 + 12 * zf, 0, TAU); ctx.fill();
    }
    // foam where the floor of the tube meets the flat sea
    for (var e = 0; e < 40; e++) {
      var ze = e / 40, rr = ring(ze * 0.9 + 0.1), fx = rr.x + rr.rx * Math.cos(A1), fy = rr.y + rr.ry * Math.sin(A1);
      ctx.fillStyle = "rgba(255,255,255," + (0.5 + 0.4 * Math.sin(e * 3.3 + p * 20)) + ")";
      ctx.beginPath(); ctx.ellipse(fx + Math.sin(e * 1.9) * 10, fy + Math.cos(e) * 5, 10 + 26 * ze, 4 + 9 * ze, -0.3, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // the surfer, low on the wall, a little ahead of you
    var zs = 0.62, sr = ring(zs), sa = 0.36 * Math.PI + 0.05 * Math.sin(p * 30) + (still ? 0 : 0.02 * Math.sin(time * 2));
    var px = lerp(sr.x + sr.rx * 0.8 * Math.cos(sa), 800, out), py = lerp(sr.y + sr.ry * 0.8 * Math.sin(sa), 640, out);
    var lean = lerp(-0.32, -0.08, out) + 0.04 * Math.sin(p * 40);
    // spray off the tail
    for (var q = 0; q < 16; q++) {
      var ph = (q / 16 + (still ? 0 : time * 0.8) + p * 8) % 1;
      ctx.fillStyle = "rgba(255,255,255," + (0.8 * (1 - ph)) + ")";
      ctx.beginPath(); ctx.arc(px - 70 - ph * 150 + Math.sin(q * 5) * 12, py + 26 - ph * 60 + ph * ph * 90 + Math.cos(q * 3) * 8, 4 + 7 * (1 - ph), 0, TAU); ctx.fill();
    }
    ctx.save();
    ctx.translate(px, py); ctx.rotate(lean); ctx.scale(1.25, 1.25);
    ctx.fillStyle = "rgba(11,57,84,0.25)"; ctx.beginPath(); ctx.ellipse(6, 34, 88, 10, 0, 0, TAU); ctx.fill();          // shadow on the water
    ctx.fillStyle = "#FFFFFF"; ctx.beginPath();                                                                           // board
    ctx.moveTo(-92, 22); ctx.quadraticCurveTo(-30, 8, 70, 12); ctx.quadraticCurveTo(104, 14, 112, 20);
    ctx.quadraticCurveTo(60, 34, -60, 32); ctx.quadraticCurveTo(-88, 30, -92, 22); ctx.fill();
    ctx.strokeStyle = CORAL; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-70, 24); ctx.quadraticCurveTo(10, 16, 96, 19); ctx.stroke();
    ctx.strokeStyle = NAVY; ctx.lineWidth = 15; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(-34, 18); ctx.lineTo(-22, -14); ctx.lineTo(8, -30); ctx.stroke();                         // back leg and hips
    ctx.beginPath(); ctx.moveTo(40, 14); ctx.lineTo(26, -12); ctx.lineTo(8, -30); ctx.stroke();                           // front leg
    ctx.lineWidth = 17; ctx.beginPath(); ctx.moveTo(8, -30); ctx.lineTo(30, -66); ctx.stroke();                           // body, crouched forward
    ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(26, -60); ctx.lineTo(66, -52); ctx.stroke();                           // leading arm
    ctx.beginPath(); ctx.moveTo(24, -58); ctx.lineTo(-10, -70 + wob * 3); ctx.stroke();                                   // trailing arm, hand in the wall
    ctx.fillStyle = SAND; ctx.beginPath(); ctx.arc(40, -82, 13, 0, TAU); ctx.fill();                                     // head
    ctx.beginPath(); ctx.arc(68, -52, 5, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(-12, -70 + wob * 3, 5, 0, TAU); ctx.fill();
    ctx.restore();

    // darker water closing in at the edge nearest you
    var vg = ctx.createRadialGradient(cx, cy, 420, cx, cy, 1150);
    vg.addColorStop(0, "rgba(8,44,65,0)"); vg.addColorStop(1, "rgba(8,44,65," + (0.55 * (1 - out)) + ")");
    ctx.fillStyle = vg; ctx.fillRect(-300, -300, VW + 600, VH + 600);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---- the page
  function start(host) {
    var root = host.getAttribute("data-root") || "";
    var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.body.classList.add("barrel-page");
    if (still) document.body.classList.add("barrel-still");

    var canvas = el("canvas", { class: "barrel-canvas", role: "img", "aria-label": "A surfer riding through the barrel of a wave" });
    var ctx = canvas.getContext("2d");
    var cards = el("div", { class: "barrel-cards" });
    var dots = el("div", { class: "barrel-dots", role: "group", "aria-label": "Stops on the ride" });
    var hint = el("div", { class: "barrel-hint", "aria-hidden": "true" }, [el("span", { text: "Scroll to ride" }), el("span", { class: "barrel-hint-arrow", text: "↓" })]);
    var skip = el("a", { class: "barrel-skip", href: root + "overview/", text: "Skip to the overview" });
    var stage = el("div", { class: "barrel-stage" }, [canvas, skip, cards, dots, hint]);
    var track = el("div", { class: "barrel-track" }, [stage]);
    host.textContent = "";
    host.appendChild(track);

    var list = [], cardEls = [], dotEls = [], p = 0, active = -1;

    function stopAt(i) { return list.length > 1 ? (i + 0.5) / list.length * 0.9 : 0; }   // where on the ride stop i sits
    function progress() {
      var r = track.getBoundingClientRect(), span = r.height - stage.offsetHeight;
      return span > 0 ? clamp((stage.offsetTop - r.top) / span, 0, 1) : 0;
    }
    function goTo(i) {
      if (still) { cardEls[i].scrollIntoView({ block: "center" }); return; }
      var r = track.getBoundingClientRect(), span = r.height - stage.offsetHeight;
      window.scrollTo({ top: window.scrollY + r.top - stage.offsetTop + span * stopAt(i), behavior: "smooth" });
    }
    function build(s, issues) {
      list = stops(s, issues, root);
      list.forEach(function (st, i) {
        var card = el("a", { class: "barrel-card", href: st.href }, [
          el("span", { class: "barrel-kicker", text: st.kicker }),
          el("span", { class: "barrel-value" }, [st.value, st.unit ? el("span", { class: "barrel-unit", text: " " + st.unit }) : null]),
          el("span", { class: "barrel-text", text: st.text }),
          el("span", { class: "barrel-cta" }, [st.cta, el("span", { "aria-hidden": "true", text: " →" })])]);
        card.addEventListener("focus", function () { if (active !== i) goTo(i); });
        cards.appendChild(card); cardEls.push(card);
        var dot = el("button", { type: "button", class: "barrel-dot", "aria-label": "Go to " + st.kicker });
        dot.addEventListener("click", function () { goTo(i); });
        dots.appendChild(dot); dotEls.push(dot);
      });
      update();
    }
    function update() {
      p = still ? 0.45 : progress();
      var best = -1, bestD = 1;
      list.forEach(function (st, i) { var d = Math.abs(p - stopAt(i)); if (d < bestD) { bestD = d; best = i; } });
      if (p < 0.02 && !still) best = -1;
      if (best !== active) {
        active = best;
        cardEls.forEach(function (c, i) { c.classList.toggle("is-on", still || i === active); });
        dotEls.forEach(function (d, i) { d.classList.toggle("is-on", i === active); d.setAttribute("aria-current", i === active ? "true" : "false"); });
      }
      hint.classList.toggle("is-off", p > 0.02);
    }
    function resize() {
      var r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
    }
    function frame(ts) {
      update();
      scene(ctx, canvas.width, canvas.height, p, ts / 1000, still);
      if (!still) requestAnimationFrame(frame);
    }
    resize();
    window.addEventListener("resize", function () { resize(); if (still) frame(0); });
    window.addEventListener("scroll", update, { passive: true });
    requestAnimationFrame(frame);

    function get(n) { return fetch(root + "data/" + n + ".json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    Promise.all([get("summary"), get("issues")]).then(function (d) {
      if (d[0]) build(d[0], d[1]);
      if (still) frame(0);
    });
    window.__barrel = { goTo: goTo, progress: function () { return p; }, stopAt: stopAt };   // for screenshots and tests
  }

  function init() { var host = document.getElementById("barrel-ride"); if (host) start(host); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

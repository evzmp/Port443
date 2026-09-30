// port 443 — two-way infinite carousel with click/touch drag + momentum

(function () {
  const DRAG_THRESHOLD = 5; // px moved before a press counts as a drag
  const MOMENTUM = 1; // fraction of the release velocity carried into the fling
  const MOMENTUM_DECAY = 0.11; // s; how long a fling takes to settle (higher = flies further)
  const MAX_FLING = 5000; // px/s cap on release velocity
  const SAMPLE_WINDOW = 100; // ms of pointer history used to measure release velocity

  const rows = Array.from(document.querySelectorAll(".showcase__row")).map((row) => {
    const track = row.querySelector(".showcase__track");
    return {
      row,
      track,
      dir: track.dataset.direction === "right" ? 1 : -1,
      originals: null,
      unit: 0, // width of one repeating unit (half the track)
      x: null, // current translateX in px, kept within [-unit, 0)
      v: null, // current velocity in px/s (eases back to the auto-scroll speed)
      drag: null,
    };
  });

  const wrap = (x, unit) => (unit ? (((x % unit) + unit) % unit) - unit : x);

  const cloneHidden = (el) => {
    const c = el.cloneNode(true);
    c.setAttribute("aria-hidden", "true");
    return c;
  };

  const render = (r) => {
    r.track.style.transform = `translate3d(${r.x}px, 0, 0)`;
  };

  // Each track is: [unit][unit], where a unit is the original boxes repeated
  // until it's at least as wide as the viewport. Wrapping x within one unit
  // then loops seamlessly.
  const build = (r) => {
    const { track } = r;
    if (!r.originals) r.originals = Array.from(track.children);
    track.replaceChildren(...r.originals);

    const setWidth = track.scrollWidth;
    let copies = 1;
    while (setWidth * copies < window.innerWidth && copies < 20) copies++;

    const unit = [];
    for (let i = 0; i < copies; i++) {
      r.originals.forEach((el) => unit.push(i === 0 ? el : cloneHidden(el)));
    }
    track.replaceChildren(...unit, ...unit.map(cloneHidden));
    r.unit = setWidth * copies;

    if (r.x === null) {
      // Initial offset so the two rows are staggered like the mockup
      const first = r.originals[0];
      const boxStep = first.offsetWidth + parseFloat(getComputedStyle(first).marginRight);
      r.x = r.dir === 1 ? -r.unit + boxStep * 0.44 : -boxStep * 0.1;
    }
    r.x = wrap(r.x, r.unit);
    render(r);
  };

  // Auto-scroll loop ---------------------------------------------------------

  const speed = () =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--speed")) || 10;

  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1); // clamp after tab switches
    last = now;
    const cruise = speed();
    const ease = Math.exp(-dt / MOMENTUM_DECAY);
    rows.forEach((r) => {
      if (!r.unit || r.drag) return;
      // Exponentially blend the fling velocity back into the normal motion
      const target = r.dir * cruise;
      r.v = r.v === null ? target : target + (r.v - target) * ease;
      r.x = wrap(r.x + r.v * dt, r.unit);
      render(r);
    });
    requestAnimationFrame(tick);
  };

  // Dragging (mouse, pen and touch via Pointer Events) ----------------------

  rows.forEach((r) => {
    const { row } = r;

    row.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      r.drag = {
        id: e.pointerId,
        startX: e.clientX,
        startPos: r.x,
        moved: false,
        samples: [{ t: e.timeStamp, x: e.clientX }],
      };
      try {
        row.setPointerCapture(e.pointerId);
      } catch (_) {}
      row.classList.add("is-dragging");
    });

    row.addEventListener("pointermove", (e) => {
      const d = r.drag;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.startX;
      if (Math.abs(dx) > DRAG_THRESHOLD) d.moved = true;
      r.x = wrap(d.startPos + dx, r.unit);
      render(r);

      d.samples.push({ t: e.timeStamp, x: e.clientX });
      while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > SAMPLE_WINDOW) d.samples.shift();
    });

    // Velocity over the last few pointer moves; ~0 if the pointer was held still
    const releaseVelocity = (d, t) => {
      const recent = d.samples.filter((s) => t - s.t <= SAMPLE_WINDOW);
      if (recent.length < 2) return 0;
      const a = recent[0];
      const b = recent[recent.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) return 0;
      const v = (b.x - a.x) / dt;
      return Math.max(-MAX_FLING, Math.min(MAX_FLING, v));
    };

    const end = (e) => {
      const d = r.drag;
      if (!d || e.pointerId !== d.id) return;
      r.drag = null;
      row.classList.remove("is-dragging");
      r.v = e.type === "pointerup" ? releaseVelocity(d, e.timeStamp) * MOMENTUM : 0;
      // Swallow the click that follows a drag so links inside boxes don't fire
      if (d.moved) {
        const swallow = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        row.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => row.removeEventListener("click", swallow, { capture: true }), 50);
      }
    };
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);

    // Stop native image/link dragging from hijacking the gesture
    row.addEventListener("dragstart", (e) => e.preventDefault());
  });

  // Init ------------------------------------------------------------------

  const buildAll = () => rows.forEach(build);

  // Wait for fonts so measurements are stable
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    buildAll();
    last = performance.now();
    requestAnimationFrame(tick);
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(buildAll, 200);
  });
})();

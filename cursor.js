/* Dithered ink cursor: the pointer is a blob of Bayer-dithered ink that trails behind
   the mouse, fades into the page and drips downward. Drawn on a fixed overlay canvas
   with mix-blend-mode: difference, so it reads dark on the gray page and light on the sim. */
(() => {
  if (!matchMedia("(pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.documentElement.classList.add("ink-cursor");

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
  const CELL = 4;                       // density field resolution (px per cell)
  const cv = document.createElement("canvas");
  cv.className = "ink";
  cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  const g = cv.getContext("2d");

  let W = 0, H = 0, FW = 0, FH = 0, field = new Float32Array(0);
  let lastSX = scrollX, lastSY = scrollY, accX = 0, accY = 0;   // scroll bookkeeping (see followScroll)
  function resize() {
    W = cv.width = innerWidth + CELL; H = cv.height = innerHeight + CELL;   // one cell spare for the sub-cell scroll offset
    cv.style.width = W + "px"; cv.style.height = H + "px";
    FW = Math.ceil(W / CELL) + 2; FH = Math.ceil(H / CELL) + 2;
    field = new Float32Array(FW * FH);
  }
  resize(); addEventListener("resize", resize);

  let mx = -100, my = -100, px = mx, py = my, seen = false, down = false;
  const drips = [];
  addEventListener("pointermove", e => { mx = e.clientX; my = e.clientY; if (!seen) { px = mx; py = my; seen = true; } });
  addEventListener("pointerdown", () => (down = true));
  addEventListener("pointerup", () => (down = false));
  document.addEventListener("pointerleave", () => { seen = false; mx = my = px = py = -100; });

  // add a soft round stamp of ink to the field
  function stamp(x, y, r, amt) {
    x += accX; y += accY;                 // viewport → canvas (the canvas sits up to one cell up/left)
    const cx = x / CELL, cy = y / CELL, cr = r / CELL + 1;
    for (let j = Math.max(0, Math.floor(cy - cr)); j <= Math.min(FH - 1, Math.ceil(cy + cr)); j++)
      for (let i = Math.max(0, Math.floor(cx - cr)); i <= Math.min(FW - 1, Math.ceil(cx + cr)); i++) {
        const d = Math.hypot(i - cx, j - cy) * CELL / r;
        if (d >= 1) continue;
        const v = amt * (1 - d * d), k = j * FW + i;
        if (v > field[k]) field[k] = v;
      }
  }

  // the ink is stuck to the page: when it scrolls, shift the field (whole cells) and every
  // remembered position, so scrolling under a still mouse draws a trail too
  function followScroll() {
    const dX = scrollX - lastSX, dY = scrollY - lastSY;
    lastSX = scrollX; lastSY = scrollY;
    if (!dX && !dY) return;
    px -= dX; py -= dY;
    for (const d of drips) { d.x -= dX; d.y -= dY; }
    accX += dX; accY += dY;
    const ci = Math.floor(accX / CELL), cj = Math.floor(accY / CELL);   // whole cells move the field,
    accX -= ci * CELL; accY -= cj * CELL;                               // the 0..3px left over moves the canvas
    cv.style.transform = `translate(${-accX}px, ${-accY}px)`;
    if (!ci && !cj) return;
    const next = new Float32Array(FW * FH);
    for (let j = 0; j < FH; j++) {
      const sj = j + cj; if (sj < 0 || sj >= FH) continue;
      for (let i = 0; i < FW; i++) { const si = i + ci; if (si >= 0 && si < FW) next[j * FW + i] = field[sj * FW + si]; }
    }
    field = next;
  }

  let last = performance.now(), t = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (seen) followScroll(); else { lastSX = scrollX; lastSY = scrollY; }

    // fade everything left behind
    const keep = Math.pow(0.12, dt);   // ~88% gone after a second
    let any = false;
    for (let k = 0; k < field.length; k++) if (field[k] > 0.004) { field[k] *= keep; any = true; } else field[k] = 0;

    // over a scratch sheet the cursor lays no ink (the trail outside keeps fading as usual),
    // and it doesn't connect the entry point to the exit point when it comes back
    const hidden = document.documentElement.classList.contains("on-scratch");
    if (hidden) { px = mx; py = my; }
    else if (seen) {
      // trail: stamp along the path since the last frame
      const dist = Math.hypot(mx - px, my - py), steps = Math.max(1, Math.ceil(dist / 3));
      const wob = 1 + 0.12 * Math.sin(t * 5.3) * Math.sin(t * 2.1);   // the blob breathes a little
      const R = (down ? 9 : 13) * wob;
      for (let s = 1; s <= steps; s++) stamp(px + (mx - px) * s / steps, py + (my - py) * s / steps, R, 1);
      // drips: more when moving, a few when resting
      if (Math.random() < dt * (1.2 + Math.min(dist, 40) * 0.25))
        drips.push({ x: mx + (Math.random() - 0.5) * R, y: my + R * 0.4, vy: 0, r: 2 + Math.random() * 2.5, life: 0.8 + Math.random() * 1.6 });
      px = mx; py = my; any = true;
    }
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i];
      d.vy = Math.min(d.vy + 260 * dt, 90); d.y += d.vy * dt; d.life -= dt; d.r *= Math.pow(0.7, dt);
      stamp(d.x, d.y, d.r * 2.2, Math.min(1, d.life + 0.3) * 0.8);
      if (d.life <= 0 || d.y > H + 10) drips.splice(i, 1);
    }

    g.clearRect(0, 0, W, H);
    if (any || drips.length) {
      // bounding box of live ink
      let x0 = FW, y0 = FH, x1 = -1, y1 = -1;
      for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) if (field[j * FW + i] > 0) {
        if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
      }
      if (x1 >= 0) {
        const ox = Math.max(0, (x0 - 1) * CELL), oy = Math.max(0, (y0 - 1) * CELL);
        const w = Math.min(W, (x1 + 1) * CELL) - ox, h = Math.min(H, (y1 + 1) * CELL) - oy;
        if (w > 0 && h > 0) {
          const img = g.createImageData(w, h), data = img.data;
          for (let y = 0; y < h; y++) {
            const fy = (oy + y) / CELL, j = Math.floor(fy), b = fy - j;
            for (let x = 0; x < w; x++) {
              const fx = (ox + x) / CELL, i = Math.floor(fx), a = fx - i, k = j * FW + i;
              // bilinear density, then the 4x4 Bayer threshold at this exact pixel
              const v = (field[k] * (1 - a) + field[k + 1] * a) * (1 - b) + (field[k + FW] * (1 - a) + field[k + FW + 1] * a) * b;
              if (v > BAYER[((oy + y) & 3) * 4 + ((ox + x) & 3)]) {
                const p = (y * w + x) * 4; data[p] = data[p + 1] = data[p + 2] = 255; data[p + 3] = 255;
              }
            }
          }
          g.putImageData(img, ox, oy);
        }
      }
    }
    // a solid 3x3 core so the hotspot is exact
    if (seen && !hidden) { g.fillStyle = "#fff"; g.fillRect(Math.round(mx + accX) - 1, Math.round(my + accY) - 1, 3, 3); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* Scratch-off projects: with ?scratch in the URL, each project's body (everything under its
   title) sits under a dithered sheet. The sheet uses the same banded dither as the Luminary
   hole shader's Bayer variant: a smooth tone is split into 8 gray bands, and a 1px 4x4 Bayer
   offset of up to one band picks between neighbouring bands. The word "scratch" is encoded in
   the dither as its band mirrored (light where the sheet is dark, dark where it is light).
   Hovering opens a temporary dithered peek around the pointer; holding the left button
   (or dragging a finger) scratches for real, wearing the sheet away with dithered edges.
   It never auto-finishes. Holographic specks: each sheet on screen gives off a few cyan,
   yellow and pink pixel sprites that dither in, rise slowly from its surface with a lazy
   sway, and step down through smaller sprite frames at the end instead of fading. */
(() => {
  if (!/[?&]scratch\b/.test(location.search)) return;
  document.documentElement.classList.add("scratch-mode");   // extra room under titles for the top fade

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
  const CELL = 3;            // scratch-field resolution (px per cell); rendering is 1px
  const R = 21;              // brush radius in cells (~63px)
  const PR = R * CELL;       // hover peek radius, px: same as the scratch brush (~63px)
  const N_BAND = 8;
  const BANDS = [0x15, 0x21, 0x2e, 0x3c, 0x4c, 0x5e, 0x72, 0x88];   // --text up toward --lo
  const HOLO = ["#00dcff", "#ffe000", "#ff3caa"];   // cyan, yellow, pink
  const M = 28;              // dithered overhang around each sheet, px (same as the photo frames)
  const PROJECTS = ["xv6", "skyblock", "velvet", "luminary"];

  class Sheet {
    constructor(section) {
      this.section = section;
      this.head = section.querySelector(".head");
      this.cv = document.createElement("canvas");
      this.cv.className = "scratch";
      this.cv.setAttribute("aria-hidden", "true");
      section.appendChild(this.cv);
      this.g = this.cv.getContext("2d");
      this.cover = null; this.visible = true; this.dirty = true;
      this.peek = null; this.rect = null;   // peek centre (canvas px) and the region waiting to be redrawn
      this.layout();
      new ResizeObserver(() => this.layout()).observe(section);
      new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.dirty = true; }).observe(this.cv);
    }
    layout() {
      const below = this.head.offsetTop + this.head.offsetHeight, next = this.head.nextElementSibling;
      const top = next && next !== this.cv ? Math.max(below + 2, next.offsetTop - 8) : below + 12;
      // the sheet overhangs the content by M px (less at the top: only the gap under the title),
      // and that overhang dithers out into the page like the sidebar → page transition
      const Mt = Math.max(0, Math.min(M, top - below - 2));
      const W = this.section.clientWidth + 2 * M, H = Math.max(1, this.section.clientHeight - top) + Mt + M;
      this.cv.style.top = top - Mt + "px"; this.cv.style.left = -M + "px";
      if (W === this.W && H === this.H) return;
      const FW = Math.ceil(W / CELL), FH = Math.ceil(H / CELL);
      const old = this.cover, oFW = this.FW, oFH = this.FH;
      this.W = this.cv.width = W; this.H = this.cv.height = H;
      this.cv.style.width = W + "px"; this.cv.style.height = H + "px";
      this.FW = FW; this.FH = FH;
      this.cover = new Float32Array(FW * FH).fill(1);
      if (old) for (let j = 0; j < Math.min(FH, oFH); j++) for (let i = 0; i < Math.min(FW, oFW); i++)
        this.cover[j * FW + i] = old[j * oFW + i];          // keep scratches across resizes
      const m = document.createElement("canvas"); m.width = W; m.height = H;
      const mg = m.getContext("2d");
      mg.font = "700 64px 'Kode Mono', monospace"; mg.textAlign = "center"; mg.textBaseline = "middle";
      mg.fillText("scratch", W / 2, Math.min(H / 2, 180));
      const md = mg.getImageData(0, 0, W, H).data;
      this.word = new Uint8Array(W * H);
      for (let k = 0; k < this.word.length; k++) this.word[k] = md[k * 4 + 3] > 127;
      // static tone: soft light from the upper left, falling off across the sheet
      this.shade = new Uint8Array(W * H);
      const lx = W * 0.22, ly = Math.min(H * 0.25, 160), far = Math.hypot(Math.max(lx, W - lx), Math.max(ly, H - ly));
      for (let y = 0, k = 0; y < H; y++) {
        const b = (y & 3) * 4;
        for (let x = 0; x < W; x++, k++) {
          const tone = 0.95 - 0.85 * Math.hypot(x - lx, y - ly) / far;
          const band = Math.min(1, Math.max(0, tone + (BAYER[b + (x & 3)] - 0.5) / (N_BAND - 1)));
          let i = (band * (N_BAND - 1)) | 0;
          if (this.word[k]) i = N_BAND - 1 - i;               // the word: its band mirrored, so it always contrasts
          const edge = Math.min(x / M, (W - 1 - x) / M, Mt ? y / Mt : 1, (H - 1 - y) / M);
          this.shade[k] = edge < 1 && BAYER[b + (x & 3)] >= (edge * M + 1) / (M + 1) ? 0 : BANDS[i];   // 0 = page shows
        }
      }
      this.img = this.g.createImageData(W, H);
      this.dirty = true;
    }
    scratch(x, y) {                   // x, y relative to the canvas, in px
      const { FW, FH, cover } = this, cx = x / CELL, cy = y / CELL;
      if (cx < -R || cy < -R || cx > FW + R || cy > FH + R) return;
      const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(FW - 1, Math.ceil(cx + R));
      const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(FH - 1, Math.ceil(cy + R));
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i - cx, j - cy) / R;
        if (d < 1) { const k = j * FW + i; cover[k] = Math.max(0, cover[k] - 0.35 * (1 - d * d)); }
      }
      this.mark(x0 * CELL, y0 * CELL, (x1 + 1) * CELL, (y1 + 1) * CELL);
    }
    paint() {
      this.dirty = false;
      const { W, H, FW, cover, shade } = this, d = this.img.data;
      for (let y = 0, p = 0, k = 0; y < H; y++) {
        const b = (y & 3) * 4, row = ((y / CELL) | 0) * FW;
        for (let x = 0; x < W; x++, p += 4, k++) {
          if (cover[row + ((x / CELL) | 0)] <= BAYER[b + ((x + 2) & 3)]) { d[p + 3] = 0; continue; }   // scratched
          const v = shade[k]; if (!v) { d[p + 3] = 0; continue; }
          d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
        }
      }
      this.applyPeek(0, 0, W, H);
      this.g.putImageData(this.img, 0, 0);
    }
    // redraw only a box: sheet pixels, then the peek thinned over them
    paintRect(X0, Y0, X1, Y1) {
      const { W, H, FW, cover, shade } = this, d = this.img.data;
      X0 = Math.max(0, X0 | 0); Y0 = Math.max(0, Y0 | 0); X1 = Math.min(W, Math.ceil(X1)); Y1 = Math.min(H, Math.ceil(Y1));
      if (X1 <= X0 || Y1 <= Y0) return;
      for (let y = Y0; y < Y1; y++) {
        const b = (y & 3) * 4, row = ((y / CELL) | 0) * FW;
        for (let x = X0, k = y * W + X0, p = k * 4; x < X1; x++, k++, p += 4) {
          if (cover[row + ((x / CELL) | 0)] <= BAYER[b + ((x + 2) & 3)]) { d[p + 3] = 0; continue; }
          const v = shade[k]; if (!v) { d[p + 3] = 0; continue; }
          d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
        }
      }
      this.applyPeek(X0, Y0, X1, Y1);
      this.g.putImageData(this.img, 0, 0, X0, Y0, X1 - X0, Y1 - Y0);
    }
    // peek: inside the circle the sheet keeps only a share of its pixels, sparse at the centre, full at the rim
    applyPeek(X0, Y0, X1, Y1) {
      if (!this.peek) return;
      const { W, H } = this, d = this.img.data, { x: cx, y: cy } = this.peek;
      const x0 = Math.max(X0, Math.floor(cx - PR)), x1 = Math.min(X1, Math.ceil(cx + PR));
      const y0 = Math.max(Y0, Math.floor(cy - PR)), y1 = Math.min(Y1, Math.ceil(cy + PR));
      for (let y = y0; y < y1; y++) {
        const b = (y & 3) * 4;
        for (let x = x0; x < x1; x++) {
          const q = Math.hypot(x - cx, y - cy) / PR;
          if (q >= 1) continue;
          const keep = 0.12 + 0.88 * q * q * q;
          if (BAYER[b + (x & 3)] >= keep) d[(y * W + x) * 4 + 3] = 0;
        }
      }
    }
    // any foil left within the peek radius of (x, y)? and right under it?
    coverNear(x, y) {
      const { FW, FH, cover } = this, cx = x / CELL, cy = y / CELL, r = PR / CELL;
      for (let j = Math.max(0, Math.floor(cy - r)); j <= Math.min(FH - 1, Math.ceil(cy + r)); j += 2)
        for (let i = Math.max(0, Math.floor(cx - r)); i <= Math.min(FW - 1, Math.ceil(cx + r)); i += 2)
          if (cover[j * FW + i] > 0.25 && (i - cx) ** 2 + (j - cy) ** 2 < r * r) return true;
      return false;
    }
    coverAt(x, y) {
      const i = (x / CELL) | 0, j = (y / CELL) | 0;
      return i >= 0 && j >= 0 && i < this.FW && j < this.FH && this.cover[j * this.FW + i] > 0.5;
    }
    mark(x0, y0, x1, y1) {
      const r = this.rect;
      this.rect = r ? [Math.min(r[0], x0), Math.min(r[1], y0), Math.max(r[2], x1), Math.max(r[3], y1)] : [x0, y0, x1, y1];
    }
    setPeek(p) {
      const o = this.peek;
      if (o) this.mark(o.x - PR, o.y - PR, o.x + PR, o.y + PR);
      this.peek = p;
      if (p) this.mark(p.x - PR, p.y - PR, p.x + PR, p.y + PR);
    }
  }

  let sheets = [];
  let px = null, py = null, down = false, stroking = false;   // stroking: the held press has hit foil
  function track(e, scratching) {
    const x = e.clientX, y = e.clientY;
    if (px === null) { px = x; py = y; }
    const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / (CELL * R * 0.3)));
    let hiding = false;
    for (const s of sheets) {
      const r = s.cv.getBoundingClientRect();
      const lx = x - r.left, ly = y - r.top;
      const inside = lx >= 0 && ly >= 0 && lx < r.width && ly < r.height;
      const near = lx > -PR && ly > -PR && lx < r.width + PR && ly < r.height + PR;
      const foil = near && s.coverNear(lx, ly);                 // is there anything left to uncover here?
      if (inside && foil) hiding = true;
      // clicks reach the page wherever the foil under the pointer is already gone
      s.cv.style.pointerEvents = inside && s.coverAt(lx, ly) ? "auto" : "none";
      if (e.pointerType === "mouse" && (foil || s.peek)) s.setPeek(foil ? { x: lx, y: ly } : null);
      if (!scratching || !near) continue;
      for (let k = 1; k <= steps; k++) s.scratch(px + (x - px) * k / steps - r.left, py + (y - py) * k / steps - r.top);
      if (foil) stroking = true;                  // this press has reached foil: it's a scratch now
    }
    // over foil the peek is the cursor; over bare page (or a fully scratched patch) the ink cursor shows
    // while the left button is held for a scratch, the cursor stays hidden even over bare patches
    if (e.pointerType === "mouse") document.documentElement.classList.toggle("on-scratch", hiding || (down && stroking));
    px = x; py = y;
  }
  const scratchy = e => e.pointerType !== "mouse" || down;
  addEventListener("pointermove", e => track(e, scratchy(e)));
  // a press anywhere arms scratching, so a stroke can start outside a sheet and drag onto it
  addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.pointerType !== "mouse") return;
    down = true; stroking = false;
    if (document.documentElement.classList.contains("on-scratch")) e.preventDefault();   // started on foil
    px = py = null; track(e, true);
  });
  addEventListener("pointerup", e => { down = stroking = false; if (lastMouse) track(e, false); });   // re-decide the cursor on release
  addEventListener("blur", () => (down = stroking = false));
  const leave = () => { px = py = null; document.documentElement.classList.remove("on-scratch"); for (const s of sheets) if (s.peek) s.setPeek(null); };
  document.addEventListener("pointerleave", leave);
  // scrolling moves the page under a still pointer: once per frame, re-check what's under it
  let lastMouse = null, scrollQueued = false;
  addEventListener("pointermove", e => { if (e.pointerType === "mouse") lastMouse = { clientX: e.clientX, clientY: e.clientY, pointerType: "mouse" }; }, true);
  let lastSX = scrollX, lastSY = scrollY;
  addEventListener("scroll", () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      const dX = scrollX - lastSX, dY = scrollY - lastSY;
      lastSX = scrollX; lastSY = scrollY;
      if (px !== null) { px -= dX; py -= dY; }   // the last point, moved with the page
      if (!lastMouse) return;
      track(lastMouse, down);                 // peek follows; holding the button keeps scratching along the scroll
    });
  }, { passive: true });

  /* particles live in page coordinates on one fixed overlay, so they stay put while you scroll */
  const pc = document.createElement("canvas");
  pc.className = "specks"; pc.setAttribute("aria-hidden", "true");
  document.body.appendChild(pc);
  const pg = pc.getContext("2d");
  const fit = () => { pc.width = innerWidth; pc.height = innerHeight; };
  fit(); addEventListener("resize", fit);
  const specks = [];
  /* sprite frames (1 = lit pixel), largest first; a speck steps down through them as it ages */
  const SPRITES = [
    ["0010", "0111", "1110", "0100"],   // little tilted cross
    ["010", "111", "010"],              // plus
    ["11", "11"],                       // block
    ["1"],
  ].map(rows => rows.flatMap((r, y) => [...r].map((c, x) => c === "1" ? [x, y] : null).filter(Boolean)));
  const PX = 3;                          // each sprite pixel is 3x3 screen px
  let carry = 0;
  function emit(s) {
    const r = s.cv.getBoundingClientRect(), ox = r.left + scrollX, oy = r.top + scrollY;
    carry += r.width * r.height / 12000000;                     // ~2 specks a second from a typical sheet
    while (carry >= 1) {
      carry--;
      const x = Math.random() * r.width, y = Math.random() * r.height;
      const cx = Math.min((x / CELL) | 0, s.FW - 1), cy = Math.min((y / CELL) | 0, s.FH - 1);
      if (s.cover[cy * s.FW + cx] < 0.6) continue;               // not from scratched-off foil
      specks.push({ x: ox + x, y: oy + y, vy: -(0.12 + Math.random() * 0.14), sway: Math.random() * 6.283,
                    life: 150 + Math.random() * 110, age: 0, c: HOLO[(Math.random() * 3) | 0] });
    }
  }
  function drawSpecks() {
    pg.clearRect(0, 0, pc.width, pc.height);
    const sx = scrollX, sy = scrollY;
    let j = 0;
    for (const p of specks) {
      if (++p.age > p.life) continue;
      p.y += p.vy; p.x += Math.sin(p.sway + p.age * 0.03) * 0.15;   // slow rise, lazy sway
      specks[j++] = p;
      const a = p.age / p.life;
      // largest sprite for most of its life, stepping down through the smaller ones at the end
      const sprite = SPRITES[a < 0.6 ? 0 : Math.min(SPRITES.length - 1, 1 + (((a - 0.6) / 0.4 * (SPRITES.length - 1)) | 0))];
      const show = Math.min(1, a / 0.3);                         // dithers in over the first 30%
      const X = Math.round(p.x - sx), Y = Math.round(p.y - sy);
      if (X < -16 || Y < -16 || X > pc.width || Y > pc.height) continue;
      pg.fillStyle = p.c;
      for (const [dx, dy] of sprite) {
        const bx = X + dx * PX, by = Y + dy * PX;
        if (show >= 1) { pg.fillRect(bx, by, PX, PX); continue; }
        for (let v = 0; v < PX; v++) for (let u = 0; u < PX; u++)
          if (BAYER[((by + v) & 3) * 4 + ((bx + u) & 3)] < show) pg.fillRect(bx + u, by + v, 1, 1);
      }
    }
    specks.length = j;
  }

  function frame() {
    for (const s of sheets) {
      if (!s.visible) continue;
      if (s.dirty) { s.dirty = false; s.rect = null; s.paint(); }          // full redraw after a resize
      else if (s.rect) { const r = s.rect; s.rect = null; s.paintRect(r[0], r[1], r[2], r[3]); }
    }
    if (specks.length < 400) for (const s of sheets) if (s.visible) emit(s);
    drawSpecks();
    requestAnimationFrame(frame);
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    sheets = PROJECTS.map(id => document.getElementById(id)).filter(Boolean).map(s => new Sheet(s));
    requestAnimationFrame(frame);
  });
})();

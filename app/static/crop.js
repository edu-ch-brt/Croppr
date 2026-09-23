(() => {
  "use strict";

  const MODES = {
    id: { aspect: [3, 4], outW: 300, outH: 400 },
    arbor: { aspect: [1, 1], outW: 200, outH: 200 },
  };

  const HANDLE = 10; // CSS px hit radius for corners
  const MIN_BOX = 8; // min natural-px side

  const state = {
    imageId: null,
    stem: null,
    naturalW: 0,
    naturalH: 0,
    mode: "id",
    box: null, // {x,y,w,h} in natural pixels
    img: null,
  };

  /** Display mapping: natural ↔ canvas CSS pixels with letterboxing */
  const view = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    canvasCssW: 0,
    canvasCssH: 0,
  };

  const els = {
    file: document.getElementById("file-input"),
    startAgain: document.getElementById("start-again-btn"),
    save: document.getElementById("save-btn"),
    source: document.getElementById("source"),
    preview: document.getElementById("preview"),
    status: document.getElementById("status"),
    error: document.getElementById("error"),
    modeRadios: document.querySelectorAll('input[name="mode"]'),
  };

  const srcCtx = els.source.getContext("2d");
  const prevCtx = els.preview.getContext("2d");

  let drag = null; // { kind: 'create'|'move'|'resize', corner?, startNat, origBox }

  function setStatus(msg) {
    els.status.textContent = msg || "";
  }

  function setError(msg) {
    if (!msg) {
      els.error.hidden = true;
      els.error.textContent = "";
      return;
    }
    els.error.hidden = false;
    els.error.textContent = msg;
  }

  function syncSaveEnabled() {
    els.save.disabled = !state.box || !state.imageId;
  }

  function parseFilename(contentDisposition) {
    if (!contentDisposition) return null;
    const star = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
    if (star) {
      try {
        return decodeURIComponent(star[1].trim());
      } catch {
        /* fall through */
      }
    }
    const quoted = /filename="([^"]+)"/i.exec(contentDisposition);
    if (quoted) return quoted[1];
    const plain = /filename=([^;]+)/i.exec(contentDisposition);
    if (plain) return plain[1].trim().replace(/^["']|["']$/g, "");
    return null;
  }

  function aspectForMode() {
    return MODES[state.mode].aspect;
  }

  function setMode(mode) {
    if (!MODES[mode]) return;
    state.mode = mode;
    state.box = null;
    const m = MODES[mode];
    els.preview.width = m.outW;
    els.preview.height = m.outH;
    clearPreview();
    redrawSource();
    syncSaveEnabled();
    setStatus(state.imageId ? `Mode: ${mode === "id" ? "ID Card" : "Arbor"}. Draw a crop box.` : "");
  }

  function clearPreview() {
    prevCtx.fillStyle = "#ffffff";
    prevCtx.fillRect(0, 0, els.preview.width, els.preview.height);
  }

  function clearSourceCanvas() {
    srcCtx.fillStyle = "#e8ecf0";
    srcCtx.fillRect(0, 0, els.source.width, els.source.height);
  }

  function layoutSourceCanvas() {
    const wrap = els.source.parentElement;
    const maxW = Math.max(280, wrap.clientWidth || 480);
    const maxH = Math.min(560, Math.max(280, window.innerHeight * 0.55));
    const dpr = window.devicePixelRatio || 1;

    let cssW = maxW;
    let cssH = maxH;
    if (state.naturalW && state.naturalH) {
      const fit = Math.min(maxW / state.naturalW, maxH / state.naturalH);
      cssW = Math.max(1, Math.floor(state.naturalW * fit));
      cssH = Math.max(1, Math.floor(state.naturalH * fit));
    }

    els.source.style.width = `${cssW}px`;
    els.source.style.height = `${cssH}px`;
    els.source.width = Math.round(cssW * dpr);
    els.source.height = Math.round(cssH * dpr);
    srcCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    view.canvasCssW = cssW;
    view.canvasCssH = cssH;

    if (state.naturalW && state.naturalH) {
      const scale = Math.min(cssW / state.naturalW, cssH / state.naturalH);
      const drawW = state.naturalW * scale;
      const drawH = state.naturalH * scale;
      view.scale = scale;
      view.offsetX = (cssW - drawW) / 2;
      view.offsetY = (cssH - drawH) / 2;
    } else {
      view.scale = 1;
      view.offsetX = 0;
      view.offsetY = 0;
    }
  }

  function cssToNatural(cssX, cssY) {
    return {
      x: (cssX - view.offsetX) / view.scale,
      y: (cssY - view.offsetY) / view.scale,
    };
  }

  function naturalToCss(nx, ny) {
    return {
      x: nx * view.scale + view.offsetX,
      y: ny * view.scale + view.offsetY,
    };
  }

  function pointerCss(evt) {
    const rect = els.source.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    };
  }

  function clampBox(box) {
    let { x, y, w, h } = box;
    const [aw, ah] = aspectForMode();
    const maxW = state.naturalW;
    const maxH = state.naturalH;

    // Enforce aspect: prefer width, derive height
    h = (w * ah) / aw;
    if (h > maxH) {
      h = maxH;
      w = (h * aw) / ah;
    }
    if (w > maxW) {
      w = maxW;
      h = (w * ah) / aw;
    }
    if (w < MIN_BOX || h < MIN_BOX) {
      w = Math.min(maxW, Math.max(MIN_BOX, (MIN_BOX * aw) / Math.min(aw, ah)));
      h = (w * ah) / aw;
      if (h < MIN_BOX) {
        h = Math.min(maxH, MIN_BOX);
        w = (h * aw) / ah;
      }
    }

    x = Math.min(Math.max(0, x), maxW - w);
    y = Math.min(Math.max(0, y), maxH - h);
    // Snap to integer pixels for API
    const left = Math.round(x);
    const top = Math.round(y);
    let right = Math.round(x + w);
    let bottom = Math.round(y + h);
    right = Math.min(maxW, Math.max(left + 1, right));
    bottom = Math.min(maxH, Math.max(top + 1, bottom));

    // Re-fit aspect after integer snap within tolerance
    let cw = right - left;
    let ch = bottom - top;
    const targetH = Math.round((cw * ah) / aw);
    if (Math.abs(ch - targetH) > 1) {
      ch = targetH;
      if (top + ch > maxH) {
        ch = maxH - top;
        cw = Math.round((ch * aw) / ah);
        right = Math.min(maxW, left + cw);
        bottom = top + (right - left === cw ? ch : Math.round(((right - left) * ah) / aw));
      } else {
        bottom = top + ch;
        right = left + cw;
      }
    }

    return {
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
    };
  }

  function boxFromCorners(x0, y0, x1, y1) {
    const [aw, ah] = aspectForMode();
    let dx = x1 - x0;
    let dy = y1 - y0;
    // Drag from anchor; lock aspect using dominant axis
    let w = Math.abs(dx);
    let h = Math.abs(dy);
    if (w * ah >= h * aw) {
      h = (w * ah) / aw;
    } else {
      w = (h * aw) / ah;
    }
    const x = dx >= 0 ? x0 : x0 - w;
    const y = dy >= 0 ? y0 : y0 - h;
    return clampBox({ x, y, w, h });
  }

  function hitTest(cssX, cssY) {
    if (!state.box) return null;
    const b = state.box;
    const tl = naturalToCss(b.x, b.y);
    const br = naturalToCss(b.x + b.w, b.y + b.h);
    const corners = {
      tl: { x: tl.x, y: tl.y },
      tr: { x: br.x, y: tl.y },
      bl: { x: tl.x, y: br.y },
      br: { x: br.x, y: br.y },
    };
    for (const [name, c] of Object.entries(corners)) {
      if (Math.hypot(cssX - c.x, cssY - c.y) <= HANDLE) {
        return { kind: "resize", corner: name };
      }
    }
    if (cssX >= tl.x && cssX <= br.x && cssY >= tl.y && cssY <= br.y) {
      return { kind: "move" };
    }
    return null;
  }

  function redrawSource() {
    layoutSourceCanvas();
    clearSourceCanvas();
    if (!state.img) return;

    const drawW = state.naturalW * view.scale;
    const drawH = state.naturalH * view.scale;
    srcCtx.drawImage(state.img, view.offsetX, view.offsetY, drawW, drawH);

    if (!state.box) return;

    const b = state.box;
    const tl = naturalToCss(b.x, b.y);
    const br = naturalToCss(b.x + b.w, b.y + b.h);
    const rw = br.x - tl.x;
    const rh = br.y - tl.y;

    // Dim outside
    srcCtx.save();
    srcCtx.fillStyle = "rgba(0,0,0,0.35)";
    srcCtx.beginPath();
    srcCtx.rect(view.offsetX, view.offsetY, drawW, drawH);
    srcCtx.rect(tl.x, tl.y, rw, rh);
    srcCtx.fill("evenodd");
    srcCtx.restore();

    // Box stroke
    srcCtx.strokeStyle = "#ffffff";
    srcCtx.lineWidth = 2;
    srcCtx.strokeRect(tl.x + 0.5, tl.y + 0.5, rw - 1, rh - 1);
    srcCtx.strokeStyle = "#0969da";
    srcCtx.lineWidth = 1;
    srcCtx.strokeRect(tl.x + 0.5, tl.y + 0.5, rw - 1, rh - 1);

    // Corner handles
    const corners = [
      [tl.x, tl.y],
      [br.x, tl.y],
      [tl.x, br.y],
      [br.x, br.y],
    ];
    for (const [cx, cy] of corners) {
      srcCtx.fillStyle = "#ffffff";
      srcCtx.strokeStyle = "#0969da";
      srcCtx.lineWidth = 1.5;
      srcCtx.beginPath();
      srcCtx.rect(cx - 4, cy - 4, 8, 8);
      srcCtx.fill();
      srcCtx.stroke();
    }
  }

  function updatePreview() {
    const m = MODES[state.mode];
    els.preview.width = m.outW;
    els.preview.height = m.outH;
    clearPreview();
    if (!state.img || !state.box) return;
    const b = state.box;
    prevCtx.imageSmoothingEnabled = true;
    prevCtx.imageSmoothingQuality = "high";
    prevCtx.drawImage(
      state.img,
      b.x,
      b.y,
      b.w,
      b.h,
      0,
      0,
      m.outW,
      m.outH
    );
  }

  async function onFileSelected(file) {
    if (!file) return;
    setError("");
    setStatus("Uploading…");
    els.save.disabled = true;

    const fd = new FormData();
    fd.append("file", file, file.name);

    let body;
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail || res.statusText || "Upload failed";
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      body = data;
    } catch (err) {
      setError(err.message || String(err));
      setStatus("");
      return;
    }

    state.imageId = body.image_id;
    state.stem = body.stem;
    state.naturalW = body.width;
    state.naturalH = body.height;
    state.box = null;

    const img = new Image();
    img.decoding = "async";
    try {
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Could not load working image."));
        img.src = body.image_url;
      });
    } catch (err) {
      setError(err.message);
      setStatus("");
      return;
    }

    state.img = img;
    els.startAgain.disabled = false;
    setMode(state.mode); // clears box, sizes preview, redraws
    setStatus(`Loaded ${body.stem} (${body.width}×${body.height}). Draw a crop box.`);
    syncSaveEnabled();
  }

  function onPointerDown(evt) {
    if (!state.img) return;
    evt.preventDefault();
    els.source.setPointerCapture(evt.pointerId);
    const css = pointerCss(evt);
    const nat = cssToNatural(css.x, css.y);
    const hit = hitTest(css.x, css.y);

    if (hit && hit.kind === "resize") {
      drag = {
        kind: "resize",
        corner: hit.corner,
        startNat: nat,
        origBox: { ...state.box },
      };
    } else if (hit && hit.kind === "move") {
      drag = {
        kind: "move",
        startNat: nat,
        origBox: { ...state.box },
      };
    } else {
      // New box: clamp start inside image
      const sx = Math.min(Math.max(0, nat.x), state.naturalW);
      const sy = Math.min(Math.max(0, nat.y), state.naturalH);
      drag = {
        kind: "create",
        startNat: { x: sx, y: sy },
        origBox: null,
      };
      state.box = null;
      clearPreview();
      syncSaveEnabled();
    }
    redrawSource();
  }

  function onPointerMove(evt) {
    if (!drag || !state.img) {
      if (state.img && state.box) {
        const css = pointerCss(evt);
        const hit = hitTest(css.x, css.y);
        if (hit?.kind === "resize") els.source.style.cursor = "nwse-resize";
        else if (hit?.kind === "move") els.source.style.cursor = "move";
        else els.source.style.cursor = "crosshair";
      }
      return;
    }
    evt.preventDefault();
    const css = pointerCss(evt);
    const nat = cssToNatural(css.x, css.y);

    if (drag.kind === "create") {
      state.box = boxFromCorners(drag.startNat.x, drag.startNat.y, nat.x, nat.y);
    } else if (drag.kind === "move") {
      const dx = nat.x - drag.startNat.x;
      const dy = nat.y - drag.startNat.y;
      state.box = clampBox({
        x: drag.origBox.x + dx,
        y: drag.origBox.y + dy,
        w: drag.origBox.w,
        h: drag.origBox.h,
      });
    } else if (drag.kind === "resize") {
      const o = drag.origBox;
      let x0 = o.x;
      let y0 = o.y;
      let x1 = o.x + o.w;
      let y1 = o.y + o.h;
      const c = drag.corner;
      if (c === "tl") {
        x0 = nat.x;
        y0 = nat.y;
      } else if (c === "tr") {
        x1 = nat.x;
        y0 = nat.y;
      } else if (c === "bl") {
        x0 = nat.x;
        y1 = nat.y;
      } else if (c === "br") {
        x1 = nat.x;
        y1 = nat.y;
      }
      // Anchor opposite corner
      const ax = c.includes("l") ? x1 : x0;
      const ay = c.includes("t") ? y1 : y0;
      const mx = c.includes("l") ? x0 : x1;
      const my = c.includes("t") ? y0 : y1;
      state.box = boxFromCorners(ax, ay, mx, my);
    }

    redrawSource();
    updatePreview();
    syncSaveEnabled();
  }

  function onPointerUp(evt) {
    if (!drag) return;
    drag = null;
    if (state.box && (state.box.w < MIN_BOX || state.box.h < MIN_BOX)) {
      state.box = null;
      clearPreview();
    } else if (state.box) {
      state.box = clampBox(state.box);
      updatePreview();
    }
    syncSaveEnabled();
    redrawSource();
    try {
      els.source.releasePointerCapture(evt.pointerId);
    } catch {
      /* ignore */
    }
  }

  async function save() {
    if (!state.imageId || !state.box) return;
    setError("");
    setStatus("Saving…");
    els.save.disabled = true;

    const b = state.box;
    const payload = {
      image_id: state.imageId,
      mode: state.mode,
      left: b.x,
      top: b.y,
      right: b.x + b.w,
      bottom: b.y + b.h,
    };

    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const j = await res.json();
          detail = j.detail || detail;
        } catch {
          /* ignore */
        }
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      const fallback =
        state.mode === "id"
          ? `${state.stem || "image"}_ID.jpg`
          : `${state.stem || "image"}_Arbor.jpg`;
      const filename = parseFilename(cd) || fallback;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Downloaded ${filename}`);
    } catch (err) {
      setError(err.message || String(err));
      setStatus("");
    } finally {
      syncSaveEnabled();
    }
  }

  async function startAgain() {
    setError("");
    const id = state.imageId;
    state.imageId = null;
    state.stem = null;
    state.naturalW = 0;
    state.naturalH = 0;
    state.box = null;
    state.img = null;
    els.file.value = "";
    els.startAgain.disabled = true;
    syncSaveEnabled();
    clearSourceCanvas();
    clearPreview();
    layoutSourceCanvas();
    clearSourceCanvas();
    setStatus("");

    if (id) {
      try {
        await fetch("/api/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_id: id }),
        });
      } catch {
        /* client already cleared */
      }
    }
  }

  // Events
  els.file.addEventListener("change", () => {
    const f = els.file.files && els.file.files[0];
    if (f) onFileSelected(f);
  });

  els.modeRadios.forEach((r) => {
    r.addEventListener("change", () => {
      if (r.checked) setMode(r.value);
    });
  });

  els.save.addEventListener("click", () => {
    save();
  });
  els.startAgain.addEventListener("click", () => {
    startAgain();
  });

  els.source.addEventListener("pointerdown", onPointerDown);
  els.source.addEventListener("pointermove", onPointerMove);
  els.source.addEventListener("pointerup", onPointerUp);
  els.source.addEventListener("pointercancel", onPointerUp);

  window.addEventListener("resize", () => {
    if (state.img) {
      redrawSource();
      updatePreview();
    }
  });

  // Init
  setMode("id");
  layoutSourceCanvas();
  clearSourceCanvas();
  clearPreview();
  syncSaveEnabled();
})();

(function () {
  "use strict";

  /* ============================= State ============================= */

  const NODE_DEFAULTS = {
    start:    { w: 140, h: 50,  text: "Start" },
    process:  { w: 150, h: 64,  text: "Process" },
    decision: { w: 170, h: 110, text: "Decision?" },
    io:       { w: 160, h: 64,  text: "Input / Output" }
  };

  const STORAGE_KEY = "flowchart-builder-data";
  const MAX_HISTORY = 100;

  let state = { nodes: [], connections: [] };
  let history = [];   // past snapshots (for undo)
  let redoStack = []; // future snapshots (for redo)
  let selection = null; // { type: 'node'|'connection', id }

  let idCounter = 1;
  function uid(prefix) { return prefix + (idCounter++); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  /* ============================= DOM refs ============================= */

  const canvasEl = document.getElementById("canvas");
  const nodesLayer = document.getElementById("nodes-layer");
  const svg = document.getElementById("connections-layer");
  const canvasScroll = document.getElementById("canvas-scroll");
  const emptyState = document.getElementById("empty-state");
  const toastEl = document.getElementById("toast");

  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnNew = document.getElementById("btn-new");
  const btnSave = document.getElementById("btn-save");
  const btnExport = document.getElementById("btn-export");

  const modalNew = document.getElementById("modal-new");
  const modalNewCancel = document.getElementById("modal-new-cancel");
  const modalNewConfirm = document.getElementById("modal-new-confirm");

  ensureArrowMarker();

  /* ============================= History ============================= */

  function commit(mutator) {
    const before = clone(state);
    mutator();
    history.push(before);
    if (history.length > MAX_HISTORY) history.shift();
    redoStack = [];
    render();
    updateHistoryButtons();
  }

  // For interactions (drag) that mutate state directly and only want to
  // record a single history entry once the interaction completes.
  function commitRaw(beforeSnapshot) {
    history.push(beforeSnapshot);
    if (history.length > MAX_HISTORY) history.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function undo() {
    if (history.length === 0) return;
    const before = history.pop();
    redoStack.push(clone(state));
    state = before;
    selection = null;
    render();
    updateHistoryButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    history.push(clone(state));
    state = next;
    selection = null;
    render();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (btnUndo) btnUndo.disabled = history.length === 0;
    if (btnRedo) btnRedo.disabled = redoStack.length === 0;
    saveToStorage(true);
  }

  /* ============================= Helpers ============================= */

  function getNode(id) { return state.nodes.find(n => n.id === id); }
  function getConnection(id) { return state.connections.find(c => c.id === id); }

  function pointForSide(node, side) {
    switch (side) {
      case "top": return { x: node.x + node.w / 2, y: node.y };
      case "bottom": return { x: node.x + node.w / 2, y: node.y + node.h };
      case "left": return { x: node.x, y: node.y + node.h / 2 };
      case "right": return { x: node.x + node.w, y: node.y + node.h / 2 };
    }
  }

  function canvasPointFromClient(clientX, clientY) {
    const rect = canvasEl.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add("show"));
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toastEl.classList.remove("show");
      setTimeout(() => { toastEl.hidden = true; }, 200);
    }, 1800);
  }

  function isEditingSomething() {
    const active = document.activeElement;
    return Boolean(active && (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA"));
  }

  /* ============================= Node CRUD ============================= */

  function addNode(type, cx, cy) {
    const def = NODE_DEFAULTS[type];
    const node = {
      id: uid("node"),
      type,
      x: Math.round(cx - def.w / 2),
      y: Math.round(cy - def.h / 2),
      w: def.w,
      h: def.h,
      text: def.text
    };
    clampNodeToCanvas(node);
    commit(() => { state.nodes.push(node); });
    selection = { type: "node", id: node.id };
    render();
  }

  function clampNodeToCanvas(node) {
    const maxX = canvasEl.clientWidth - node.w;
    const maxY = canvasEl.clientHeight - node.h;
    node.x = Math.max(0, Math.min(node.x, Math.max(0, maxX)));
    node.y = Math.max(0, Math.min(node.y, Math.max(0, maxY)));
  }

  function deleteNode(id) {
    commit(() => {
      state.nodes = state.nodes.filter(n => n.id !== id);
      state.connections = state.connections.filter(c => c.from !== id && c.to !== id);
    });
    selection = null;
    render();
  }

  function deleteConnection(id) {
    commit(() => {
      state.connections = state.connections.filter(c => c.id !== id);
    });
    selection = null;
    render();
  }

  /* ============================= Rendering ============================= */

  function render() {
    renderNodes();
    renderConnections();
    updateSelectionUI();
    emptyState.style.display = state.nodes.length === 0 ? "block" : "none";
  }

  function renderNodes() {
    nodesLayer.innerHTML = "";
    state.nodes.forEach(node => {
      const el = document.createElement("div");
      el.className = "node node-" + node.type + (selection && selection.type === "node" && selection.id === node.id ? " selected" : "");
      el.style.left = node.x + "px";
      el.style.top = node.y + "px";
      el.style.width = node.w + "px";
      el.style.height = node.h + "px";
      el.dataset.id = node.id;

      if (node.type === "decision" || node.type === "io") {
        const svgNS = "http://www.w3.org/2000/svg";
        const shapeSvg = document.createElementNS(svgNS, "svg");
        shapeSvg.setAttribute("class", "node-shape-svg");
        shapeSvg.setAttribute("viewBox", "0 0 100 100");
        shapeSvg.setAttribute("preserveAspectRatio", "none");
        const poly = document.createElementNS(svgNS, "polygon");
        poly.setAttribute("class", "node-poly");
        poly.setAttribute(
          "points",
          node.type === "decision" ? "50,2 98,50 50,98 2,50" : "16,0 100,0 84,100 0,100"
        );
        shapeSvg.appendChild(poly);
        el.appendChild(shapeSvg);
      } else {
        const shape = document.createElement("div");
        shape.className = "node-shape";
        el.appendChild(shape);
      }

      const textWrap = document.createElement("div");
      textWrap.className = "node-text-wrap";
      const text = document.createElement("span");
      text.className = "node-text";
      text.textContent = node.text;
      textWrap.appendChild(text);
      el.appendChild(textWrap);

      ["top", "bottom", "left", "right"].forEach(side => {
        const cp = document.createElement("div");
        cp.className = "connection-point cp-" + side;
        cp.dataset.side = side;
        cp.title = "Drag to connect";
        el.appendChild(cp);
      });

      // Edit button (pencil)
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "node-action-btn node-edit";
      edit.title = "Edit text";
      edit.setAttribute("aria-label", "Edit node text");
      edit.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
      el.appendChild(edit);

      // Delete button
      const del = document.createElement("button");
      del.type = "button";
      del.className = "node-action-btn node-delete";
      del.title = "Delete node";
      del.setAttribute("aria-label", "Delete node");
      del.textContent = "\u00D7";
      el.appendChild(del);

      nodesLayer.appendChild(el);
    });
  }

  function renderConnections() {
    // Clear everything except the defs marker
    Array.from(svg.querySelectorAll(":scope > *:not(defs)")).forEach(n => n.remove());

    state.connections.forEach(conn => {
      const fromNode = getNode(conn.from);
      const toNode = getNode(conn.to);
      if (!fromNode || !toNode) return;

      const p1 = pointForSide(fromNode, conn.fromSide);
      const p2 = pointForSide(toNode, conn.toSide);
      const isSelected = selection && selection.type === "connection" && selection.id === conn.id;

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.dataset.id = conn.id;

      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = conn.label ? 'Double-click to edit label "' + conn.label + '"' : "Double-click to add a label";
      g.appendChild(title);

      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", "M " + p1.x + " " + p1.y + " L " + p2.x + " " + p2.y);
      hit.setAttribute("class", "conn-hit");
      g.appendChild(hit);

      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.setAttribute("d", "M " + p1.x + " " + p1.y + " L " + p2.x + " " + p2.y);
      line.setAttribute("class", "conn-line" + (isSelected ? " selected" : ""));
      line.setAttribute("marker-end", "url(#arrowhead" + (isSelected ? "-selected" : "") + ")");
      g.appendChild(line);

      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;

      if (conn.label) {
        const labelGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        labelGroup.setAttribute("class", "conn-label-group" + (isSelected ? " selected" : ""));
        const paddingX = 8;
        const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textEl.setAttribute("x", mx);
        textEl.setAttribute("y", my);
        textEl.setAttribute("class", "conn-label-text" + (isSelected ? " selected" : ""));
        textEl.textContent = conn.label;
        const rectEl = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rectEl.setAttribute("class", "conn-label-bg");
        labelGroup.appendChild(rectEl);
        labelGroup.appendChild(textEl);
        g.appendChild(labelGroup);
        svg.appendChild(g);

        // size the background rect to the rendered text
        try {
          const bbox = textEl.getBBox();
          rectEl.setAttribute("x", bbox.x - paddingX);
          rectEl.setAttribute("y", bbox.y - 3);
          rectEl.setAttribute("width", bbox.width + paddingX * 2);
          rectEl.setAttribute("height", bbox.height + 6);
          rectEl.setAttribute("rx", 5);
        } catch (err) {
          rectEl.setAttribute("x", mx - 30);
          rectEl.setAttribute("y", my - 10);
          rectEl.setAttribute("width", 60);
          rectEl.setAttribute("height", 20);
          rectEl.setAttribute("rx", 5);
        }
      } else {
        // If connection has no label, render midpoint "+ Label" button (shown when selected)
        const addBtn = document.createElementNS("http://www.w3.org/2000/svg", "g");
        addBtn.setAttribute("class", "conn-add-label-btn");
        addBtn.style.display = isSelected ? "block" : "none";
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", mx - 28);
        rect.setAttribute("y", my - 10);
        rect.setAttribute("width", 56);
        rect.setAttribute("height", 20);
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        txt.setAttribute("x", mx);
        txt.setAttribute("y", my + 1);
        txt.textContent = "+ Label";
        addBtn.appendChild(rect);
        addBtn.appendChild(txt);
        g.appendChild(addBtn);

        svg.appendChild(g);
      }
    });
  }

  function ensureArrowMarker() {
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML =
      '<marker id="arrowhead" markerWidth="9" markerHeight="9" refX="7.5" refY="4" orient="auto" markerUnits="userSpaceOnUse">' +
      '<path d="M0,0 L9,4 L0,8 Z" fill="#6b7280"></path></marker>' +
      '<marker id="arrowhead-selected" markerWidth="9" markerHeight="9" refX="7.5" refY="4" orient="auto" markerUnits="userSpaceOnUse">' +
      '<path d="M0,0 L9,4 L0,8 Z" fill="#2d6a4f"></path></marker>';
    svg.appendChild(defs);
  }

  /* ============================= Selection ============================= */

  function updateSelectionUI() {
    // Update node elements without destroying DOM
    nodesLayer.querySelectorAll(".node").forEach(el => {
      const isSelected = Boolean(selection && selection.type === "node" && selection.id === el.dataset.id);
      el.classList.toggle("selected", isSelected);
    });

    // Update connection elements
    svg.querySelectorAll("g[data-id]").forEach(g => {
      const connId = g.dataset.id;
      const isSelected = Boolean(selection && selection.type === "connection" && selection.id === connId);
      const line = g.querySelector(".conn-line");
      if (line) {
        line.classList.toggle("selected", isSelected);
        line.setAttribute("marker-end", "url(#arrowhead" + (isSelected ? "-selected" : "") + ")");
      }
      const labelText = g.querySelector(".conn-label-text");
      if (labelText) labelText.classList.toggle("selected", isSelected);
      const labelGroup = g.querySelector(".conn-label-group");
      if (labelGroup) labelGroup.classList.toggle("selected", isSelected);
      const addBtn = g.querySelector(".conn-add-label-btn");
      if (addBtn) addBtn.style.display = isSelected ? "block" : "none";
    });
  }

  function selectNode(id) {
    if (selection && selection.type === "node" && selection.id === id) return;
    selection = { type: "node", id };
    updateSelectionUI();
  }

  function selectConnection(id) {
    if (selection && selection.type === "connection" && selection.id === id) return;
    selection = { type: "connection", id };
    updateSelectionUI();
  }

  function clearSelection() {
    if (!selection) return;
    selection = null;
    updateSelectionUI();
  }

  /* ============================= Node dragging & selection ============================= */

  let dragState = null; // { id, startX, startY, offsetX, offsetY, before, moved }

  nodesLayer.addEventListener("pointerdown", (e) => {
    const cp = e.target.closest(".connection-point");
    if (cp) { startConnectionDrag(e, cp); return; }

    if (e.target.closest(".node-action-btn")) return; // handled by click
    if (e.target.closest(".node-inline-editor")) return;

    const nodeEl = e.target.closest(".node");
    if (!nodeEl) return;

    const id = nodeEl.dataset.id;
    const node = getNode(id);
    if (!node) return;

    selectNode(id);

    const pt = canvasPointFromClient(e.clientX, e.clientY);
    dragState = {
      id,
      startX: pt.x,
      startY: pt.y,
      offsetX: pt.x - node.x,
      offsetY: pt.y - node.y,
      before: clone(state),
      moved: false
    };
  });

  window.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const node = getNode(dragState.id);
    if (!node) return;
    const pt = canvasPointFromClient(e.clientX, e.clientY);

    if (!dragState.moved) {
      const dist = Math.hypot(pt.x - dragState.startX, pt.y - dragState.startY);
      if (dist < 4) return;
      dragState.moved = true;
      const el = nodesLayer.querySelector('.node[data-id="' + node.id + '"]');
      if (el) el.classList.add("dragging");
    }

    let nx = pt.x - dragState.offsetX;
    let ny = pt.y - dragState.offsetY;
    const maxX = canvasEl.clientWidth - node.w;
    const maxY = canvasEl.clientHeight - node.h;
    nx = Math.max(0, Math.min(nx, Math.max(0, maxX)));
    ny = Math.max(0, Math.min(ny, Math.max(0, maxY)));
    node.x = nx;
    node.y = ny;
    const el = nodesLayer.querySelector('.node[data-id="' + node.id + '"]');
    if (el) { el.style.left = node.x + "px"; el.style.top = node.y + "px"; }
    renderConnections();
  });

  window.addEventListener("pointerup", () => {
    if (dragState) {
      const el = nodesLayer.querySelector('.node[data-id="' + dragState.id + '"]');
      if (el) el.classList.remove("dragging");
      if (dragState.moved) commitRaw(dragState.before);
      dragState = null;
    }
  });

  // Click handling: select on click, delete via delete button, edit via edit button
  nodesLayer.addEventListener("click", (e) => {
    const del = e.target.closest(".node-delete");
    if (del) {
      const nodeEl = e.target.closest(".node");
      if (nodeEl) deleteNode(nodeEl.dataset.id);
      return;
    }
    const edit = e.target.closest(".node-edit");
    if (edit) {
      const nodeEl = e.target.closest(".node");
      if (nodeEl) beginNodeTextEdit(nodeEl.dataset.id);
      return;
    }
  });

  nodesLayer.addEventListener("dblclick", (e) => {
    if (e.target.closest(".connection-point") || e.target.closest(".node-action-btn")) return;
    const nodeEl = e.target.closest(".node");
    if (!nodeEl) return;
    beginNodeTextEdit(nodeEl.dataset.id);
  });

  let activeTextEditor = null; // { nodeId, textarea, finish }

  function beginNodeTextEdit(nodeId) {
    if (activeTextEditor && activeTextEditor.nodeId === nodeId) return;
    if (activeTextEditor) activeTextEditor.finish(true);

    const node = getNode(nodeId);
    if (!node) return;
    const nodeEl = nodesLayer.querySelector('.node[data-id="' + nodeId + '"]');
    if (!nodeEl) return;

    selectNode(nodeId);

    const textWrap = nodeEl.querySelector(".node-text-wrap");
    if (textWrap) textWrap.style.visibility = "hidden";

    const textarea = document.createElement("textarea");
    textarea.className = "node-inline-editor";
    textarea.value = node.text;
    textarea.placeholder = "Enter text...";
    textarea.spellcheck = false;
    nodeEl.appendChild(textarea);

    textarea.focus();
    textarea.select();

    const before = clone(state);
    let finished = false;

    function finish(commitChange) {
      if (finished) return;
      finished = true;
      activeTextEditor = null;
      textarea.removeEventListener("keydown", onKeydown);
      textarea.removeEventListener("blur", onBlur);
      textarea.remove();
      if (textWrap) textWrap.style.visibility = "visible";

      if (commitChange) {
        const newText = textarea.value.trim() || node.text;
        if (newText !== node.text) {
          node.text = newText;
          history.push(before);
          if (history.length > MAX_HISTORY) history.shift();
          redoStack = [];
          updateHistoryButtons();
        }
      }
      const textSpan = nodeEl.querySelector(".node-text");
      if (textSpan) textSpan.textContent = node.text;
    }

    function onKeydown(ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    }

    function onBlur() {
      setTimeout(() => finish(true), 60);
    }

    textarea.addEventListener("keydown", onKeydown);
    textarea.addEventListener("blur", onBlur);
    textarea.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    textarea.addEventListener("click", (ev) => ev.stopPropagation());
    textarea.addEventListener("dblclick", (ev) => ev.stopPropagation());

    activeTextEditor = { nodeId, textarea, finish };
  }

  /* ============================= Connection dragging (create) ============================= */

  let connectState = null; // { fromNode, fromSide, tempPathEl }

  function startConnectionDrag(e, cpEl) {
    e.stopPropagation();
    e.preventDefault();
    const nodeEl = cpEl.closest(".node");
    const fromNode = nodeEl.dataset.id;
    const fromSide = cpEl.dataset.side;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "temp-line");
    svg.appendChild(path);

    connectState = { fromNode, fromSide, tempPathEl: path };
    updateTempLine(e.clientX, e.clientY);
  }

  function updateTempLine(clientX, clientY) {
    if (!connectState) return;
    const fromNode = getNode(connectState.fromNode);
    if (!fromNode) return;
    const p1 = pointForSide(fromNode, connectState.fromSide);
    const p2 = canvasPointFromClient(clientX, clientY);
    connectState.tempPathEl.setAttribute("d", "M " + p1.x + " " + p1.y + " L " + p2.x + " " + p2.y);
  }

  window.addEventListener("pointermove", (e) => {
    if (connectState) updateTempLine(e.clientX, e.clientY);
  });

  window.addEventListener("pointerup", (e) => {
    if (!connectState) return;
    const { fromNode, fromSide, tempPathEl } = connectState;
    tempPathEl.remove();
    connectState = null;

    const dropEl = document.elementFromPoint(e.clientX, e.clientY);
    if (!dropEl) return;

    const cpEl = dropEl.closest(".connection-point");
    const nodeEl = dropEl.closest(".node");
    if (!nodeEl) return;
    const toNode = nodeEl.dataset.id;
    if (toNode === fromNode) return;

    let toSide;
    if (cpEl) {
      toSide = cpEl.dataset.side;
    } else {
      const target = getNode(toNode);
      const dropPt = canvasPointFromClient(e.clientX, e.clientY);
      const cx = target.x + target.w / 2;
      const cy = target.y + target.h / 2;
      const dx = dropPt.x - cx;
      const dy = dropPt.y - cy;
      const rx = dx / (target.w / 2);
      const ry = dy / (target.h / 2);
      if (Math.abs(rx) > Math.abs(ry)) toSide = rx > 0 ? "right" : "left";
      else toSide = ry > 0 ? "bottom" : "top";
    }

    const newConn = {
      id: uid("conn"),
      from: fromNode,
      fromSide,
      to: toNode,
      toSide,
      label: ""
    };

    commit(() => { state.connections.push(newConn); });

    const sourceNode = getNode(fromNode);
    if (sourceNode && sourceNode.type === "decision") {
      requestAnimationFrame(() => openLabelEditor(newConn.id));
    }
  });

  /* ============================= Connection selection / label editing / delete ============================= */

  svg.addEventListener("click", (e) => {
    const g = e.target.closest("g[data-id]");
    if (!g) { clearSelection(); return; }
    const connId = g.dataset.id;
    if (e.target.closest(".conn-add-label-btn")) {
      openLabelEditor(connId);
      return;
    }
    selectConnection(connId);
  });

  svg.addEventListener("dblclick", (e) => {
    const g = e.target.closest("g[data-id]");
    if (!g) return;
    openLabelEditor(g.dataset.id);
  });

  let activeLabelEditor = null; // { connId, el, finish }

  function openLabelEditor(connId) {
    if (activeLabelEditor && activeLabelEditor.connId === connId) return;
    if (activeLabelEditor) activeLabelEditor.finish(true);

    const conn = getConnection(connId);
    if (!conn) return;
    const fromNode = getNode(conn.from);
    const toNode = getNode(conn.to);
    if (!fromNode || !toNode) return;

    selectConnection(connId);

    const p1 = pointForSide(fromNode, conn.fromSide);
    const p2 = pointForSide(toNode, conn.toSide);
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;

    const box = document.createElement("div");
    box.className = "label-editor-box";
    box.style.left = mx + "px";
    box.style.top = my + "px";

    // Row 1: input, Save, Delete (if label exists)
    const row1 = document.createElement("div");
    row1.className = "label-editor-input-row";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "label-editor-input";
    input.value = conn.label || "";
    input.placeholder = "Label (e.g. Yes/No)";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "label-editor-btn";
    saveBtn.textContent = "Save";

    row1.appendChild(input);
    row1.appendChild(saveBtn);

    if (conn.label) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "label-editor-btn-del";
      delBtn.title = "Remove label";
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      row1.appendChild(delBtn);

      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        input.value = "";
        finish(true);
      });
    }

    box.appendChild(row1);

    // Row 2: Quick Presets: Yes, No, True, False
    const presetsRow = document.createElement("div");
    presetsRow.className = "label-editor-presets";
    const presetLabel = document.createElement("span");
    presetLabel.style.fontSize = "11px";
    presetLabel.style.color = "var(--text-muted)";
    presetLabel.textContent = "Quick:";
    presetsRow.appendChild(presetLabel);

    ["Yes", "No", "True", "False"].forEach(txt => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "label-preset-chip";
      chip.textContent = txt;
      chip.addEventListener("click", (ev) => {
        ev.stopPropagation();
        input.value = txt;
        finish(true);
      });
      presetsRow.appendChild(chip);
    });

    box.appendChild(presetsRow);
    canvasEl.appendChild(box);

    input.focus();
    input.select();

    const before = clone(state);
    let finished = false;

    function finish(commitChange) {
      if (finished) return;
      finished = true;
      activeLabelEditor = null;
      document.removeEventListener("pointerdown", onDocClick);
      input.removeEventListener("keydown", onKeydown);
      box.remove();

      if (commitChange) {
        const newLabel = input.value.trim();
        if (newLabel !== (conn.label || "")) {
          conn.label = newLabel;
          history.push(before);
          if (history.length > MAX_HISTORY) history.shift();
          redoStack = [];
          updateHistoryButtons();
        }
      }
      renderConnections();
    }

    function onKeydown(ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    }

    saveBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      finish(true);
    });

    input.addEventListener("keydown", onKeydown);
    box.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    box.addEventListener("click", (ev) => ev.stopPropagation());
    box.addEventListener("dblclick", (ev) => ev.stopPropagation());

    // Close on click outside
    function onDocClick(ev) {
      if (!box.contains(ev.target)) {
        finish(true);
      }
    }
    setTimeout(() => {
      document.addEventListener("pointerdown", onDocClick);
    }, 50);

    activeLabelEditor = { connId, el: box, finish };
  }

  /* ============================= Canvas click-to-deselect ============================= */

  canvasEl.addEventListener("pointerdown", (e) => {
    if (e.target === canvasEl) clearSelection();
  });

  /* ============================= Keyboard shortcuts ============================= */

  window.addEventListener("keydown", (e) => {
    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    if (ctrlOrCmd && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault(); undo(); return;
    }
    if ((ctrlOrCmd && e.key.toLowerCase() === "y") || (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === "z")) {
      e.preventDefault(); redo(); return;
    }
    if ((e.key === "Enter" || e.key === "F2") && selection && !isEditingSomething()) {
      e.preventDefault();
      if (selection.type === "node") beginNodeTextEdit(selection.id);
      else if (selection.type === "connection") openLabelEditor(selection.id);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selection && !isEditingSomething()) {
      e.preventDefault();
      if (selection.type === "node") deleteNode(selection.id);
      else if (selection.type === "connection") deleteConnection(selection.id);
    }
  });

  /* ============================= Sidebar: click & drag to add ============================= */

  document.querySelectorAll(".element-card").forEach(card => {
    card.addEventListener("click", () => {
      const type = card.dataset.type;
      const cx = canvasScroll.scrollLeft + canvasScroll.clientWidth / 2;
      const cy = canvasScroll.scrollTop + canvasScroll.clientHeight / 2;
      addNode(type, cx, cy);
    });

    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", card.dataset.type);
      e.dataTransfer.effectAllowed = "copy";
    });
  });

  [canvasEl, canvasScroll].forEach(el => {
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("text/plain");
      if (!NODE_DEFAULTS[type]) return;
      const pt = canvasPointFromClient(e.clientX, e.clientY);
      addNode(type, pt.x, pt.y);
    });
  });

  /* ============================= Toolbar actions ============================= */

  function on(el, event, handler) {
    if (el) el.addEventListener(event, handler);
  }

  on(btnUndo, "click", undo);
  on(btnRedo, "click", redo);

  on(btnNew, "click", () => { if (modalNew) modalNew.hidden = false; });
  on(modalNewCancel, "click", () => { if (modalNew) modalNew.hidden = true; });
  on(modalNewConfirm, "click", () => {
    if (modalNew) modalNew.hidden = true;
    commit(() => { state.nodes = []; state.connections = []; });
    selection = null;
    render();
  });
  on(modalNew, "click", (e) => { if (e.target === modalNew) modalNew.hidden = true; });

  function saveToStorage(silent) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (!silent) showToast("Flowchart saved");
    } catch (err) {
      if (!silent) showToast("Could not save flowchart");
    }
  }

  // The toolbar's explicit Save button, if present.
  on(btnSave, "click", () => saveToStorage(false));

  on(btnExport, "click", exportPNG);

  /* ============================= Load on startup ============================= */

  function loadFlowchart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.connections)) {
        state = parsed;
        let maxId = 0;
        [...state.nodes, ...state.connections].forEach(item => {
          const match = /(\d+)$/.exec(item.id || "");
          if (match) maxId = Math.max(maxId, parseInt(match[1], 10));
        });
        idCounter = maxId + 1;
      }
    } catch (err) { /* ignore corrupt storage */ }
  }

  /* ============================= Export PNG ============================= */

  function exportPNG() {
    if (state.nodes.length === 0) {
      showToast("Add some nodes before exporting");
      return;
    }

    const pad = 50;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.nodes.forEach(n => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    });

    const width = Math.ceil(maxX - minX) + pad * 2;
    const height = Math.ceil(maxY - minY) + pad * 2;
    const scale = 2;

    const canvasOut = document.createElement("canvas");
    canvasOut.width = width * scale;
    canvasOut.height = height * scale;
    const ctx = canvasOut.getContext("2d");
    ctx.scale(scale, scale);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    ctx.translate(-minX + pad, -minY + pad);

    // Connections first, so nodes sit on top
    state.connections.forEach(conn => drawConnectionOnCanvas(ctx, conn));
    // Nodes
    state.nodes.forEach(node => drawNodeOnCanvas(ctx, node));

    canvasOut.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "flowchart.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("Exported flowchart.png");
    }, "image/png");
  }

  function drawConnectionOnCanvas(ctx, conn) {
    const fromNode = getNode(conn.from);
    const toNode = getNode(conn.to);
    if (!fromNode || !toNode) return;
    const p1 = pointForSide(fromNode, conn.fromSide);
    const p2 = pointForSide(toNode, conn.toSide);

    ctx.strokeStyle = "#6b7280";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // arrowhead
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const size = 9;
    ctx.fillStyle = "#6b7280";
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - size * Math.cos(angle - Math.PI / 7), p2.y - size * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(p2.x - size * Math.cos(angle + Math.PI / 7), p2.y - size * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();

    if (conn.label) {
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      ctx.font = "600 12px -apple-system, Segoe UI, Arial, sans-serif";
      const textWidth = ctx.measureText(conn.label).width;
      const boxW = textWidth + 12;
      const boxH = 20;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#dfe2e8";
      ctx.lineWidth = 1;
      roundRectPath(ctx, mx - boxW / 2, my - boxH / 2, boxW, boxH, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#1c2230";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(conn.label, mx, my + 1);
    }
  }

  function drawNodeOnCanvas(ctx, node) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#c7ccd6";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    if (node.type === "start") {
      roundRectPath(ctx, node.x, node.y, node.w, node.h, node.h / 2);
    } else if (node.type === "process") {
      roundRectPath(ctx, node.x, node.y, node.w, node.h, 8);
    } else if (node.type === "decision") {
      const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
      ctx.moveTo(cx, node.y);
      ctx.lineTo(node.x + node.w, cy);
      ctx.lineTo(cx, node.y + node.h);
      ctx.lineTo(node.x, cy);
      ctx.closePath();
    } else if (node.type === "io") {
      const skew = node.w * 0.16;
      ctx.moveTo(node.x + skew, node.y);
      ctx.lineTo(node.x + node.w, node.y);
      ctx.lineTo(node.x + node.w - skew, node.y + node.h);
      ctx.lineTo(node.x, node.y + node.h);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    // text, centered, wrapped to fit
    ctx.fillStyle = "#1c2230";
    ctx.font = "500 13.5px -apple-system, Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const innerPad = (node.type === "decision" || node.type === "io") ? node.w * 0.32 : 18;
    const maxWidth = node.w - innerPad * 2;
    const rawParagraphs = (node.text || "").split("\n");
    const lines = [];
    rawParagraphs.forEach(p => {
      lines.push(...wrapText(ctx, p, maxWidth));
    });
    const lineHeight = 16;
    const startY = node.y + node.h / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.slice(0, 4).forEach((line, i) => {
      ctx.fillText(line, node.x + node.w / 2, startY + i * lineHeight);
    });
  }

  function wrapText(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let current = "";
    words.forEach(word => {
      const test = current ? current + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    });
    if (current) lines.push(current);
    return lines.slice(0, 3);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /* ============================= Init ============================= */

  loadFlowchart();
  render();
  updateHistoryButtons();
})();
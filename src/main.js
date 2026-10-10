(() => {
"use strict";
const DATA = /*__DATA__*/null;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const yearOf = d => { const m = String(d ?? "").match(/(\d{4})(?!.*\d{4})/); return m ? m[1] : ""; };
const CONF = { high: "Well attested", medium: "Probable", low: "Uncertain" };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const people = DATA.people || [];
const places = DATA.places || [];
const byId = new Map();
people.forEach(p => byId.set(p.id, { kind: "person", item: p }));
places.forEach(p => byId.set(p.id, { kind: "place", item: p }));

const surname = p => (p.sortName || p.name.replace(/\s*\(.*?\)\s*/g, " ").trim().split(/\s+/).pop()).toLowerCase();
const lifespan = p => {
  const b = yearOf(p.born), d = yearOf(p.died);
  if (b && d) return `${b}–${d}`;
  if (d) return `d. ${d}`;
  return b ? `b. ${b}` : "";
};

/* ——— Plan markers: one per place; people are shown through the place that holds them ——— */
const PLACE_GROUP = { Mausoleum: "monument", Monument: "monument", Memorial: "monument", Building: "building", Ground: "ground", Landscape: "landscape" };
const GROUP_LABEL = { monument: "Monuments", building: "Buildings", ground: "Grounds", landscape: "Landscape" };
const markers = places
  .filter(p => typeof p.lat === "number" && typeof p.lng === "number")
  .map(p => ({ id: p.id, label: p.name, kind: "place", group: PLACE_GROUP[p.type] || "monument", type: p.type, lat: p.lat, lng: p.lng, approx: p.coord_quality !== "exact" }));
markers.sort((a, b) => b.lat - a.lat || a.lng - b.lng);   // number the key from north to south, like a printed plan
markers.forEach((m, i) => { m.n = i + 1; });
const markerById = new Map(markers.map(m => [m.id, m]));
const residents = new Map();   // place id -> people buried or commemorated there
people.forEach(p => { if (p.place) { if (!residents.has(p.place)) residents.set(p.place, []); residents.get(p.place).push(p); } });
const markerFor = id => { const e = byId.get(id); return e && (e.kind === "place" ? markerById.get(id) : markerById.get(e.item.place)); };

/* ——— Illustrations available for a card (the image data lives once, in CSS) ——— */
const figFor = id => (DATA.figures || []).find(f => (f.for || []).includes(id));
function figMarkup(f) {
  if (!f) return "";
  const style = f.style === "engraving" ? "engraving" : "watercolour";
  return `<figure class="fig fig-${style}"><div class="fig-mount"><div class="im im-${esc(f.id)}" role="img" aria-label="${esc(f.alt)}"></div></div>
    <figcaption><span class="fig-cap">${esc(f.caption)}</span> <span class="fig-credit">After ${esc(f.after)} by ${esc(f.author)}, <a href="${esc(f.source_url)}" target="_blank" rel="noopener">Wikimedia Commons</a>, ${f.licence_url ? `<a href="${esc(f.licence_url)}" target="_blank" rel="noopener">${esc(f.licence)}</a>` : esc(f.licence)}.</span></figcaption></figure>`;
}

/* ——— Memorial card ——— */
const dlg = $("#card");
const cardBody = $("#card-body");
let lastFocus = null;

function sourcesList(urls) {
  if (!urls || !urls.length) return "";
  return `<h4>Sources</h4><ol class="c-src">${urls.map(u => {
    let host = u; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
    return `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(host)}</a></li>`;
  }).join("")}</ol>`;
}

function openCard(id) {
  const entry = byId.get(id);
  if (!entry) return;
  const it = entry.item;
  const mk = markerFor(id);
  let html;
  if (entry.kind === "person") {
    const life = [it.born && `b. ${esc(it.born)}`, it.died && `d. ${esc(it.died)}`].filter(Boolean).join(" · ");
    html = `
      <p class="card-cat">${esc(it.category)}</p>
      <h3 id="card-name">${esc(it.name)}</h3>
      ${it.honorifics ? `<p class="c-hon">${esc(it.honorifics)}</p>` : ""}
      ${life ? `<p class="c-life">${life}</p>` : ""}
      <svg class="fleuron" viewBox="0 0 120 24" aria-hidden="true"><use href="#orn-fleuron"/></svg>
      ${figMarkup(figFor(id))}
      <p>${esc(it.summary)}</p>
      ${it.grave ? `<h4>The grave</h4><p>${esc(it.grave)}</p>` : ""}
      ${it.notes ? `<p class="c-notes">${esc(it.notes)}</p>` : ""}
      <dl>
        ${it.plot ? `<dt>Plot</dt><dd>${esc(it.plot)}</dd>` : ""}
        ${it.area ? `<dt>Ground</dt><dd>${esc(it.area)}</dd>` : ""}
        ${it.listed ? `<dt>Listed</dt><dd>${esc(it.listed)}</dd>` : ""}
        ${mk ? `<dt>On the plan</dt><dd>No. ${mk.n}, ${esc(mk.label)}${mk.approx ? " (position approximate)" : ""}</dd>` : `<dt>On the plan</dt><dd>Not shown; position not published</dd>`}
        <dt>Evidence</dt><dd><span class="conf ${esc(it.confidence)}">${CONF[it.confidence] || "Unrated"}</span></dd>
      </dl>
      ${sourcesList(it.sources)}`;
  } else {
    const here = residents.get(id) || [];
    html = `
      <p class="card-cat">${esc(it.type)}${it.date ? ` · ${esc(it.date)}` : ""}</p>
      <h3 id="card-name">${esc(it.name)}</h3>
      ${it.designer ? `<p class="c-life">${esc(it.designer)}</p>` : ""}
      <svg class="fleuron" viewBox="0 0 120 24" aria-hidden="true"><use href="#orn-fleuron"/></svg>
      ${figMarkup(figFor(id))}
      <p>${esc(it.description)}</p>
      ${here.length ? `<h4>${it.type === "Ground" ? "Among those buried here" : "Buried or commemorated here"}</h4><p>${here.map(r => `<button class="linkbtn" type="button" data-card="${esc(r.id)}">${esc(r.name)}</button>`).join(", ")}</p>` : ""}
      ${it.notes ? `<p class="c-notes">${esc(it.notes)}</p>` : ""}
      <dl>
        ${it.plot ? `<dt>Plot</dt><dd>${esc(it.plot)}</dd>` : ""}
        ${it.listed ? `<dt>Listed</dt><dd>${esc(it.listed)}</dd>` : ""}
        ${mk ? `<dt>On the plan</dt><dd>No. ${mk.n}${mk.approx ? " (position approximate)" : " (from its listed grid reference)"}</dd>` : ""}
        <dt>Evidence</dt><dd><span class="conf ${esc(it.confidence)}">${CONF[it.confidence] || "Unrated"}</span></dd>
      </dl>
      ${sourcesList(it.sources)}`;
  }
  html += `<div class="card-actions">
      ${mk ? `<button class="btn" type="button" data-locate="${esc(mk.id)}">Show on the plan</button>` : ""}
      <button class="btn ghost" type="button" data-close>Close</button>
    </div>`;
  cardBody.innerHTML = html;
  if (!dlg.open) lastFocus = document.activeElement;
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
  dlg.scrollTop = 0;
}
function closeCard() {
  if (dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); }
}
dlg.addEventListener("click", e => {
  if (e.target === dlg) return closeCard();
  if (e.target.closest("[data-close]")) return closeCard();
  const loc = e.target.closest("[data-locate]");
  if (loc) { closeCard(); locate(loc.dataset.locate); }
});
dlg.addEventListener("close", () => { if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true }); });
document.addEventListener("click", e => {
  const t = e.target.closest("[data-card]");
  if (t) { e.preventDefault(); openCard(t.dataset.card); }
});

/* ——— The Plan ——— */
let plan = null;
const planHost = $("#plan-host");
const refList = $("#ref-list");
let planGroup = "all";
let activeWalk = null;

function locate(id) {
  showTab("plan", { push: true });
  const plate = $("#plan .plate");
  if (plate) plate.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  selectMarker(id, true);
}
function selectMarker(id, pan) {
  if (plan) plan.select(id, { pan });
  $$("#ref-list button").forEach(b => b.setAttribute("aria-current", b.dataset.id === id ? "true" : "false"));
  // Scroll the key itself, never the page, so the plan stays in view.
  const btn = $(`#ref-list button[data-id="${CSS.escape(id)}"]`);
  if (btn && refList) {
    const lr = refList.getBoundingClientRect(), br = btn.getBoundingClientRect();
    if (br.top < lr.top || br.bottom > lr.bottom) refList.scrollTop += br.top - lr.top - (lr.height - br.height) / 2;
  }
}
function visibleMarker(m) {
  if (activeWalk) return activeWalk.stops.includes(m.id);
  return planGroup === "all" || m.group === planGroup;
}
function renderRefList() {
  if (!refList) return;
  const list = activeWalk
    ? activeWalk.stops.map(id => markerById.get(id)).filter(Boolean)
    : markers.filter(visibleMarker);
  refList.innerHTML = list.map((m, i) => {
    const e = byId.get(m.id).item;
    const kicker = [e.type, e.plot && `plot ${String(e.plot).split(" ")[0]}`].filter(Boolean).join(" · ");
    return `<li><button type="button" data-id="${esc(m.id)}" aria-current="false">
      <span class="r-n">${m.n}</span>
      <span class="r-t">${activeWalk ? `<span class="r-walk-stop">${i + 1}</span>` : ""}${esc(m.label)}<span class="r-k">${esc(kicker)}${m.approx ? " · position approximate" : ""}</span></span>
    </button></li>`;
  }).join("");
  if (plan) plan.setFilter(visibleMarker);
}
if (refList) {
  refList.addEventListener("click", e => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    if (b.getAttribute("aria-current") === "true") openCard(b.dataset.id);
    else selectMarker(b.dataset.id, true);
  });
  refList.addEventListener("dblclick", e => {
    const b = e.target.closest("button[data-id]");
    if (b) openCard(b.dataset.id);
  });
}

const planFilters = $("#plan-filters");
if (planFilters) {
  const counts = markers.reduce((a, m) => (a[m.group] = (a[m.group] || 0) + 1, a), {});
  planFilters.innerHTML = [["all", "All", markers.length], ...Object.keys(GROUP_LABEL).filter(g => counts[g]).map(g => [g, GROUP_LABEL[g], counts[g]])]
    .map(([g, t, c]) => `<button class="chip" type="button" data-group="${g}" aria-pressed="${g === "all"}">${t}<span class="ct">${c}</span></button>`).join("");
  planFilters.addEventListener("click", e => {
    const b = e.target.closest("[data-group]");
    if (!b) return;
    planGroup = b.dataset.group;
    $$("[data-group]", planFilters).forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    setWalk(null);
  });
}

const walkPick = $("#walk-pick");
const walkDesc = $("#walk-desc");
function setWalk(id) {
  activeWalk = id ? (DATA.walks || []).find(w => w.id === id) : null;
  if (walkPick) $$("button", walkPick).forEach(b => b.setAttribute("aria-pressed", activeWalk && b.dataset.walk === activeWalk.id ? "true" : "false"));
  if (walkDesc) walkDesc.innerHTML = activeWalk ? esc(activeWalk.blurb) : "Choose a walk to trace its route on the plan. Choose it again to clear the route.";
  if (plan) plan.showWalk(activeWalk ? activeWalk.stops.filter(s => markerById.has(s)) : null);
  renderRefList();
}
if (walkPick && DATA.walks) {
  walkPick.innerHTML = DATA.walks.map((w, i) => `<button type="button" data-walk="${esc(w.id)}" aria-pressed="false">
    <span class="wk-n">${["I", "II", "III", "IV", "V", "VI"][i] || i + 1}</span>
    <span class="wk-t">${esc(w.title)}<span class="wk-d">${w.stops.length} stops${w.distance ? ` · about ${esc(w.distance)}` : ""}</span></span></button>`).join("");
  walkPick.addEventListener("click", e => {
    const b = e.target.closest("[data-walk]");
    if (!b) return;
    setWalk(activeWalk && activeWalk.id === b.dataset.walk ? null : b.dataset.walk);
  });
}

// The plan is drawn the first time its tab is shown, when its host has a size to measure.
function ensurePlan() {
  if (plan || !planHost || !window.BrookwoodPlan) return;
  try {
    plan = window.BrookwoodPlan.mount(planHost, {
      geo: DATA.geo,
      markers,
      onSelect: id => selectMarker(id, false),
      onOpen: id => openCard(id),
    });
    plan.setFilter(visibleMarker);
    if (activeWalk) plan.showWalk(activeWalk.stops.filter(s => markerById.has(s)));
  } catch (err) {
    planHost.innerHTML = `<p class="register-empty">The plan could not be drawn in this browser. The reference list beside it still works.</p>`;
    console.error(err);
  }
}
setWalk(null);

/* ——— Register of notable interments ——— */
const regBody = $("#register-body");
const regChips = $("#register-chips");
const regSeek = $("#register-seek");
const regSort = $("#register-sort");
const regCount = $("#register-count");
let regCat = "All";
let regOrder = store.get("bw-reg-order") || "date";

function deathKey(p) {
  const m = String(p.died || "").match(/(\d{1,2})?\s*([A-Za-z]+)?\s*(\d{4})/);
  if (!m) return 99999999;
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const mo = m[2] ? months.indexOf(m[2].toLowerCase()) + 1 : 0;
  return +m[3] * 10000 + Math.max(mo, 0) * 100 + (+m[1] || 0);
}
function renderRegister() {
  if (!regBody) return;
  const q = (regSeek?.value || "").trim().toLowerCase();
  let list = people.filter(p => regCat === "All" || p.category === regCat);
  if (q) list = list.filter(p => [p.name, p.summary, p.area, p.plot, p.honorifics, ...(p.tags || [])].join(" ").toLowerCase().includes(q));
  list.sort(regOrder === "name" ? (a, b) => surname(a).localeCompare(surname(b)) : (a, b) => deathKey(a) - deathKey(b));
  regBody.innerHTML = list.map((p, i) => `<tr tabindex="0" data-card="${esc(p.id)}">
      <td class="c-no">${i + 1}</td>
      <td class="c-name"><b>${esc(p.name)}</b>${p.honorifics ? `<span class="hon">${esc(p.honorifics)}</span>` : ""}<span class="line2">${esc(p.calling || (p.tags || []).slice(0, 2).join(", "))}</span></td>
      <td class="c-dates">${esc(lifespan(p))}</td>
      <td class="c-cat">${esc(p.category)}</td>
      <td class="c-plot">${esc(p.plot || p.area || "—")}</td>
    </tr>`).join("");
  $("#register-empty").hidden = list.length > 0;
  if (regCount) regCount.textContent = `${list.length} of ${people.length} entries shown, ${regOrder === "name" ? "in alphabetical order of surname" : "in order of death"}.`;
}
if (regChips) {
  const cats = ["All", ...[...new Set(people.map(p => p.category))].sort()];
  regChips.innerHTML = cats.map(c => {
    const n = c === "All" ? people.length : people.filter(p => p.category === c).length;
    return `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === "All"}">${esc(c)}<span class="ct">${n}</span></button>`;
  }).join("");
  regChips.addEventListener("click", e => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    regCat = b.dataset.cat;
    $$("[data-cat]", regChips).forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    renderRegister();
  });
}
if (regSeek) regSeek.addEventListener("input", renderRegister);
if (regSort) {
  regSort.value = regOrder;
  regSort.addEventListener("change", () => { regOrder = regSort.value; store.set("bw-reg-order", regOrder); renderRegister(); });
}
if (regBody) regBody.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.dataset.card) { e.preventDefault(); openCard(e.target.dataset.card); }
});
renderRegister();

/* ——— Monuments and mausolea ——— */
const monHost = $("#mon-list");
const monFilter = $("#mon-filter");
const MON_TYPES = ["Mausoleum", "Monument", "Memorial", "Building", "Landscape", "Ground"];
const PLURAL = { All: "All", Mausoleum: "Mausolea", Monument: "Monuments", Memorial: "Memorials", Building: "Buildings", Landscape: "Landscape", Ground: "Grounds" };
let monType = "All";
function renderMonuments() {
  if (!monHost) return;
  const list = places.filter(p => monType === "All" || p.type === monType)
    .sort((a, b) => MON_TYPES.indexOf(a.type) - MON_TYPES.indexOf(b.type) || a.name.localeCompare(b.name));
  monHost.innerHTML = list.map(p => {
    const mk = markerById.get(p.id);
    const meta = [p.date, p.designer, p.plot && `Plot ${p.plot}`, p.listed].filter(Boolean).map(esc).join(" · ");
    return `<article class="mon">
      <span class="m-type">${esc(p.type)}${mk ? ` · No. ${mk.n}` : ""}</span>
      <h4>${esc(p.name)}</h4>
      ${meta ? `<span class="m-meta">${meta}</span>` : ""}
      <p>${esc(p.description)}</p>
      <div class="m-act"><button class="linkbtn" type="button" data-card="${esc(p.id)}"><svg aria-hidden="true" viewBox="0 0 48 24"><use href="#orn-manicule"/></svg>Particulars${p.confidence === "low" ? " (uncertain)" : ""}</button></div>
    </article>`;
  }).join("");
}
if (monFilter) {
  const types = MON_TYPES.filter(t => places.some(p => p.type === t));
  monFilter.innerHTML = ["All", ...types].map(t => {
    const n = t === "All" ? places.length : places.filter(p => p.type === t).length;
    return `<button class="chip" type="button" data-mtype="${t}" aria-pressed="${t === "All"}">${PLURAL[t] || t}<span class="ct">${n}</span></button>`;
  }).join("");
  monFilter.addEventListener("click", e => {
    const b = e.target.closest("[data-mtype]");
    if (!b) return;
    monType = b.dataset.mtype;
    $$("[data-mtype]", monFilter).forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    renderMonuments();
  });
}
renderMonuments();

/* ——— Chronology ——— */
const chrono = $("#chrono");
if (chrono && DATA.timeline) {
  chrono.innerHTML = [...DATA.timeline].sort((a, b) => a.year - b.year).map(t => {
    const showDate = t.date && String(t.date) !== String(t.year);
    return `<li><div><div class="yr">${esc(t.year)}</div>${showDate ? `<span class="dt">${esc(t.date)}</span>` : ""}</div>
      <div><h4>${esc(t.title)}${t.confidence === "low" ? ` <span class="uncertain" title="Sources disagree or are thin">?</span>` : ""}</h4><p>${esc(t.text)}</p></div></li>`;
  }).join("");
}

/* ——— Necropolis Railway: tickets ——— */
const ticketHost = $("#tickets");
const ticketNote = $("#ticket-note");
if (ticketHost && ticketNote) {
  const notes = JSON.parse($("#ticket-notes")?.textContent || "{}");
  const show = cls => {
    $$(".ticket", ticketHost).forEach(t => t.setAttribute("aria-pressed", t.dataset.cls === cls ? "true" : "false"));
    const n = notes[cls];
    if (n) ticketNote.innerHTML = `<h4>${esc(n.title)}</h4><p>${n.html}</p>`;
  };
  ticketHost.addEventListener("click", e => { const t = e.target.closest(".ticket"); if (t) show(t.dataset.cls); });
  show("first");
}

/* ——— Necropolis Railway: the journey ——— */
const lineSvg = $("#line-svg");
const departBtn = $("#depart");
const lineStatus = $("#line-status");
function initJourney() {
  if (!lineSvg || !departBtn) return;
  const track = $("#line-track", lineSvg);
  const train = $("#line-train", lineSvg);
  const stops = $$("[data-at]", lineSvg).map(el => ({ at: +el.dataset.at, msg: el.dataset.msg }));
  const len = track.getTotalLength();
  const place = f => {
    const p = track.getPointAtLength(f * len);
    const q = track.getPointAtLength(Math.min(len, f * len + 1));
    const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
    train.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${ang.toFixed(1)})`);
  };
  place(0);
  let raf = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const run = () => {
    cancelAnimationFrame(raf);
    departBtn.disabled = true;
    const dur = reduce.matches ? 0 : 14000;
    const t0 = performance.now();
    let shown = -1;
    const step = now => {
      const f = dur ? Math.min(1, (now - t0) / dur) : 1;
      const eased = f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      place(eased);
      const idx = stops.reduce((acc, s, i) => (eased >= s.at ? i : acc), -1);
      if (idx !== shown && idx >= 0) { shown = idx; lineStatus.textContent = stops[idx].msg; }
      if (f < 1) raf = requestAnimationFrame(step);
      else { departBtn.disabled = false; departBtn.textContent = "Run the journey again"; }
    };
    raf = requestAnimationFrame(step);
  };
  departBtn.addEventListener("click", run);
}

/* ——— Thumb-index tabs ——— */
const panels = $$(".tabpanel");
const tabBtns = $$("[data-tab-btn]");
const thumbs = $("#thumbs");
const thumbRow = $(".thumbs-row");
const runhead = $("#runhead");
const rhSec = $("#rh-sec");
const finis = $("#finis");
const onShow = { plan: ensurePlan, railway: initJourney };
const keys = panels.map(p => p.dataset.tab);
let current = null;

function showTab(key, { scrollTo = null, push = true, focus = false } = {}) {
  const panel = $(`#tab-${key}`);
  if (!panel) return;
  if (current !== key) {
    panels.forEach(pn => { pn.hidden = pn !== panel; });
    tabBtns.forEach(b => {
      const on = b.dataset.tabBtn === key;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    if (runhead) runhead.hidden = key === "home";
    if (rhSec) rhSec.textContent = key === "home" ? "" : panel.dataset.tabTitle || "";
    if (finis) finis.hidden = key !== keys[keys.length - 1];
    current = key;
    const once = onShow[key];
    if (once) { delete onShow[key]; once(); }
    const btn = $(`#t-${key}`);
    if (btn && thumbRow) {   // keep the chosen tab in view on a narrow strip, without moving the page
      const r = thumbRow.getBoundingClientRect(), b = btn.getBoundingClientRect();
      if (b.left < r.left || b.right > r.right) thumbRow.scrollLeft += b.left - r.left - (r.width - b.width) / 2;
    }
  }
  if (push) { try { history.replaceState(null, "", "#" + (scrollTo || key)); } catch { /* ignore */ } }
  const target = scrollTo && document.getElementById(scrollTo);
  // Jump rather than glide: the old scroll position belongs to a different tab.
  if (target && target !== panel) target.scrollIntoView({ block: "start", behavior: "instant" });
  else if (key === "home") window.scrollTo({ top: 0, behavior: "instant" });
  else if (thumbs && window.scrollY > thumbs.offsetTop) window.scrollTo({ top: thumbs.offsetTop, behavior: "instant" });
  if (focus) $(`#t-${key}`)?.focus();
}
window.__showTab = showTab;

function route(id, push) {
  if (!id) return showTab("home", { push: false });
  if (keys.includes(id)) return showTab(id, { push });
  const el = document.getElementById(id);
  const panel = el && el.closest(".tabpanel");
  if (panel) return showTab(panel.dataset.tab, { scrollTo: id, push });
  showTab("home", { push: false });
}

if (thumbRow) {
  thumbRow.addEventListener("click", e => {
    const b = e.target.closest("[data-tab-btn]");
    if (b) showTab(b.dataset.tabBtn);
  });
  thumbRow.addEventListener("keydown", e => {
    const i = keys.indexOf(current);
    let j = null;
    if (e.key === "ArrowRight") j = (i + 1) % keys.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + keys.length) % keys.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = keys.length - 1;
    if (j === null) return;
    e.preventDefault();
    showTab(keys[j], { focus: true });
  });
}
document.addEventListener("click", e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || a.hasAttribute("data-card")) return;
  const id = a.getAttribute("href").slice(1);
  if (!id) return;
  if (!keys.includes(id) && !document.getElementById(id)) return;
  e.preventDefault();
  route(id, true);
});
window.addEventListener("hashchange", () => route(location.hash.slice(1), false));
route(location.hash.slice(1), false);
})();

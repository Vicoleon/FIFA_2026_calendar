// ============================================================
//  Quiniela Mundial 2026 — bootstrap + router + delegación de acciones.
//  Carga datos, gestiona sesión (Google), realtime e invitaciones.
// ============================================================
import { state, loadAll } from "./lib/state.js";
import { db } from "./lib/db.js";
import { $, $$, toast } from "./lib/dom.js";

import * as auth from "./auth.js";
import * as calendar from "./calendar.js";
import * as picks from "./picks.js";
import * as leaderboard from "./leaderboard.js";
import * as groups from "./groups.js";
import * as invites from "./invites.js";
import * as crowd from "./crowd.js";
import * as share from "./share.js";
import * as profile from "./profile.js";
import * as reminders from "./reminders.js";

// Vistas: clave -> { render(): string|Promise<string>, wire?(container) }
const VIEWS = {
  calendario:    { render: calendar.renderCalendar },
  grupos:        { render: calendar.renderGroups },
  eliminatorias: { render: calendar.renderBracket },
  miquiniela:    { render: picks.renderMiQuiniela },
  tabla:         { render: leaderboard.renderTabla, wire: leaderboard.wireTabla },
  misgrupos:     { render: groups.renderGrupos,     wire: groups.wireGrupos },
  perfil:        { render: profile.renderPerfil,    wire: profile.wirePerfil }
};

// Registro de acciones (data-act -> fn(btn)). Se fusiona de cada módulo.
const actionRegistry = Object.assign(
  {},
  calendar.actions, picks.actions, crowd.actions,
  groups.actions, invites.actions, share.actions,
  profile.actions, leaderboard.actions, reminders.actions
);

function navigate(view) {
  if (!VIEWS[view]) view = "calendario";
  state.view = view;
  render();
}

async function refresh() {
  await loadAll();
  render();
}

function renderTopbar() {
  const area = $("#auth-area");
  if (area) { area.innerHTML = auth.authBarHtml(); auth.wireAuthBar(navigate); }
  const recalc = $("#btn-recalc");
  if (recalc) recalc.hidden = !auth.isEditor();
  const pred = $("#btn-pred");
  if (pred) pred.classList.toggle("off", !state.showPred);
  $$(".tab[data-auth]").forEach((t) => t.classList.toggle("needs-auth", !state.session));
}

async function render() {
  renderTopbar();

  const rem = $("#reminder");
  if (rem) rem.innerHTML = state.session ? (reminders.reminderBanner?.() || "") : "";

  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === state.view));

  const view = VIEWS[state.view] || VIEWS.calendario;
  const content = $("#content");
  content.innerHTML = `<p class="loading">Cargando…</p>`;
  try {
    content.innerHTML = await view.render();
    view.wire?.(content);
  } catch (e) {
    console.error(e);
    content.innerHTML = `<p class="error">⚠️ ${e.message || "Error cargando la vista"}</p>`;
  }
}

function onAction(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const fn = actionRegistry[btn.dataset.act];
  if (fn) { e.preventDefault(); fn(btn); }
}

function wireStatic() {
  $$(".tab").forEach((t) => (t.onclick = () => navigate(t.dataset.view)));
  const pred = $("#btn-pred");
  if (pred) pred.onclick = () => { state.showPred = !state.showPred; render(); };
  const recalc = $("#btn-recalc");
  if (recalc) recalc.onclick = () => calendar.recalcPredictions();
}

function subscribeRealtime() {
  db.channel("rt-quiniela")
    .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_stats" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "picks" }, () => {
      if (state.view === "tabla" || state.view === "misgrupos") refresh();
    })
    .subscribe();
}

(async function init() {
  let booted = false;
  wireStatic();
  document.body.addEventListener("click", onAction);
  document.addEventListener("quiniela:refresh", refresh);
  document.addEventListener("quiniela:nav", (e) => navigate(e.detail.view));

  await auth.initAuth(() => { if (booted) refresh(); });
  try {
    await loadAll();
  } catch (e) {
    toast(e.message, "error");
  }
  try {
    const dest = await invites.maybeHandleInviteParam(); // puede unir a un grupo
    if (dest) state.view = dest;
  } catch (e) {
    console.warn("invite:", e);
  }
  render();
  subscribeRealtime();
  booted = true;
})();

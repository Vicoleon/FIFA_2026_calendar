// ============================================================
//  Capa de QUINIELA montada sobre el app principal (app.js).
//  app.js (clásico) renderiza calendario/grupos/eliminatorias y expone
//  window.WC = { state, db, render, ... }. Esta capa (módulo ES) añade:
//   - Inicio de sesión con Google + barra de sesión.
//   - Widget de pronóstico en cada tarjeta (window.Quiniela.pickWidget).
//   - Vistas Mi Quiniela / Tabla / Mis grupos / Perfil.
//   - Banner de recordatorio, invitaciones, y tema ligado al usuario.
// ============================================================
import { state as q, loadAll as qLoadAll } from "./lib/state.js";
import { $, $$ } from "./lib/dom.js";
import * as auth from "./auth.js";
import * as picks from "./picks.js";
import * as leaderboard from "./leaderboard.js";
import * as groups from "./groups.js";
import * as invites from "./invites.js";
import * as crowd from "./crowd.js";
import * as share from "./share.js";
import * as profile from "./profile.js";
import * as reminders from "./reminders.js";
import * as theme from "./theme.js";

// Vistas propias de la quiniela (clave de pestaña -> render async).
const QVIEWS = {
  miquiniela: { render: picks.renderMiQuiniela },
  tabla:      { render: leaderboard.renderTabla, wire: leaderboard.wireTabla },
  misgrupos:  { render: groups.renderGrupos,     wire: groups.wireGrupos },
  perfil:     { render: profile.renderPerfil,    wire: profile.wirePerfil }
};

// Acciones de botones (data-act) de todos los módulos de quiniela.
const actions = Object.assign(
  {}, picks.actions, crowd.actions, groups.actions,
  invites.actions, share.actions, profile.actions, leaderboard.actions, reminders.actions
);

// API que consume app.js para inyectar el widget y delegar vistas.
window.Quiniela = {
  pickWidget: (m) => picks.pickWidget(m),
  isView: (v) => v in QVIEWS,
  async renderInto(view) {
    const el = $("#content");
    if (!el || !QVIEWS[view]) return;
    el.innerHTML = `<p class="loading">Cargando…</p>`;
    try {
      el.innerHTML = await QVIEWS[view].render();
      QVIEWS[view].wire?.(el);
    } catch (e) {
      console.error(e);
      el.innerHTML = `<p class="error">⚠️ ${e.message || "Error cargando la vista"}</p>`;
    }
  }
};

const mainRender = () => window.WC?.render?.();

/** Cambia de vista a través del estado de app.js (resalta pestañas + delega). */
function navigate(view) {
  if (window.WC?.state) { window.WC.state.view = view; mainRender(); }
}

/** Pinta la barra de sesión y el banner de recordatorio (chrome de quiniela). */
function renderChrome() {
  const a = $("#q-auth");
  if (a) { a.innerHTML = auth.authBarHtml(); auth.wireAuthBar(navigate); }
  const r = $("#q-reminder");
  if (r) r.innerHTML = q.session ? (reminders.reminderBanner?.() || "") : "";
}

async function reloadAndRender() {
  await qLoadAll();
  renderChrome();
  mainRender(); // re-pinta tarjetas (con widgets actualizados) o la vista de quiniela activa
}

(async function boot() {
  // Delegado global de acciones de quiniela (los botones fuera de tarjeta los ignora app.js).
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const fn = actions[btn.dataset.act];
    if (fn) { e.preventDefault(); fn(btn); }
  });

  document.addEventListener("quiniela:refresh", reloadAndRender);
  document.addEventListener("quiniela:nav", (e) => navigate(e.detail.view));

  // Tema ligado al usuario: además del panel de app.js, guarda la elección en el perfil.
  $$(".td-opt").forEach((o) => o.addEventListener("click", () => theme.applyTheme(o.dataset.themeId)));

  // Sesión Google: al cambiar, recarga datos del usuario, aplica su tema y re-pinta.
  await auth.initAuth(async () => { theme.applyUserTheme(); await reloadAndRender(); });

  await qLoadAll();
  theme.applyUserTheme();
  renderChrome();

  try {
    const dest = await invites.maybeHandleInviteParam(); // ?invite= -> unirse a grupo
    if (dest) navigate(dest);
  } catch (e) { console.warn("invite:", e); }

  mainRender(); // ya con picks cargados: inyecta los widgets en las tarjetas
})();

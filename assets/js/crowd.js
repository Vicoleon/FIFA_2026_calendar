// ============================================================
//  Sabiduría de masas + cara a cara (head-to-head).
//  Se abre desde la tarjeta de un partido ya iniciado/finalizado.
//  Muestra la distribución de pronósticos del grupo y compara
//  tus picks contra los de un rival (solo partidos ya iniciados).
// ============================================================
import { db, rpc } from "./lib/db.js";
import { state } from "./lib/state.js";
import { esc, h } from "./lib/dom.js";
import { teamName, teamChip } from "./lib/teams.js";

// ── Acción de tarjeta (enrutada por el delegado global de app.js) ──
export const actions = {
  // Lee el id del partido desde la tarjeta (.card) o fila (.mq-row), con respaldo en el botón.
  crowd: (btn) => {
    const host = btn.closest(".card,.mq-row");
    const mid = host ? +host.dataset.mid : +btn.dataset.mid;
    if (mid) openCrowd(mid);
  }
};

/**
 * Abre el modal de "Picks del grupo" para un partido.
 * @param {number} matchId
 */
export async function openCrowd(matchId) {
  // Modal contenedor reutilizando las clases existentes.
  const dlg = h("div", { class: "modal" },
    h("div", { class: "modal-box crowd-box" })
  );
  document.body.appendChild(dlg);
  const box = dlg.querySelector(".modal-box");

  const close = () => dlg.remove();
  // Cierre al hacer clic en el fondo (fuera de la caja).
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });

  const match = state.matches.find((m) => m.id === matchId);

  // Defensa en profundidad: si no hay sesión, CTA de login (no depender del gating externo).
  if (!state.session) {
    box.innerHTML = `
      <h3>👥 Picks del grupo</h3>
      <p class="muted">Inicia sesión para ver los pronósticos de tu grupo.</p>
      <div class="modal-actions">
        <button class="btn btn-primary" data-act="signin">Iniciar sesión</button>
        <button class="btn" id="crowd-close">Cerrar</button>
      </div>`;
    box.querySelector("#crowd-close").onclick = close;
    return;
  }

  // Sin grupos: mensaje y cierre.
  if (!state.myGroups.length) {
    box.innerHTML = `
      <h3>👥 Picks del grupo</h3>
      <p class="muted">Aún no perteneces a ningún grupo. Crea o únete a uno en
        <b>Mis grupos</b> para comparar pronósticos con tus amigos.</p>
      <div class="modal-actions"><button class="btn" data-crowd-close>Cerrar</button></div>`;
    box.querySelector("[data-crowd-close]").onclick = close;
    return;
  }

  // Estado local del modal (no toca el estado global de la app).
  const view = {
    matchId,
    match,
    gid: state.myGroups[0].id,   // grupo por defecto: el primero
    rivalId: "",                  // rival elegido para el cara a cara
    members: []                   // miembros del grupo seleccionado
  };

  // Pinta el armazón fijo (cabecera, selector de grupo, secciones) una sola vez.
  box.innerHTML = shellHtml(view);
  box.querySelector("[data-crowd-close]").onclick = close;

  const groupSel = box.querySelector(".crowd-group");
  if (groupSel) {
    groupSel.onchange = async () => {
      view.gid = groupSel.value;
      view.rivalId = "";
      await loadGroup(box, view);
    };
  }

  await loadGroup(box, view);
}

/** Armazón estable del modal (no se reescribe al cambiar de rival). */
function shellHtml(view) {
  const m = view.match;
  const title = m
    ? `M${m.id}: ${esc(teamName(m._home) || "Local")} vs ${esc(teamName(m._away) || "Visita")}`
    : "Picks del grupo";

  const groupPicker = state.myGroups.length > 1
    ? `<label class="crowd-pick-group">Grupo
        <select class="crowd-group">
          ${state.myGroups.map((g) =>
            `<option value="${esc(g.id)}" ${g.id === view.gid ? "selected" : ""}>${esc(g.name)}</option>`
          ).join("")}
        </select></label>`
    : `<p class="crowd-onegroup">Grupo: <b>${esc(state.myGroups[0].name)}</b></p>`;

  return `
    <h3>👥 ${title}</h3>
    ${groupPicker}
    <section class="crowd-dist"><p class="loading">Cargando…</p></section>
    <hr class="crowd-sep">
    <section class="crowd-h2h"></section>
    <div class="modal-actions"><button class="btn" data-crowd-close>Cerrar</button></div>`;
}

/** Carga distribución + miembros del grupo seleccionado y re-renderiza secciones. */
async function loadGroup(box, view) {
  const distEl = box.querySelector(".crowd-dist");
  const h2hEl = box.querySelector(".crowd-h2h");
  distEl.innerHTML = `<p class="loading">Cargando…</p>`;
  h2hEl.innerHTML = "";

  // Distribución (sabiduría de masas).
  try {
    const dist = await rpc("group_pick_distribution", { p_group: view.gid, p_match: view.matchId });
    distEl.innerHTML = distributionHtml(view.match, dist || []);
  } catch (e) {
    distEl.innerHTML = `<p class="error">⚠️ ${esc(e.message || "No disponible")}</p>`;
  }

  // Miembros del grupo (para el selector de rival del cara a cara).
  const { data, error } = await db
    .from("leaderboard_group")
    .select("*")
    .eq("group_id", view.gid);
  view.members = error ? [] : (data || []);

  renderH2H(box, view);
}

/** Barras de % por desenlace: victoria local / empate / victoria visita. */
function distributionHtml(match, dist) {
  const counts = { home: 0, draw: 0, away: 0 };
  dist.forEach((r) => { if (r.outcome in counts) counts[r.outcome] = r.n || 0; });
  const total = counts.home + counts.draw + counts.away;

  if (!total) {
    return `<h4 class="crowd-h">🔮 Sabiduría de masas</h4>
      <p class="muted">Nadie del grupo pronosticó este partido.</p>`;
  }

  const homeLabel = match ? esc(teamName(match._home) || "Local") : "Local";
  const awayLabel = match ? esc(teamName(match._away) || "Visita") : "Visita";

  const rows = [
    ["home", `Gana ${homeLabel}`, counts.home],
    ["draw", "Empate", counts.draw],
    ["away", `Gana ${awayLabel}`, counts.away]
  ];

  const bars = rows.map(([key, label, n]) => {
    const pct = Math.round((n / total) * 100);
    return `
      <div class="crowd-row">
        <span class="crowd-row-label">${label}</span>
        <span class="crowd-bar"><span class="crowd-fill crowd-fill--${key}" style="width:${pct}%"></span></span>
        <span class="crowd-row-pct">${pct}% · ${n}</span>
      </div>`;
  }).join("");

  return `<h4 class="crowd-h">🔮 Sabiduría de masas · ${total} pronóstico${total === 1 ? "" : "s"}</h4>
    <div class="crowd-bars">${bars}</div>`;
}

/** Renderiza la sección cara a cara: selector de rival + tabla comparativa. */
function renderH2H(box, view) {
  const h2hEl = box.querySelector(".crowd-h2h");
  const myUid = state.session?.user?.id;
  // Rivales = miembros del grupo distintos a mí.
  const rivals = view.members.filter((mem) => mem.user_id !== myUid);

  if (!rivals.length) {
    h2hEl.innerHTML = `<h4 class="crowd-h">⚔️ Cara a cara</h4>
      <p class="muted">Aún no hay otros miembros en este grupo.</p>`;
    return;
  }

  const picker = `
    <label class="crowd-pick-rival">Comparar contra
      <select class="crowd-rival">
        <option value="">— elige un rival —</option>
        ${rivals.map((r) =>
          `<option value="${esc(r.user_id)}" ${r.user_id === view.rivalId ? "selected" : ""}>${
            esc(r.display_name || "Jugador")
          } · ${r.total_pts} pts</option>`
        ).join("")}
      </select></label>`;

  h2hEl.innerHTML = `<h4 class="crowd-h">⚔️ Cara a cara</h4>${picker}
    <div class="crowd-h2h-body"></div>`;

  const sel = h2hEl.querySelector(".crowd-rival");
  sel.onchange = async () => {
    view.rivalId = sel.value;
    await renderH2HBody(h2hEl.querySelector(".crowd-h2h-body"), view);
  };

  if (view.rivalId) {
    renderH2HBody(h2hEl.querySelector(".crowd-h2h-body"), view);
  }
}

/** Tabla comparativa de picks (solo partidos ya iniciados, donde RLS revela los del rival). */
async function renderH2HBody(bodyEl, view) {
  if (!view.rivalId) { bodyEl.innerHTML = ""; return; }
  bodyEl.innerHTML = `<p class="loading">Cargando…</p>`;

  // RLS solo devuelve picks ajenos de partidos ya iniciados.
  const { data, error } = await db.from("picks").select("*").eq("user_id", view.rivalId);
  if (error) { bodyEl.innerHTML = `<p class="error">⚠️ ${esc(error.message)}</p>`; return; }

  const rivalPicks = Object.fromEntries((data || []).map((p) => [p.match_id, p]));
  const rivalName = esc(view.members.find((m) => m.user_id === view.rivalId)?.display_name || "Rival");

  // Partidos ya iniciados donde al menos uno de los dos tiene pick visible.
  const rows = state.matches
    .filter((m) => m.kickoff && new Date(m.kickoff).getTime() <= Date.now())
    .filter((m) => state.myPicks[m.id] || rivalPicks[m.id])
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));

  if (!rows.length) {
    bodyEl.innerHTML = `<p class="muted">Todavía no hay partidos iniciados para comparar.</p>`;
    return;
  }

  // Marcador acumulado de la comparación.
  let myTotal = 0, rivalTotal = 0;
  const trs = rows.map((m) => {
    const mine = state.myPicks[m.id];
    const theirs = rivalPicks[m.id];
    myTotal += mine?.points || 0;
    rivalTotal += theirs?.points || 0;
    return `
      <tr>
        <td class="crowd-mlabel">${teamChip(m._home, m.home_placeholder)}
          <span class="crowd-vs">vs</span> ${teamChip(m._away, m.away_placeholder)}</td>
        <td class="crowd-cell">${pickCell(mine)}</td>
        <td class="crowd-cell">${pickCell(theirs)}</td>
      </tr>`;
  }).join("");

  bodyEl.innerHTML = `
    <table class="crowd-table">
      <thead><tr>
        <th>Partido</th>
        <th>Tú · ${myTotal} pts</th>
        <th>${rivalName} · ${rivalTotal} pts</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>`;
}

/** Celda con el pick (marcador + puntos) o guion si no hay. */
function pickCell(p) {
  if (!p) return `<span class="muted">—</span>`;
  const pts = p.points != null
    ? `<span class="crowd-pts ${p.exact ? "is-exact" : p.points ? "is-ok" : "is-miss"}">${p.points} pts${p.exact ? " 🎯" : ""}</span>`
    : "";
  return `<b>${p.home_score}–${p.away_score}</b>${p.is_joker ? " ★" : ""} ${pts}`;
}

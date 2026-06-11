// ============================================================
//  Tabla de posiciones (global + por grupo) en vivo.
//  Lee de las vistas leaderboard_global / leaderboard_group.
//  La vista devuelve un HTML string; las acciones se enrutan por
//  el delegado global (data-act) definido en app.js.
// ============================================================
import { db, siteUrl } from "./lib/db.js";
import { state } from "./lib/state.js";
import { esc, refreshApp } from "./lib/dom.js";

// Alcance actual de la tabla: "global" o el id (uuid) de un grupo.
let scope = "global";

const MEDALS = ["🥇", "🥈", "🥉"];

/** Vista principal "Tabla de posiciones". Devuelve un HTML string. */
export async function renderTabla() {
  // Sin sesión: CTA para iniciar sesión.
  if (!state.session) {
    return `<section class="panel center">
      <h2>🏆 Tabla de posiciones</h2>
      <p>Inicia sesión con Google para ver tu posición y competir con tus amigos.</p>
      <button class="btn btn-primary btn-google" data-act="signin"><span class="g">G</span> Iniciar sesión</button>
    </section>`;
  }

  // Si el alcance apunta a un grupo que ya no existe, volver a global.
  if (scope !== "global" && !state.myGroups.some((g) => g.id === scope)) {
    scope = "global";
  }

  // Consultar la vista correspondiente al alcance.
  let rows;
  try {
    rows = await fetchRows(scope);
  } catch (e) {
    return `<section class="panel">
      ${scopePicker()}
      <p class="error">⚠️ ${esc(e.message || "No se pudo cargar la tabla")}</p>
    </section>`;
  }

  if (!rows.length) {
    return `<section class="panel">
      ${scopePicker()}
      <p class="muted">Aún no hay puntos registrados. ¡Sé el primero en pronosticar!</p>
    </section>`;
  }

  const myId = state.session.user.id;
  const me = rows.find((r) => r.user_id === myId);
  const myRank = me ? rows.indexOf(me) + 1 : null;

  return `
    <section class="panel">
      ${scopePicker()}
      <div class="lb-wrap">
        <table class="lb-table">
          <thead>
            <tr>
              <th class="lb-pos">#</th>
              <th class="lb-player">Jugador</th>
              <th class="lb-num" title="Partidos jugados">PJ</th>
              <th class="lb-num" title="Marcadores exactos">🎯</th>
              <th class="lb-num lb-pts">Puntos</th>
            </tr>
          </thead>
          <tbody>${rows.map((r, i) => lbRow(r, i, myId)).join("")}</tbody>
        </table>
      </div>
      ${shareButton(myRank, me, scope)}
    </section>`;
}

/** Consulta y ordena las filas para el alcance dado. */
async function fetchRows(currentScope) {
  const query =
    currentScope === "global"
      ? db.from("leaderboard_global").select("*")
      : db.from("leaderboard_group").select("*").eq("group_id", currentScope);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return sortRows(data || []);
}

/** Orden: puntos desc, exactos desc, luego quien acertó antes (last_correct_at asc). */
function sortRows(rows) {
  return rows.slice().sort((a, b) => {
    if (b.total_pts !== a.total_pts) return b.total_pts - a.total_pts;
    if (b.exact_count !== a.exact_count) return b.exact_count - a.exact_count;
    return lastCorrectMs(a) - lastCorrectMs(b);
  });
}

/** Timestamp en ms de last_correct_at; sin valor va al final (Infinity). */
function lastCorrectMs(row) {
  return row.last_correct_at ? new Date(row.last_correct_at).getTime() : Infinity;
}

/** Selector de alcance: Global + cada grupo del usuario. */
function scopePicker() {
  const opt = (val, label, active) =>
    `<button class="btn btn-sm ${active ? "btn-primary" : "btn-ghost"}"
             data-act="lb-scope" data-scope="${esc(val)}">${esc(label)}</button>`;

  const groupOpts = state.myGroups
    .map((g) => opt(g.id, g.name, scope === g.id))
    .join("");

  return `<div class="lb-scope">
      ${opt("global", "🌎 Global", scope === "global")}
      ${groupOpts}
    </div>`;
}

/** Fila de la tabla. Resalta al usuario actual. */
function lbRow(r, index, myId) {
  const pos = index + 1;
  const medal = MEDALS[index] || pos;
  const isMe = r.user_id === myId;
  const name = r.display_name || "Jugador";

  return `
    <tr class="lb-tr${isMe ? " is-me" : ""}">
      <td class="lb-pos">${medal}</td>
      <td class="lb-player">
        ${avatarHtml(r.avatar_url, name)}
        <span class="lb-name">${esc(name)}${isMe ? ' <span class="lb-you">(tú)</span>' : ""}</span>
      </td>
      <td class="lb-num">${r.played ?? 0}</td>
      <td class="lb-num">${r.exact_count ?? 0}</td>
      <td class="lb-num lb-pts"><b>${r.total_pts ?? 0}</b></td>
    </tr>`;
}

/** Avatar circular; si no hay imagen, usa la inicial del nombre. */
function avatarHtml(url, name) {
  if (url) {
    return `<img class="avatar lb-avatar" src="${esc(url)}" alt="" referrerpolicy="no-referrer">`;
  }
  const initial = esc((name[0] || "?").toUpperCase());
  return `<span class="avatar avatar--fallback lb-avatar">${initial}</span>`;
}

/** Botón para compartir la posición del usuario (lo procesa share.js). */
function shareButton(rank, me, currentScope) {
  if (!me || !rank) return "";

  const scopeLabel =
    currentScope === "global"
      ? "Global"
      : state.myGroups.find((g) => g.id === currentScope)?.name || "mi grupo";

  const title = `Voy #${rank} en la quiniela · FIFA Calendario 2026`;
  const subtitle = `${scopeLabel} · ${me.total_pts} pts · ${me.exact_count} exactos 🎯`;
  const big = `#${rank} · ${me.total_pts} pts`;

  return `<div class="lb-share">
      <button class="btn btn-primary btn-sm" data-act="share-card"
              data-title="${esc(title)}"
              data-subtitle="${esc(subtitle)}"
              data-big="${esc(big)}"
              data-link="${esc(siteUrl())}">📤 Compartir mi posición</button>
    </div>`;
}

/** El delegado global ya maneja data-act; aquí no hace falta cablear nada. */
export function wireTabla(_container) {}

// ── Acciones (enrutadas por el delegado global de app.js) ──
export const actions = {
  // Cambia el alcance y re-renderiza la vista actual.
  "lb-scope": (btn) => {
    scope = btn.dataset.scope || "global";
    refreshApp();
  }
};

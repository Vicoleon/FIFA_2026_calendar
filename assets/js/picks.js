// ============================================================
//  Picks (pronósticos del usuario): widget en cada tarjeta,
//  guardado/borrado, Joker, y la vista "Mi Quiniela".
// ============================================================
import { db, rpc } from "./lib/db.js";
import { state, STAGE_LABEL } from "./lib/state.js";
import { loadUserData } from "./lib/state.js";
import { esc, fmtDate, hasKickedOff, toast, refreshApp } from "./lib/dom.js";
import { teamChip } from "./lib/teams.js";
import { signInWithGoogle } from "./auth.js";

const MAX_GOALS = 30;

/** Widget de pronóstico para una tarjeta de partido. Devuelve HTML. */
export function pickWidget(m) {
  if (m.status === "finished") return finishedPickHtml(m);

  const known = !!(m._home && m._away);
  if (!known) {
    return `<div class="pick pick--wait">⏳ Disponible cuando se definan los equipos</div>`;
  }
  if (!state.session) {
    return `<div class="pick pick--cta">🔒 <button class="lnk" data-act="signin">Inicia sesión</button> para pronosticar</div>`;
  }
  if (hasKickedOff(m)) {
    const p = state.myPicks[m.id];
    return `<div class="pick pick--locked">${
      p ? `🔒 Tu pronóstico: <b>${p.home_score}–${p.away_score}</b>${p.is_joker ? " ★" : ""}`
        : `🔒 No pronosticaste este partido`
    }</div>`;
  }

  const p = state.myPicks[m.id];
  return `
    <div class="pick pick--edit" data-mid="${m.id}">
      <span class="pick-tag">📝 Tu pronóstico</span>
      <div class="pick-inputs">
        <input class="pk-h" type="number" min="0" max="${MAX_GOALS}" inputmode="numeric"
               value="${p?.home_score ?? ""}" aria-label="Goles ${esc(teamNameSafe(m._home))}">
        <span class="pk-dash">–</span>
        <input class="pk-a" type="number" min="0" max="${MAX_GOALS}" inputmode="numeric"
               value="${p?.away_score ?? ""}" aria-label="Goles ${esc(teamNameSafe(m._away))}">
        <button class="pk-joker ${p?.is_joker ? "on" : ""}" data-act="joker"
                title="Joker: dobla los puntos de este partido (máx. 1 por jornada)">★</button>
        <button class="btn btn-sm btn-primary" data-act="savepick">${p ? "Actualizar" : "Guardar"}</button>
        ${p ? `<button class="lnk pk-del" data-act="delpick">Borrar</button>` : ""}
      </div>
    </div>`;
}

function finishedPickHtml(m) {
  const p = state.myPicks[m.id];
  if (!state.session || !p) {
    return state.session ? `<div class="pick pick--locked">— sin pronóstico —</div>` : "";
  }
  const badge = p.exact ? "🎯 Exacto" : (p.points ? "✓ Resultado" : "✗");
  const cls = p.exact ? "ok-exact" : (p.points ? "ok-outcome" : "ok-miss");
  return `<div class="pick pick--result ${cls}">
      Tu pronóstico: <b>${p.home_score}–${p.away_score}</b>${p.is_joker ? " ★" : ""}
      · <span class="pts">${p.points ?? 0} pts</span> <span class="resbadge">${badge}</span>
    </div>`;
}

function teamNameSafe(id) { return state.teamMap[id]?.name_es || id || ""; }

// ── Acciones (las enruta el delegado global de app.js por data-act) ──
export const actions = {
  signin: () => signInWithGoogle(),
  joker: (btn) => { btn.classList.toggle("on"); },
  savepick: (btn) => savePickFromEl(btn.closest(".pick")),
  delpick: (btn) => delPickFromEl(btn.closest(".pick")),
  // Abre la carrera de la quiniela (la pinta app.js en la vista "carrera").
  vercarrera: () => document.dispatchEvent(new CustomEvent("quiniela:nav", { detail: { view: "carrera" } }))
};

async function savePickFromEl(pickEl) {
  if (!pickEl) return;
  const mid = +pickEl.dataset.mid;
  const hv = pickEl.querySelector(".pk-h").value;
  const av = pickEl.querySelector(".pk-a").value;
  const joker = pickEl.querySelector(".pk-joker")?.classList.contains("on") || false;
  if (hv === "" || av === "") { toast("Escribe ambos marcadores", "error"); return; }
  const h = Number(hv), a = Number(av);
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > MAX_GOALS || a > MAX_GOALS) {
    toast("Marcador inválido", "error"); return;
  }
  await savePick(mid, h, a, joker);
}

export async function savePick(matchId, home, away, joker) {
  const uid = state.session?.user?.id;
  if (!uid) { toast("Inicia sesión para jugar", "error"); return; }
  try {
    // Vía RPC security-definer: valida sesión + bloqueo por kickoff + regla del Joker.
    await rpc("save_pick", { p_match_id: matchId, p_home: home, p_away: away, p_joker: joker });
  } catch (e) {
    toast(e.message, "error");
    return;
  }
  toast("Pronóstico guardado ✓", "success");
  await loadUserData();
  refreshApp();
}

async function delPickFromEl(pickEl) {
  if (!pickEl) return;
  const mid = +pickEl.dataset.mid;
  const uid = state.session?.user?.id;
  const { error } = await db.from("picks").delete().eq("user_id", uid).eq("match_id", mid);
  if (error) { toast(error.message, "error"); return; }
  toast("Pronóstico borrado");
  await loadUserData();
  refreshApp();
}

// ── Vista "Mi Quiniela" ──

/** Botón-banner que abre la carrera de la quiniela (visible con o sin sesión). */
function raceEntryHtml(subtitle) {
  return `
    <button class="mq-race" data-act="vercarrera" aria-label="Ver la carrera de la quiniela">
      <span class="mq-race-ic" aria-hidden="true">🏇</span>
      <span class="mq-race-tx">
        <b>Ver la carrera de la quiniela</b>
        <span>${subtitle}</span>
      </span>
      <span class="mq-race-go" aria-hidden="true">→</span>
    </button>`;
}

export function renderMiQuiniela() {
  if (!state.session) {
    return `<section class="panel center">
      <h2>📝 Mi Quiniela</h2>
      <p>Inicia sesión con Google para pronosticar los marcadores y competir con tus amigos.</p>
      <button class="btn btn-primary btn-google" data-act="signin"><span class="g">G</span> Iniciar sesión</button>
      <div class="mq-or">o</div>
      ${raceEntryHtml("Con el código de tu grupo — sin iniciar sesión")}
    </section>`;
  }

  // Todos los partidos próximos (con equipos, sin terminar y sin haber iniciado),
  // pronosticados o no, en orden cronológico: así "los de hoy y mañana" siempre se ven.
  const upcoming = state.matches
    .filter((m) => m._home && m._away && m.status !== "finished" && !hasKickedOff(m))
    .sort(byKickoff);
  const pendingCount = upcoming.filter((m) => !state.myPicks[m.id]).length;
  const finished = state.matches.filter((m) => m.status === "finished" && state.myPicks[m.id])
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));

  const totalPts = Object.values(state.myPicks).reduce((s, p) => s + (p.points || 0), 0);
  const exactCount = Object.values(state.myPicks).filter((p) => p.exact).length;

  return `
    <section class="panel">
      <div class="mq-summary">
        <div class="stat"><b>${totalPts}</b><span>puntos</span></div>
        <div class="stat"><b>${exactCount}</b><span>exactos 🎯</span></div>
        <div class="stat stat--warn"><b>${pendingCount}</b><span>por jugar</span></div>
      </div>

      ${raceEntryHtml("Mira cómo va tu grupo, día a día")}

      ${section("⚽ Próximos partidos", upcoming, "No hay próximos partidos disponibles ahora mismo.")}
      ${section("🏁 Resultados", finished, "")}
    </section>`;
}

function section(title, list, emptyMsg) {
  if (!list.length && !emptyMsg) return "";
  if (!list.length) return `<h3 class="mq-h">${title}</h3><p class="muted">${emptyMsg}</p>`;
  return `<h3 class="mq-h">${title}</h3>
    <div class="mq-list">${list.map(quinielaRow).join("")}</div>`;
}

function quinielaRow(m) {
  const pend = m.status !== "finished" && !state.myPicks[m.id] && !hasKickedOff(m);
  return `
    <article class="mq-row ${m.status === "finished" ? "is-done" : ""} ${pend ? "is-pending" : ""}" data-mid="${m.id}">
      <div class="mq-meta">
        <span class="mno">M${m.id} · ${STAGE_LABEL[m.stage]}${m.group_code ? " " + m.group_code : ""}${pend ? ' · <span class="mq-pend">Pendiente</span>' : ""}</span>
        <span class="mdate">🗓️ ${fmtDate(m.kickoff)}</span>
      </div>
      <div class="mq-teams">
        ${teamChip(m._home, m.home_placeholder)}
        <span class="mq-vs">${m.status === "finished" ? `${m.home_score}–${m.away_score}` : "vs"}</span>
        ${teamChip(m._away, m.away_placeholder)}
      </div>
      ${pickWidget(m)}
    </article>`;
}

const byKickoff = (a, b) => new Date(a.kickoff) - new Date(b.kickoff);

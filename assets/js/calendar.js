// ============================================================
//  Calendario: vistas Grupos / Eliminatorias / Calendario,
//  tarjeta de partido (con widget de pronóstico), panel de
//  estadísticas y editor de resultados (solo editores).
// ============================================================
import { db } from "./lib/db.js";
import { state, GROUPS, STAGE_LABEL, STAT_FIELDS } from "./lib/state.js";
import { $, $$, esc, fmtDate, toast, refreshApp } from "./lib/dom.js";
import { teamChip } from "./lib/teams.js";
import { pickWidget } from "./picks.js";
import { isEditor } from "./auth.js";

function predBar(p) {
  if (!p) return "";
  const hh = Math.round(p.pHomeWin * 100), d = Math.round(p.pDraw * 100), a = Math.round(p.pAwayWin * 100);
  return `
    <div class="pred">
      <div class="pred-score">🔮 Pronóstico de la casa: <b>${p.predHome} - ${p.predAway}</b></div>
      <div class="pred-bar">
        <span class="pb pb-h" style="width:${hh}%" title="Local ${hh}%">${hh}%</span>
        <span class="pb pb-d" style="width:${d}%" title="Empate ${d}%">${d}%</span>
        <span class="pb pb-a" style="width:${a}%" title="Visita ${a}%">${a}%</span>
      </div>
    </div>`;
}

export function matchCard(m) {
  const finished = m.status === "finished";
  const score = finished
    ? `<span class="score">${m.home_score} - ${m.away_score}</span>`
    : `<span class="vs">vs</span>`;
  const hasStats = state.stats[m.id] && Object.keys(state.stats[m.id]).length;
  const canEdit = isEditor();
  const canCrowd = finished && state.session && state.myGroups.length;

  return `
  <article class="card ${finished ? "card--done" : ""}" data-mid="${m.id}">
    <header class="card-top">
      <span class="mno">M${m.id} · ${STAGE_LABEL[m.stage]}${m.group_code ? " " + m.group_code : ""}</span>
      <span class="mvenue">📍 ${esc(m.venue || "Por definir")}</span>
    </header>
    <div class="card-mid">
      ${teamChip(m._home, m.home_placeholder)}
      ${score}
      ${teamChip(m._away, m.away_placeholder)}
    </div>
    <div class="card-pick">${pickWidget(m)}</div>
    <footer class="card-bot">
      <span class="mdate">🗓️ ${fmtDate(m.kickoff)}</span>
      <span class="actions">
        ${canCrowd ? `<button class="lnk" data-act="crowd">👥 Picks del grupo</button>` : ""}
        ${finished && hasStats ? `<button class="lnk" data-act="stats">📊 Estadísticas</button>` : ""}
        ${canEdit ? `<button class="lnk" data-act="edit">✏️ Editar</button>` : ""}
      </span>
    </footer>
    ${state.showPred && !finished ? predBar(m._pred) : ""}
    <div class="stats-panel" hidden></div>
  </article>`;
}

// ── Vistas ──
export function renderGroups() {
  return GROUPS.map((g) => {
    const table = window.Standings.groupTable(state.teams, state.matches, g);
    const gm = state.matches.filter((m) => m.stage === "group" && m.group_code === g);
    return `
    <section class="group">
      <h3>Grupo ${g}</h3>
      <table class="gtable">
        <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th></tr></thead>
        <tbody>
          ${table.map((r, i) => `
            <tr class="${i < 2 ? "qual" : i === 2 ? "third" : ""}">
              <td>${i + 1}</td>
              <td class="tcell">${esc(r.team.flag)} ${esc(r.team.name_es)}</td>
              <td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td>
              <td>${r.GF}</td><td>${r.GA}</td><td>${r.GD}</td><td><b>${r.Pts}</b></td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="cards">${gm.sort((a, b) => a.id - b.id).map(matchCard).join("")}</div>
    </section>`;
  }).join("");
}

export function renderBracket() {
  const order = ["R32","R16","QF","SF","3RD","FINAL"];
  return order.map((st) => {
    const ms = state.matches.filter((m) => m.stage === st).sort((a, b) => a.id - b.id);
    return `
    <section class="round">
      <h3>${STAGE_LABEL[st]}</h3>
      <div class="cards">${ms.map(matchCard).join("")}</div>
    </section>`;
  }).join("");
}

export function renderCalendar() {
  const byDay = {};
  state.matches.forEach((m) => {
    const d = m.kickoff
      ? new Date(m.kickoff).toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long" })
      : "Por definir";
    (byDay[d] ||= []).push(m);
  });
  const days = Object.keys(byDay).sort((a, b) => new Date(byDay[a][0].kickoff) - new Date(byDay[b][0].kickoff));
  return days.map((d) => `
    <section class="day">
      <h3>${d}</h3>
      <div class="cards">${byDay[d].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff)).map(matchCard).join("")}</div>
    </section>`).join("");
}

// ── Panel de estadísticas ──
export function statsPanelHtml(m) {
  const s = state.stats[m.id] || {};
  const gs = state.goals[m.id] || [];
  const cols = [m._home, m._away].filter(Boolean);
  const rows = STAT_FIELDS.map(([k, label]) => `
    <tr><td>${cols[0] ? (s[cols[0]]?.[k] ?? "–") : "–"}</td>
        <th>${label}</th>
        <td>${cols[1] ? (s[cols[1]]?.[k] ?? "–") : "–"}</td></tr>`).join("");
  const goalsHtml = gs.length
    ? `<div class="goals">⚽ ${gs.map((g) => `${esc(state.teamMap[g.team_id]?.flag || "")} ${esc(g.player || "Gol")} ${g.minute ?? "?"}'`).join(" · ")}</div>`
    : "";
  return `
    <table class="stats-table">
      <thead><tr><th>${esc(state.teamMap[cols[0]]?.name_es || "Local")}</th><th></th><th>${esc(state.teamMap[cols[1]]?.name_es || "Visita")}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${goalsHtml}`;
}

// ── Editor de resultados (solo editores; protegido además por RLS) ──
export function editModal(m) {
  const s = state.stats[m.id] || {};
  const teamOptions = (sel) => `<option value="">—</option>` +
    state.teams.map((t) => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(t.flag)} ${esc(t.name_es)}</option>`).join("");
  const known = m.stage === "group";
  const statInputs = (teamId, side) => STAT_FIELDS.map(([k, label]) =>
    `<label>${label}<input type="number" data-stat="${k}" data-side="${side}" value="${s[teamId]?.[k] ?? ""}"></label>`).join("");

  const dlg = document.createElement("div");
  dlg.className = "modal";
  dlg.innerHTML = `
    <div class="modal-box">
      <h3>Editar M${m.id} · ${STAGE_LABEL[m.stage]}${m.group_code ? " " + m.group_code : ""}</h3>
      ${known ? "" : `
      <div class="row2">
        <label>Equipo local (resuelto: ${esc(m.home_placeholder || "—")})
          <select id="ed-home">${teamOptions(m._home)}</select></label>
        <label>Equipo visita (resuelto: ${esc(m.away_placeholder || "—")})
          <select id="ed-away">${teamOptions(m._away)}</select></label>
      </div>`}
      <div class="row2">
        <label>Goles ${esc(state.teamMap[m._home]?.name_es || "Local")}
          <input type="number" id="ed-hs" min="0" value="${m.home_score ?? ""}"></label>
        <label>Goles ${esc(state.teamMap[m._away]?.name_es || "Visita")}
          <input type="number" id="ed-as" min="0" value="${m.away_score ?? ""}"></label>
      </div>
      <label>Estado
        <select id="ed-status">
          ${["scheduled","live","finished"].map((v) => `<option value="${v}" ${m.status === v ? "selected" : ""}>${v}</option>`).join("")}
        </select></label>
      <details class="stats-edit"><summary>📊 Estadísticas del partido</summary>
        <div class="row2">
          <fieldset><legend>${esc(state.teamMap[m._home]?.name_es || "Local")}</legend>${statInputs(m._home, "home")}</fieldset>
          <fieldset><legend>${esc(state.teamMap[m._away]?.name_es || "Visita")}</legend>${statInputs(m._away, "away")}</fieldset>
        </div>
      </details>
      <div class="modal-actions">
        <button id="ed-cancel" class="btn">Cancelar</button>
        <button id="ed-save" class="btn btn-primary">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  $("#ed-cancel", dlg).onclick = () => dlg.remove();
  $("#ed-save", dlg).onclick = async () => {
    const homeId = known ? m._home : ($("#ed-home", dlg).value || null);
    const awayId = known ? m._away : ($("#ed-away", dlg).value || null);
    const patch = {
      home_score: $("#ed-hs", dlg).value === "" ? null : +$("#ed-hs", dlg).value,
      away_score: $("#ed-as", dlg).value === "" ? null : +$("#ed-as", dlg).value,
      status: $("#ed-status", dlg).value
    };
    if (!known) { patch.home_team = homeId; patch.away_team = awayId; }

    const { error } = await db.from("matches").update(patch).eq("id", m.id);
    if (error) { toast("Error guardando: " + error.message, "error"); return; }

    const statRows = [];
    [["home", homeId], ["away", awayId]].forEach(([side, tid]) => {
      if (!tid) return;
      const row = { match_id: m.id, team_id: tid };
      let any = false;
      $$(`input[data-side="${side}"]`, dlg).forEach((inp) => {
        if (inp.value !== "") { row[inp.dataset.stat] = +inp.value; any = true; }
      });
      if (any) statRows.push(row);
    });
    if (statRows.length) {
      const { error: se } = await db.from("match_stats").upsert(statRows, { onConflict: "match_id,team_id" });
      if (se) console.warn(se);
    }
    dlg.remove();
    toast("Resultado guardado ✓", "success");
    refreshApp();
  };
}

/** Recalcula y guarda los pronósticos de la casa (solo editores). */
export async function recalcPredictions() {
  const { computeBracketAndPredictions } = await import("./lib/state.js");
  computeBracketAndPredictions();
  const rows = state.matches.filter((m) => m._pred).map((m) => ({
    match_id: m.id,
    p_home_win: +m._pred.pHomeWin.toFixed(4),
    p_draw: +m._pred.pDraw.toFixed(4),
    p_away_win: +m._pred.pAwayWin.toFixed(4),
    pred_home_score: m._pred.predHome,
    pred_away_score: m._pred.predAway,
    updated_at: new Date().toISOString()
  }));
  if (!rows.length) { toast("No hay partidos con ambos equipos definidos todavía.", "error"); return; }
  const { error } = await db.from("predictions").upsert(rows, { onConflict: "match_id" });
  if (error) toast("Error guardando pronósticos: " + error.message, "error");
  else toast(`Pronósticos recalculados (${rows.length} partidos).`, "success");
  refreshApp();
}

// ── Acciones de tarjeta (enrutadas por el delegado global) ──
export const actions = {
  stats: (btn) => {
    const card = btn.closest(".card");
    const panel = $(".stats-panel", card);
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      const m = state.matches.find((x) => x.id === +card.dataset.mid);
      panel.innerHTML = statsPanelHtml(m);
    }
  },
  edit: (btn) => {
    const m = state.matches.find((x) => x.id === +btn.closest(".card").dataset.mid);
    if (m) editModal(m);
  }
};

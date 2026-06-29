// ============================================================
//  Mundial 2026 — App principal
// ============================================================
const { createClient } = window.supabase;
const db = createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);

const GROUPS = ["A","B","C","D","E","F","G","H","I","J","K","L"];
const STAGE_LABEL = {
  group: "Fase de grupos", R32: "Dieciseisavos", R16: "Octavos",
  QF: "Cuartos de final", SF: "Semifinales", "3RD": "Tercer lugar", FINAL: "Final"
};
const STAT_FIELDS = [
  ["possession","Posesión %"], ["shots","Tiros"], ["shots_on_target","Tiros a puerta"],
  ["corners","Córners"], ["fouls","Faltas"], ["offsides","Fuera de juego"],
  ["yellow_cards","Amarillas"], ["red_cards","Rojas"]
];

const state = {
  teams: [], teamMap: {}, matches: [], stats: {}, goals: {},
  ratings: {}, predictions: {}, session: null, view: "grupos", showPred: true
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

// ---------- carga de datos ----------
async function loadAll() {
  const [teams, matches, stats, goals, preds] = await Promise.all([
    db.from("teams").select("*"),
    db.from("matches").select("*").order("id"),
    db.from("match_stats").select("*"),
    db.from("goals").select("*").order("minute"),
    db.from("predictions").select("*")
  ]);
  if (teams.error) { console.error(teams.error); alert("Error cargando datos: " + teams.error.message); return; }

  state.teams = teams.data;
  state.teamMap = Object.fromEntries(teams.data.map((t) => [t.id, t]));
  state.matches = matches.data;

  state.stats = {};
  (stats.data || []).forEach((s) => { (state.stats[s.match_id] ||= {})[s.team_id] = s; });
  state.goals = {};
  (goals.data || []).forEach((g) => { (state.goals[g.match_id] ||= []).push(g); });
  state.predictions = Object.fromEntries((preds.data || []).map((p) => [p.match_id, p]));

  computeBracketAndPredictions();
}

// resuelve placeholders y calcula ratings + pronósticos en memoria
function computeBracketAndPredictions() {
  const finished = state.matches
    .filter((m) => m.status === "finished")
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  state.ratings = window.Predictor.currentRatings(state.teams, finished);

  // resolver equipos de cada partido (grupo = directo, eliminatoria = placeholder)
  const ctx = { teams: state.teams, matches: state.matches, groups: GROUPS };
  delete ctx._usedThirds;
  state.matches
    .slice()
    .sort((a, b) => a.id - b.id)
    .forEach((m) => {
      if (m.stage === "group") {
        m._home = m.home_team; m._away = m.away_team;
      } else {
        m._home = m.home_team || window.Standings.resolvePlaceholder(m.home_placeholder, ctx);
        m._away = m.away_team || window.Standings.resolvePlaceholder(m.away_placeholder, ctx);
      }
      // pronóstico en vivo para partidos no terminados con ambos equipos conocidos
      if (m.status !== "finished" && m._home && m._away) {
        m._pred = window.Predictor.predict(state.ratings[m._home], state.ratings[m._away], m._home);
      } else {
        m._pred = null;
      }
    });
}

// ---------- helpers de presentación ----------
function teamChip(id, ph) {
  if (id) {
    const t = state.teamMap[id];
    return `<span class="team"><span class="flag">${t.flag || "🏳️"}</span><span class="tname">${esc(t.name_es)}</span></span>`;
  }
  return `<span class="team team--ph"><span class="flag">❓</span><span class="tname">${esc(ph || "Por definir")}</span></span>`;
}

function fmtDate(iso) {
  if (!iso) return "Por definir";
  return new Date(iso).toLocaleString("es-MX", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
  });
}

function predBar(p) {
  if (!p) return "";
  const h = Math.round(p.pHomeWin * 100), d = Math.round(p.pDraw * 100), a = Math.round(p.pAwayWin * 100);
  return `
    <div class="pred">
      <div class="pred-score">🔮 Pronóstico: <b>${p.predHome} - ${p.predAway}</b></div>
      <div class="pred-bar">
        <span class="pb pb-h" style="width:${h}%" title="Local ${h}%">${h}%</span>
        <span class="pb pb-d" style="width:${d}%" title="Empate ${d}%">${d}%</span>
        <span class="pb pb-a" style="width:${a}%" title="Visita ${a}%">${a}%</span>
      </div>
    </div>`;
}

function matchCard(m) {
  const finished = m.status === "finished";
  const live = m.status === "live";
  // mostrar marcador en cuanto exista (en vivo o finalizado), no sólo al finalizar
  const hasScore = m.home_score != null && m.away_score != null;
  const score = hasScore
    ? `<span class="score${live ? " score--live" : ""}">${m.home_score} - ${m.away_score}</span>`
    : `<span class="vs">vs</span>`;
  const hasStats = state.stats[m.id] && Object.keys(state.stats[m.id]).length;
  const editor = !!state.session;

  return `
  <article class="card ${finished ? "card--done" : ""}${live ? " card--live" : ""}" data-mid="${m.id}">
    <header class="card-top">
      <span class="mno">M${m.id} · ${STAGE_LABEL[m.stage]}${m.group_code ? " " + m.group_code : ""}</span>
      ${live ? `<span class="live-badge">🔴 EN VIVO</span>` : ""}
      <span class="mvenue">📍 ${esc(m.venue || "Por definir")}</span>
    </header>
    <div class="card-mid">
      ${teamChip(m._home, m.home_placeholder)}
      ${score}
      ${teamChip(m._away, m.away_placeholder)}
    </div>
    <footer class="card-bot">
      <span class="mdate">🗓️ ${fmtDate(m.kickoff)}</span>
      <span class="actions">
        ${finished && hasStats ? `<button class="lnk" data-act="stats">📊 Estadísticas</button>` : ""}
        ${editor ? `<button class="lnk" data-act="edit">✏️ Editar</button>` : ""}
      </span>
    </footer>
    ${state.showPred && !finished && !live ? predBar(m._pred) : ""}
    <div class="stats-panel" hidden></div>
  </article>`;
}

// ---------- vistas ----------
function renderGroups() {
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
              <td class="tcell">${r.team.flag} ${esc(r.team.name_es)}</td>
              <td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td>
              <td>${r.GF}</td><td>${r.GA}</td><td>${r.GD}</td><td><b>${r.Pts}</b></td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="cards">${gm.sort((a,b)=>a.id-b.id).map(matchCard).join("")}</div>
    </section>`;
  }).join("");
}

function renderBracket() {
  const order = ["R32","R16","QF","SF","3RD","FINAL"];
  return order.map((st) => {
    const ms = state.matches.filter((m) => m.stage === st).sort((a,b)=>a.id-b.id);
    return `
    <section class="round">
      <h3>${STAGE_LABEL[st]}</h3>
      <div class="cards">${ms.map(matchCard).join("")}</div>
    </section>`;
  }).join("");
}

function renderCalendar() {
  const byDay = {};
  state.matches.forEach((m) => {
    const d = m.kickoff ? new Date(m.kickoff).toLocaleDateString("es-MX", { weekday:"long", day:"2-digit", month:"long" }) : "Por definir";
    (byDay[d] ||= []).push(m);
  });
  const days = Object.keys(byDay).sort((a, b) => {
    const ma = byDay[a][0].kickoff, mb = byDay[b][0].kickoff;
    return new Date(ma) - new Date(mb);
  });
  return days.map((d) => `
    <section class="day">
      <h3>${d}</h3>
      <div class="cards">${byDay[d].sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff)).map(matchCard).join("")}</div>
    </section>`).join("");
}

function render() {
  $("#editor-badge").textContent = state.session ? `🔓 Editor: ${state.session.user.email}` : "";
  $("#btn-login").textContent = state.session ? "Cerrar sesión" : "🔒 Modo edición";
  $("#btn-recalc").hidden = !state.session;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === state.view));

  let html = "";
  if (state.view === "grupos") html = renderGroups();
  else if (state.view === "eliminatorias") html = renderBracket();
  else html = renderCalendar();
  $("#content").innerHTML = html;
}

// ---------- panel de estadísticas ----------
function statsPanelHtml(m) {
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

// ---------- editor ----------
function editModal(m) {
  const s = state.stats[m.id] || {};
  const teamOptions = (sel) => `<option value="">—</option>` +
    state.teams.map((t) => `<option value="${t.id}" ${t.id===sel?"selected":""}>${t.flag} ${esc(t.name_es)}</option>`).join("");
  const known = m.stage === "group";

  const statInputs = (teamId, side) => STAT_FIELDS.map(([k, label]) =>
    `<label>${label}<input type="number" data-stat="${k}" data-side="${side}" value="${s[teamId]?.[k] ?? ""}"></label>`).join("");

  const dlg = document.createElement("div");
  dlg.className = "modal";
  dlg.innerHTML = `
    <div class="modal-box">
      <h3>Editar M${m.id} · ${STAGE_LABEL[m.stage]}${m.group_code?" "+m.group_code:""}</h3>
      ${known ? "" : `
      <div class="row2">
        <label>Equipo local (resuelto: ${m.home_placeholder || "—"})
          <select id="ed-home">${teamOptions(m._home)}</select></label>
        <label>Equipo visita (resuelto: ${m.away_placeholder || "—"})
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
          ${["scheduled","live","finished"].map((v)=>`<option value="${v}" ${m.status===v?"selected":""}>${v}</option>`).join("")}
        </select></label>
      <details class="stats-edit"><summary>📊 Estadísticas del partido</summary>
        <div class="row2">
          <fieldset><legend>${esc(state.teamMap[m._home]?.name_es || "Local")}</legend>${statInputs(m._home,"home")}</fieldset>
          <fieldset><legend>${esc(state.teamMap[m._away]?.name_es || "Visita")}</legend>${statInputs(m._away,"away")}</fieldset>
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
    if (error) { alert("Error guardando: " + error.message); return; }

    // estadísticas por equipo (upsert)
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
    await refresh();
  };
}

// ---------- pronósticos persistentes ----------
async function recalcPredictions() {
  computeBracketAndPredictions();
  const rows = state.matches
    .filter((m) => m._pred)
    .map((m) => ({
      match_id: m.id,
      p_home_win: +m._pred.pHomeWin.toFixed(4),
      p_draw: +m._pred.pDraw.toFixed(4),
      p_away_win: +m._pred.pAwayWin.toFixed(4),
      pred_home_score: m._pred.predHome,
      pred_away_score: m._pred.predAway,
      updated_at: new Date().toISOString()
    }));
  if (!rows.length) { alert("No hay partidos con ambos equipos definidos todavía."); return; }
  const { error } = await db.from("predictions").upsert(rows, { onConflict: "match_id" });
  if (error) alert("Error guardando pronósticos: " + error.message);
  else alert(`Pronósticos recalculados y guardados (${rows.length} partidos).`);
  await refresh();
}

// ---------- auth ----------
async function loginFlow() {
  if (state.session) { await db.auth.signOut(); return; }
  const email = prompt("Correo del editor (recibirás un código de 6 dígitos):");
  if (!email) return;
  const { error } = await db.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  if (error) { alert("Error enviando código: " + error.message); return; }
  const token = prompt(`Te enviamos un código a ${email}. Escríbelo aquí:`);
  if (!token) return;
  const { error: ve } = await db.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: "email" });
  if (ve) alert("Código inválido: " + ve.message);
}

// ---------- ciclo ----------
async function refresh() {
  await loadAll();
  render();
}

function wireEvents() {
  $$(".tab").forEach((t) => t.onclick = () => { state.view = t.dataset.view; render(); });
  $("#btn-login").onclick = loginFlow;
  $("#btn-recalc").onclick = recalcPredictions;
  $("#btn-pred").onclick = () => {
    state.showPred = !state.showPred;
    $("#btn-pred").classList.toggle("off", !state.showPred);
    render();
  };

  // delegación de clics en tarjetas
  $("#content").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const card = btn.closest(".card");
    const m = state.matches.find((x) => x.id === +card.dataset.mid);
    if (btn.dataset.act === "edit") editModal(m);
    if (btn.dataset.act === "stats") {
      const panel = $(".stats-panel", card);
      panel.hidden = !panel.hidden;
      if (!panel.hidden) panel.innerHTML = statsPanelHtml(m);
    }
  });

  // sesión + realtime
  db.auth.onAuthStateChange((_e, session) => { state.session = session; render(); });
  db.channel("rt-matches")
    .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_stats" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "goals" }, refresh)
    .subscribe();
}

(async function init() {
  wireEvents();
  const { data } = await db.auth.getSession();
  state.session = data.session;
  await refresh();
})();

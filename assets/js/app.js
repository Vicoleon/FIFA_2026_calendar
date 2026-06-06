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

const TOURNAMENT_START = new Date("2026-06-11T00:00:00"); // el botón "Hoy" aparece a partir de aquí

const state = {
  teams: [], teamMap: {}, matches: [], stats: {}, goals: {},
  ratings: {}, predictions: {}, session: null, view: "grupos",
  showPred: true, todayOnly: false
};

// ¿ya empezó el Mundial? (según el reloj del dispositivo)
const tournamentStarted = () => new Date() >= TOURNAMENT_START;
// ¿el partido es de hoy? (fecha local del usuario)
function isToday(m) {
  if (!m.kickoff) return false;
  const d = new Date(m.kickoff), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
// aplica el filtro "Hoy" si está activo
const visibleMatches = (arr) => (state.todayOnly ? arr.filter(isToday) : arr);

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
  state.ratings = window.Predictor.currentRatings(state.teams, finished, state.stats);

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
  const showScore = finished || live;
  const score = showScore
    ? `<span class="score">${m.home_score ?? 0} - ${m.away_score ?? 0}</span>`
    : `<span class="vs">vs</span>`;
  const hasStats = state.stats[m.id] && Object.keys(state.stats[m.id]).length;
  const editor = !!state.session;

  return `
  <article class="card ${finished ? "card--done" : ""} ${live ? "card--live" : ""}" data-mid="${m.id}">
    <header class="card-top">
      <span class="mno">M${m.id} · ${STAGE_LABEL[m.stage]}${m.group_code ? " " + m.group_code : ""}</span>
      ${live
        ? `<span class="live-badge">● EN VIVO${m.minute != null ? " " + m.minute + "'" : ""}</span>`
        : `<span class="mvenue">📍 ${esc(m.venue || "Por definir")}</span>`}
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
    ${state.showPred && !showScore ? predBar(m._pred) : ""}
    <div class="stats-panel" hidden></div>
  </article>`;
}

// ---------- vistas ----------
function renderGroups() {
  return GROUPS.map((g) => {
    const gm = visibleMatches(state.matches.filter((m) => m.stage === "group" && m.group_code === g));
    if (state.todayOnly && gm.length === 0) return ""; // sin partidos hoy → oculta el grupo
    const table = window.Standings.groupTable(state.teams, state.matches, g);
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

// Estructura del cuadro: qué match va en cada lado y columna (según el cuadro oficial).
// El orden vertical hace que cada par alimente al partido de la siguiente ronda.
const BRACKET = {
  left:  { R32: [74,77,73,75,83,84,81,82], R16: [89,90,93,94], QF: [97,98], SF: [101] },
  right: { R32: [76,78,79,80,86,88,85,87], R16: [91,92,95,96], QF: [99,100], SF: [102] },
};
const mById = (id) => state.matches.find((m) => m.id === id);

// un "slot" del cuadro: equipo resuelto (bandera + código) o la etiqueta (1E, 3ABCDF…)
function kbSlot(teamId, ph, score) {
  if (teamId) {
    const t = state.teamMap[teamId];
    return `<div class="kb-slot"><span class="kb-team">${t.flag} ${teamId}</span>${score != null ? `<span class="kb-sc">${score}</span>` : ""}</div>`;
  }
  return `<div class="kb-slot kb-ph"><span class="kb-team">${esc(ph || "—")}</span></div>`;
}
function kbMatch(id) {
  const m = mById(id); if (!m) return "";
  const sc = m.status === "finished" || m.status === "live";
  return `<div class="kb-match ${m.status === "live" ? "kb-live" : ""}" data-mid="${id}" title="M${id} · ${esc(m.venue || "")} · ${fmtDate(m.kickoff)}">
    ${kbSlot(m._home, m.home_placeholder, sc ? m.home_score : null)}
    ${kbSlot(m._away, m.away_placeholder, sc ? m.away_score : null)}
  </div>`;
}
const kbCol = (ids, cls) => `<div class="kb-col ${cls}">${ids.map(kbMatch).join("")}</div>`;

function groupChip(g) {
  const ts = state.teams.filter((t) => t.group_code === g).sort((a, b) => (a.seed_pos || 0) - (b.seed_pos || 0));
  return `<div class="kb-group"><div class="kb-gname">Grupo ${g}</div>
    <div class="kb-gflags">${ts.map((t) => `<span title="${esc(t.name_es)}">${t.flag}</span>`).join("")}</div></div>`;
}

function renderBracketTree() {
  const L = BRACKET.left, R = BRACKET.right;
  return `<div class="kb">
    <div class="kb-groups">${["A","B","C","D","E","F"].map(groupChip).join("")}</div>
    <div class="kb-body">
      <div class="kb-side kb-left">
        ${kbCol(L.R32, "r32")}${kbCol(L.R16, "r16")}${kbCol(L.QF, "qf")}${kbCol(L.SF, "sf")}
      </div>
      <div class="kb-center">
        <div class="kb-title">Campeón del Mundo</div>
        ${kbCol([104], "fin")}
        <div class="kb-trophy">🏆</div>
        <div class="kb-blabel">Tercer lugar</div>
        ${kbCol([103], "fin")}
      </div>
      <div class="kb-side kb-right">
        ${kbCol(R.SF, "sf")}${kbCol(R.QF, "qf")}${kbCol(R.R16, "r16")}${kbCol(R.R32, "r32")}
      </div>
    </div>
    <div class="kb-groups">${["G","H","I","J","K","L"].map(groupChip).join("")}</div>
  </div>`;
}
function renderBracket() {
  // con el filtro "Hoy" activo, una lista simple es más útil que el árbol disperso
  if (state.todayOnly) {
    const order = ["R32","R16","QF","SF","3RD","FINAL"];
    return order.map((st) => {
      const ms = visibleMatches(state.matches.filter((m) => m.stage === st)).sort((a,b)=>a.id-b.id);
      if (ms.length === 0) return "";
      return `<section class="round"><h3>${STAGE_LABEL[st]}</h3><div class="cards">${ms.map(matchCard).join("")}</div></section>`;
    }).join("");
  }
  return renderBracketTree();
}

function renderCalendar() {
  const byDay = {};
  visibleMatches(state.matches).forEach((m) => {
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
  const started = tournamentStarted();
  $("#btn-today").hidden = !started;          // oculto hasta el 11 de junio
  if (!started) state.todayOnly = false;
  $("#btn-today").classList.toggle("active", state.todayOnly);
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === state.view));

  let html = "";
  if (state.view === "grupos") html = renderGroups();
  else if (state.view === "eliminatorias") html = renderBracket();
  else html = renderCalendar();
  if (state.todayOnly && !html.trim()) html = `<p class="loading">No hay partidos hoy en esta vista. 📅</p>`;
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

  // análisis multivariable (xG aprox. + índice de dominio + veredicto)
  let analysisHtml = "";
  if (cols.length === 2 && window.Analytics) {
    const a = window.Analytics.analyze(s[cols[0]], s[cols[1]], m.home_score, m.away_score);
    if (a) {
      const domH = Math.round(a.dom * 100), domA = 100 - domH;
      analysisHtml = `
        <div class="analysis">
          <div class="ana-head">📈 Análisis del partido</div>
          <div class="ana-row"><b>${a.xgH.toFixed(2)}</b><span>xG aprox.</span><b>${a.xgA.toFixed(2)}</b></div>
          <div class="dom-bar"><span class="dom-h" style="width:${domH}%">${domH}%</span><span class="dom-a" style="width:${domA}%">${domA}%</span></div>
          <div class="ana-verdict">${esc(a.verdict)} · dominio del juego</div>
        </div>`;
    }
  }

  return analysisHtml + `
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

// ---------- auth (correo + contraseña, sin correos de verificación) ----------
async function loginFlow() {
  if (state.session) { await db.auth.signOut(); return; }
  const email = prompt("Correo del editor:", "joseleonsalgado@gmail.com");
  if (!email) return;
  const password = prompt("Contraseña:");
  if (!password) return;
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
  if (error) alert("No se pudo iniciar sesión: " + error.message);
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
  $("#btn-today").onclick = () => { state.todayOnly = !state.todayOnly; render(); };
  $("#btn-pred").onclick = () => {
    state.showPred = !state.showPred;
    $("#btn-pred").classList.toggle("off", !state.showPred);
    render();
  };

  // delegación de clics en tarjetas
  $("#content").addEventListener("click", (e) => {
    // clic en un slot del cuadro → editar (si eres editor)
    const km = e.target.closest(".kb-match");
    if (km) {
      const m = state.matches.find((x) => x.id === +km.dataset.mid);
      if (m && state.session) editModal(m);
      return;
    }
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
    .subscribe();
}

// ---------- datos en vivo (proxy football-data vía Edge Function) ----------
async function syncLive() {
  // Llama al proxy: si hay partidos en curso, actualiza la BD y Realtime
  // refresca la UI automáticamente. Fuera de horario de partidos sale barato.
  try { await db.functions.invoke("live-scores"); } catch (_) { /* sin red / sin token: ignora */ }
}

(async function init() {
  wireEvents();
  const { data } = await db.auth.getSession();
  state.session = data.session;
  await refresh();
  syncLive();
  setInterval(syncLive, 60000); // sondea cada minuto
})();

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
  showPred: true, todayOnly: false, projection: false, groupFilter: null
};

// Editor autorizado por correo (la quiniela comparte la sesión de Supabase,
// así que ya no basta con "hay sesión": debe ser un correo de la lista).
const isEditor = () => {
  const e = (state.session?.user?.email || "").toLowerCase();
  return (window.APP_CONFIG.EDITOR_EMAILS || []).map((x) => x.toLowerCase()).includes(e);
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

// ---------- temas intercambiables ----------
const THEMES = [
  { id: "neon", name: "Neón" },
  { id: "fiesta", name: "Fiesta" },
  { id: "editorial", name: "Editorial" },
];
const currentTheme = () => document.documentElement.dataset.theme || "neon";
function applyTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = "neon";
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem("wc-theme", id); } catch (_) {}
  document.querySelectorAll(".td-opt").forEach((o) => o.classList.toggle("active", o.dataset.themeId === id));
}

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

  // Proyección opcional: rellena la llave con los favoritos por rating (Elo)
  // para poder ver el cuadro pronosticado antes de que haya clasificados reales.
  state.matches.forEach((m) => { m._homeProj = false; m._awayProj = false; });
  state.titleOdds = null;
  if (state.projection) {
    const pj = computeProjection();
    state.matches.forEach((m) => {
      if (m.stage === "group") return;
      if (!m._home && pj.homeOf[m.id]) { m._home = pj.homeOf[m.id]; m._homeProj = true; }
      if (!m._away && pj.awayOf[m.id]) { m._away = pj.awayOf[m.id]; m._awayProj = true; }
      if (m.status !== "finished" && m._home && m._away) {
        m._pred = window.Predictor.predict(state.ratings[m._home], state.ratings[m._away], m._home);
      }
    });
    state.titleOdds = simulateTitleOdds(2500);
  }
}

// Monte Carlo: simula el torneo N veces para estimar % de llegar a la final y de ser campeón.
function simulateTitleOdds(N) {
  const r = state.ratings;
  const adv = window.Predictor.advantage, exp = window.Predictor.expectedScore;
  const champ = {}, final = {};
  state.teams.forEach((t) => { champ[t.id] = 0; final[t.id] = 0; });
  const ko = state.matches.filter((m) => m.stage !== "group").sort((a, b) => a.id - b.id)
    .map((m) => ({ id: m.id, h: m.home_placeholder, a: m.away_placeholder }));
  const byGroup = {};
  GROUPS.forEach((g) => (byGroup[g] = state.teams.filter((t) => t.group_code === g).map((t) => t.id)));

  for (let s = 0; s < N; s++) {
    const rank = {}, thirdsArr = [];
    GROUPS.forEach((g) => {
      const tm = byGroup[g].map((id) => ({ id, pts: 0, gd: 0, rnd: Math.random() }));
      const P = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
      P.forEach(([i, j]) => {
        const A = tm[i], B = tm[j], pa = exp(r[A.id], r[B.id]);
        const pd = Math.max(0.07, 0.30 - Math.abs(pa - 0.5) * 0.5);
        const pAw = (1 - pd) * pa, pBw = (1 - pd) * (1 - pa), x = Math.random();
        if (x < pAw) { A.pts += 3; A.gd++; B.gd--; }
        else if (x < pAw + pBw) { B.pts += 3; B.gd++; A.gd--; }
        else { A.pts++; B.pts++; }
      });
      tm.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.rnd - a.rnd);
      rank[g] = tm.map((t) => t.id);
      thirdsArr.push({ g, ...tm[2] });
    });
    thirdsArr.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.rnd - a.rnd);
    const top8 = thirdsArr.slice(0, 8), used = new Set();
    const thirdFor = (gs) => {
      for (const t of top8) if (gs.includes(t.g) && !used.has(t.g)) { used.add(t.g); return t.id; }
      const f = top8.find((t) => !used.has(t.g)); if (f) { used.add(f.g); return f.id; } return null;
    };
    const winOf = {};
    const res = (ph) => {
      let m;
      if (m = ph.match(/^([12])([A-L])$/)) return rank[m[2]][(+m[1]) - 1];
      if (m = ph.match(/^3([A-L]+)$/)) return thirdFor(m[1]);
      if (m = ph.match(/^W(\d+)$/)) return winOf[+m[1]];
      return null; // L## (bronce) no cuenta para el título
    };
    ko.forEach((k) => {
      if (k.id === 103) return; // tercer lugar
      const h = res(k.h), a = res(k.a);
      if (k.id === 104) { if (h) final[h]++; if (a) final[a]++; }
      const w = (h && a) ? (Math.random() < exp(r[h] + adv(h), r[a]) ? h : a) : (h || a);
      if (k.id === 104) { if (w) champ[w]++; } else if (w) winOf[k.id] = w;
    });
  }
  return state.teams.map((t) => ({ id: t.id, champ: champ[t.id] / N, final: final[t.id] / N }))
    .sort((a, b) => b.champ - a.champ);
}

// Proyecta clasificados y ganadores de cada cruce a partir del rating actual (Elo).
function computeProjection() {
  const r = state.ratings;
  const adv = window.Predictor.advantage, exp = window.Predictor.expectedScore;
  const rank = {}; // ranking de cada grupo por rating
  GROUPS.forEach((g) => {
    rank[g] = state.teams.filter((t) => t.group_code === g)
      .sort((a, b) => r[b.id] - r[a.id]).map((t) => t.id);
  });
  // 8 mejores terceros por rating
  const thirds = GROUPS.map((g) => ({ g, id: rank[g][2] })).sort((x, y) => r[y.id] - r[x.id]).slice(0, 8);
  const usedThird = new Set();
  const thirdFor = (gs) => {
    for (const t of thirds) if (gs.includes(t.g) && !usedThird.has(t.g)) { usedThird.add(t.g); return t.id; }
    return null;
  };
  const homeOf = {}, awayOf = {}, winOf = {}, loseOf = {};
  const resolve = (ph) => {
    if (!ph) return null;
    let m = ph.match(/^([WL])(\d+)$/); if (m) return m[1] === "W" ? winOf[+m[2]] : loseOf[+m[2]];
    m = ph.match(/^([12])([A-L])$/); if (m) return rank[m[2]][(+m[1]) - 1];
    m = ph.match(/^3([A-L]+)$/); if (m) return thirdFor(m[1]);
    return null;
  };
  state.matches.filter((m) => m.stage !== "group").sort((a, b) => a.id - b.id).forEach((m) => {
    const h = m.home_team || resolve(m.home_placeholder);
    const a = m.away_team || resolve(m.away_placeholder);
    homeOf[m.id] = h; awayOf[m.id] = a;
    const winner = (h && a) ? (exp(r[h] + adv(h), r[a]) >= 0.5 ? h : a) : (h || a);
    if (winner) { winOf[m.id] = winner; loseOf[m.id] = (h && a) ? (winner === h ? a : h) : null; }
  });
  return { homeOf, awayOf };
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
  const hasPens = m.home_pens != null && m.away_pens != null;
  const score = showScore
    ? `<span class="score">${m.home_score ?? 0} - ${m.away_score ?? 0}</span>${hasPens ? `<span class="pens">(pen ${m.home_pens}-${m.away_pens})</span>` : ""}`
    : `<span class="vs">vs</span>`;
  const hasStats = state.stats[m.id] && Object.keys(state.stats[m.id]).length;
  const editor = isEditor();

  return `
  <article class="card ${finished ? "card--done" : ""} ${live ? "card--live" : ""}" data-mid="${m.id}">
    <header class="card-top">
      <span class="mno">M${m.id} · ${STAGE_LABEL[m.stage]}${m.group_code ? " " + m.group_code : ""}</span>
      ${live
        ? `<span class="live-badge">● ${hasPens ? "PENALES" : `EN VIVO${m.minute != null ? " " + m.minute + "'" : ""}`}</span>`
        : `<span class="mvenue">📍 ${esc(m.venue || "Por definir")}</span>`}
    </header>
    <div class="card-mid">
      ${teamChip(m._home, m.home_placeholder)}
      ${score}
      ${teamChip(m._away, m.away_placeholder)}
    </div>
    <div class="card-pick">${(!m._homeProj && !m._awayProj) ? (window.Quiniela?.pickWidget?.(m) ?? "") : ""}</div>
    <footer class="card-bot">
      <span class="mdate">🗓️ ${fmtDate(m.kickoff)}</span>
      <span class="actions">
        ${finished && state.session ? `<button class="lnk" data-act="crowd">👥 Picks del grupo</button>` : ""}
        ${finished && hasStats ? `<button class="lnk" data-act="stats">📊 Estadísticas</button>` : ""}
        ${editor ? `<button class="lnk" data-act="edit">✏️ Editar</button>` : ""}
      </span>
    </footer>
    ${state.showPred && !showScore ? predBar(m._pred) : ""}
    <div class="stats-panel" hidden></div>
  </article>`;
}

// ---------- vistas ----------
function groupFilterBar() {
  const chips = ["", ...GROUPS].map((v) =>
    `<button class="gf-chip ${(state.groupFilter || "") === v ? "on" : ""}" data-gf="${v}">${v || "Todos"}</button>`).join("");
  return `<div class="gfilter"><span class="gf-label">Filtrar por grupo</span>${chips}</div>`;
}
function renderGroups() {
  return groupFilterBar() + GROUPS.map((g) => {
    if (state.groupFilter && g !== state.groupFilter) return "";
    const gm = visibleMatches(state.matches.filter((m) => m.stage === "group" && m.group_code === g));
    if (state.todayOnly && gm.length === 0) return ""; // sin partidos hoy → oculta el grupo
    const table = window.Standings.groupTable(state.teams, state.matches, g);
    return `
    <section class="group" id="group-${g}">
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
function kbSlot(teamId, ph, score, proj, pens) {
  if (teamId) {
    const t = state.teamMap[teamId];
    return `<div class="kb-slot ${proj ? "kb-proj" : ""}"><span class="kb-team">${t.flag} ${teamId}</span>${score != null ? `<span class="kb-sc">${score}${pens != null ? `<small class="kb-pen" title="penales">${pens}</small>` : ""}</span>` : ""}</div>`;
  }
  return `<div class="kb-slot kb-ph"><span class="kb-team">${esc(ph || "—")}</span></div>`;
}
function kbMatch(id) {
  const m = mById(id); if (!m) return "";
  const sc = m.status === "finished" || m.status === "live";
  const hasPens = m.home_pens != null && m.away_pens != null;
  const p = m._pred;
  const pred = (state.showPred && p)
    ? `<div class="kb-pred"><span class="kb-pscore">🔮 ${p.predHome}-${p.predAway}</span>
        <span class="kb-pbar"><i class="ph" style="width:${Math.round(p.pHomeWin*100)}%"></i><i class="pd" style="width:${Math.round(p.pDraw*100)}%"></i><i class="pa" style="width:${Math.round(p.pAwayWin*100)}%"></i></span></div>`
    : "";
  return `<div class="kb-match ${m.status === "live" ? "kb-live" : ""}" data-mid="${id}" title="M${id} · ${esc(m.venue || "")} · ${fmtDate(m.kickoff)}">
    ${kbSlot(m._home, m.home_placeholder, sc ? m.home_score : null, m._homeProj, hasPens ? m.home_pens : null)}
    ${kbSlot(m._away, m.away_placeholder, sc ? m.away_score : null, m._awayProj, hasPens ? m.away_pens : null)}
    ${pred}
  </div>`;
}
const kbCol = (ids, cls) => `<div class="kb-col ${cls}">${ids.map(kbMatch).join("")}</div>`;

function groupChip(g) {
  const ts = state.teams.filter((t) => t.group_code === g).sort((a, b) => (a.seed_pos || 0) - (b.seed_pos || 0));
  return `<div class="kb-group" data-group="${g}" title="Ver Grupo ${g} →"><div class="kb-gname">Grupo ${g}</div>
    <div class="kb-gflags">${ts.map((t) => `<span title="${esc(t.name_es)}">${t.flag}</span>`).join("")}</div></div>`;
}

// panel de probabilidades de título (simulación)
function renderOddsPanel() {
  const top = state.titleOdds.slice(0, 10);
  return `<div class="odds">
    <div class="odds-h">🏆 Probabilidad de título · simulación de 2 500 torneos</div>
    <div class="odds-list">${top.map((o) => {
      const t = state.teamMap[o.id];
      return `<div class="odds-row">
        <span class="odds-t">${t.flag} ${esc(t.name_es)}</span>
        <span class="odds-bar"><i style="width:${Math.max(2, Math.round(o.champ * 100))}%"></i></span>
        <span class="odds-v">${(o.champ * 100).toFixed(1)}%</span>
        <span class="odds-sub">${(o.final * 100).toFixed(0)}% final</span>
      </div>`;
    }).join("")}</div></div>`;
}

function renderBracketTree() {
  const L = BRACKET.left, R = BRACKET.right;
  return `<div class="kb">
    ${state.projection ? `<div class="kb-note">🔮 Proyección por rating (Elo) · no oficial — se ajusta con cada resultado real</div>` : ""}
    ${state.projection && state.titleOdds ? renderOddsPanel() : ""}
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
  $("#btn-recalc").hidden = !isEditor();
  const started = tournamentStarted();
  $("#btn-today").hidden = !started;          // oculto hasta el 11 de junio
  if (!started) state.todayOnly = false;
  $("#btn-today").classList.toggle("active", state.todayOnly);
  // La carrera se abre desde "Mis grupos": mantén esa pestaña resaltada mientras se ve.
  const activeTab = state.view === "carrera" ? "misgrupos" : state.view;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === activeTab));

  // Carrera de la quiniela
  if (state.view === "carrera") { window.QuinielaRace?.mount($("#content")); return; }

  // Vistas de la quiniela (Mi Quiniela / Tabla / Mis grupos / Perfil): las pinta la capa quiniela.
  if (window.Quiniela?.isView?.(state.view)) {
    $("#content").innerHTML = `<p class="loading">Cargando…</p>`;
    window.Quiniela.renderInto(state.view);
    return;
  }

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
  $("#btn-recalc").onclick = recalcPredictions;
  $$(".td-opt").forEach((o) => (o.onclick = () => applyTheme(o.dataset.themeId)));
  applyTheme(currentTheme()); // marca el tema guardado como activo en el panel
  $("#btn-today").onclick = () => { state.todayOnly = !state.todayOnly; render(); };
  $("#btn-pred").onclick = () => {
    state.showPred = !state.showPred;
    $("#btn-pred").classList.toggle("off", !state.showPred);
    render();
  };
  $("#btn-project").onclick = () => {
    state.projection = !state.projection;
    $("#btn-project").classList.toggle("active", state.projection);
    computeBracketAndPredictions(); // recalcula resolviendo (o no) la proyección
    render();
  };

  // delegación de clics en tarjetas
  $("#content").addEventListener("click", (e) => {
    // barra de filtro por grupo
    const gf = e.target.closest(".gf-chip");
    if (gf) { state.groupFilter = gf.dataset.gf || null; render(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    // clic en un grupo del cuadro → seleccionar ese grupo en la pestaña Grupos
    const kg = e.target.closest(".kb-group");
    if (kg && kg.dataset.group) {
      state.view = "grupos"; state.groupFilter = kg.dataset.group; render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // clic en un slot del cuadro → editar (si eres editor)
    const km = e.target.closest(".kb-match");
    if (km) {
      const m = state.matches.find((x) => x.id === +km.dataset.mid);
      if (m && isEditor()) editModal(m);
      return;
    }
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const card = btn.closest(".card");
    if (!card) return; // botones de la quiniela (fuera de tarjeta) los maneja quiniela.js
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

// ---------- datos en vivo (marcador desde ESPN vía Edge Function) ----------
async function syncLive() {
  // Nudge inmediato a ESPN (modo "scores": solo marcador/minuto, rápido). Si hay
  // partido en curso actualiza `matches` y Realtime refresca la UI en todos lados.
  // Un cron en Supabase (sync-espn-scores) ya hace esto cada minuto aunque nadie
  // tenga la página abierta; esto solo acelera el primer dato al abrir.
  try { await db.functions.invoke("sync-espn", { body: { mode: "scores" } }); } catch (_) { /* sin red: ignora */ }
}

// Expuesto para la capa de quiniela (assets/js/quiniela.js).
window.WC = { state, db, render, loadAll, computeBracketAndPredictions };

(async function init() {
  wireEvents();
  const { data } = await db.auth.getSession();
  state.session = data.session;
  await refresh();
  syncLive();
  setInterval(syncLive, 60000); // sondea cada minuto
})();

// ============================================================
//  Estado central + carga de datos.
//  window.Predictor y window.Standings se cargan como scripts clásicos
//  (predictor.js / standings.js) antes de los módulos.
// ============================================================
import { db } from "./db.js";

export const GROUPS = ["A","B","C","D","E","F","G","H","I","J","K","L"];

export const STAGE_LABEL = {
  group: "Fase de grupos", R32: "Dieciseisavos", R16: "Octavos",
  QF: "Cuartos de final", SF: "Semifinales", "3RD": "Tercer lugar", FINAL: "Final"
};

export const STAT_FIELDS = [
  ["possession","Posesión %"], ["shots","Tiros"], ["shots_on_target","Tiros a puerta"],
  ["corners","Córners"], ["fouls","Faltas"], ["offsides","Fuera de juego"],
  ["yellow_cards","Amarillas"], ["red_cards","Rojas"]
];

export const state = {
  teams: [], teamMap: {}, matches: [], stats: {}, goals: {},
  ratings: {}, predictions: {},
  session: null, profile: null,
  myPicks: {},      // match_id -> { home_score, away_score, is_joker, points, exact, ... }
  myGroups: [],     // [{ id, name, join_code, buy_in, currency, owner_id }]
  view: "calendario", showPred: true
};

/** Carga datos de calendario (público) + datos del usuario si hay sesión. */
export async function loadAll() {
  const [teams, matches, stats, goals, preds] = await Promise.all([
    db.from("teams").select("*"),
    db.from("matches").select("*").order("id"),
    db.from("match_stats").select("*"),
    db.from("goals").select("*").order("minute"),
    db.from("predictions").select("*")
  ]);
  if (teams.error) { console.error(teams.error); throw new Error("Error cargando datos: " + teams.error.message); }

  state.teams = teams.data || [];
  state.teamMap = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  state.matches = matches.data || [];

  state.stats = {};
  (stats.data || []).forEach((s) => { (state.stats[s.match_id] ||= {})[s.team_id] = s; });
  state.goals = {};
  (goals.data || []).forEach((g) => { (state.goals[g.match_id] ||= []).push(g); });
  state.predictions = Object.fromEntries((preds.data || []).map((p) => [p.match_id, p]));

  await loadUserData();
  computeBracketAndPredictions();
}

/** Picks del usuario + sus grupos (si hay sesión). */
export async function loadUserData() {
  state.myPicks = {};
  state.myGroups = [];
  const uid = state.session?.user?.id;
  if (!uid) return;

  const [picks, groups] = await Promise.all([
    db.from("picks").select("*").eq("user_id", uid),
    db.from("groups").select("*").order("created_at")
  ]);
  if (!picks.error) {
    state.myPicks = Object.fromEntries((picks.data || []).map((p) => [p.match_id, p]));
  }
  if (!groups.error) state.myGroups = groups.data || [];
}

/** Resuelve placeholders del cuadro y calcula ratings + pronósticos en memoria. */
export function computeBracketAndPredictions() {
  const finished = state.matches
    .filter((m) => m.status === "finished")
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  state.ratings = window.Predictor.currentRatings(state.teams, finished);

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
      if (m.status !== "finished" && m._home && m._away) {
        m._pred = window.Predictor.predict(state.ratings[m._home], state.ratings[m._away], m._home);
      } else {
        m._pred = null;
      }
    });
}

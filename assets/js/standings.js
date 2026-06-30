// ============================================================
//  Tablas de grupos + resolución del cuadro de eliminatorias
// ============================================================
(function () {
  // Calcula la tabla de un grupo a partir de sus partidos terminados
  function groupTable(teams, matches, groupCode) {
    const rows = {};
    teams
      .filter((t) => t.group_code === groupCode)
      .forEach((t) => {
        rows[t.id] = {
          team: t, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0
        };
      });

    matches
      .filter((m) => m.stage === "group" && m.group_code === groupCode &&
                     m.status === "finished" &&
                     m.home_score != null && m.away_score != null)
      .forEach((m) => {
        const h = rows[m.home_team], a = rows[m.away_team];
        if (!h || !a) return;
        h.P++; a.P++;
        h.GF += m.home_score; h.GA += m.away_score;
        a.GF += m.away_score; a.GA += m.home_score;
        if (m.home_score > m.away_score) { h.W++; a.L++; h.Pts += 3; }
        else if (m.home_score < m.away_score) { a.W++; h.L++; a.Pts += 3; }
        else { h.D++; a.D++; h.Pts++; a.Pts++; }
      });

    return Object.values(rows)
      .map((r) => ({ ...r, GD: r.GF - r.GA }))
      .sort(cmpRows);
  }

  function cmpRows(x, y) {
    if (y.Pts !== x.Pts) return y.Pts - x.Pts;
    if (y.GD !== x.GD) return y.GD - x.GD;
    if (y.GF !== x.GF) return y.GF - x.GF;
    return x.team.name_es.localeCompare(y.team.name_es);
  }

  // ¿Está completo el grupo? (los 6 partidos terminados)
  function groupComplete(matches, groupCode) {
    const gm = matches.filter((m) => m.stage === "group" && m.group_code === groupCode);
    return gm.length === 6 && gm.every((m) => m.status === "finished");
  }

  // Ranking de los mejores terceros (heurística: Pts, GD, GF)
  function bestThirds(teams, matches, groups) {
    const thirds = [];
    groups.forEach((g) => {
      if (groupComplete(matches, g)) {
        const t = groupTable(teams, matches, g)[2]; // 3.º lugar
        if (t) thirds.push({ group: g, ...t });
      }
    });
    thirds.sort(cmpRows);
    return thirds; // los 8 primeros clasifican
  }

  // Resuelve un "placeholder" (1E, 2A, 3ABCDF, W74, L101) a un id de equipo si es posible
  function resolvePlaceholder(ph, ctx) {
    if (!ph) return null;
    const { teams, matches, groups } = ctx;

    // Ganador / perdedor de un partido: W74 / L101
    const wl = ph.match(/^([WL])(\d+)$/);
    if (wl) {
      const m = matches.find((x) => x.id === parseInt(wl[2], 10));
      if (!m || m.status !== "finished" || m.home_score == null) return null;
      let homeWon;
      if (m.home_score === m.away_score) {
        // Empate en tiempo reglamentario: se define por penales (home_pens/away_pens).
        if (m.home_pens == null || m.away_pens == null || m.home_pens === m.away_pens) return null;
        homeWon = m.home_pens > m.away_pens;
      } else {
        homeWon = m.home_score > m.away_score;
      }
      const winner = homeWon ? m.home_team : m.away_team;
      const loser = homeWon ? m.away_team : m.home_team;
      return wl[1] === "W" ? winner : loser;
    }

    // Posición fija de grupo: 1E, 2A
    const pos = ph.match(/^([12])([A-L])$/);
    if (pos) {
      const g = pos[2];
      if (!groupComplete(matches, g)) return null;
      const table = groupTable(teams, matches, g);
      return table[parseInt(pos[1], 10) - 1]?.team.id || null;
    }

    // Mejor tercero entre un conjunto de grupos: 3ABCDF
    const third = ph.match(/^3([A-L]+)$/);
    if (third) {
      const allowed = third[1].split("");
      if (!allowed.every((g) => groupComplete(matches, g))) return null;
      const ranking = bestThirds(teams, matches, groups).slice(0, 8); // 8 mejores terceros
      // asigna el mejor tercero clasificado cuyo grupo esté permitido y no esté ya usado
      const used = ctx._usedThirds || (ctx._usedThirds = new Set());
      for (const r of ranking) {
        if (allowed.includes(r.group) && !used.has(r.group)) {
          used.add(r.group);
          return r.team.id;
        }
      }
      return null;
    }
    return null;
  }

  window.Standings = { groupTable, groupComplete, bestThirds, resolvePlaceholder };
})();

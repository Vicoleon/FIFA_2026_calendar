// ============================================================
//  Motor de pronóstico — Elo + Poisson
//  - Calcula probabilidades de Victoria / Empate / Derrota
//  - Estima el marcador más probable
//  - Reajusta los ratings Elo conforme se cargan resultados reales
// ============================================================
(function () {
  const CFG = window.APP_CONFIG.PREDICTOR;
  const HOSTS = window.APP_CONFIG.HOSTS;

  // Probabilidad de que A gane a B según diferencia de Elo (modelo logístico)
  function expectedScore(eloA, eloB) {
    return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  }

  // factorial / Poisson PMF
  function poisson(k, lambda) {
    let fact = 1;
    for (let i = 2; i <= k; i++) fact *= i;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / fact;
  }

  // Ventaja "de local" (las sedes son casi neutrales salvo anfitriones)
  function advantage(homeId) {
    let adv = CFG.HOME_ADV;
    if (HOSTS.includes(homeId)) adv += CFG.HOST_BONUS;
    return adv;
  }

  // Convierte ratings -> goles esperados (lambda) de cada lado
  function lambdas(eloHome, eloAway, homeId) {
    const diff = eloHome + advantage(homeId) - eloAway;
    const supremacy = Math.max(-2.2, Math.min(2.2, diff / 90)); // goles de diferencia esperados
    const lh = Math.max(0.18, CFG.BASE_GOALS + supremacy / 2);
    const la = Math.max(0.18, CFG.BASE_GOALS - supremacy / 2);
    return [lh, la];
  }

  // Pronóstico completo de un partido a partir de los ratings actuales
  function predict(eloHome, eloAway, homeId) {
    const [lh, la] = lambdas(eloHome, eloAway, homeId);
    const max = CFG.MAX_GOALS;
    let pHome = 0, pDraw = 0, pAway = 0;
    let best = { p: -1, h: 0, a: 0 };

    for (let h = 0; h <= max; h++) {
      for (let a = 0; a <= max; a++) {
        const p = poisson(h, lh) * poisson(a, la);
        if (h > a) pHome += p;
        else if (h === a) pDraw += p;
        else pAway += p;
        if (p > best.p) best = { p, h, a };
      }
    }
    return {
      pHomeWin: pHome,
      pDraw: pDraw,
      pAwayWin: pAway,
      predHome: best.h,
      predAway: best.a,
      lambdaHome: lh,
      lambdaAway: la
    };
  }

  // Actualiza Elo de ambos equipos tras un resultado real (Elo de fútbol con factor de goles)
  function updateElo(ratings, homeId, awayId, hs, as, homeAdv) {
    const eh = ratings[homeId];
    const ea = ratings[awayId];
    const we = expectedScore(eh + homeAdv, ea); // resultado esperado del local
    let w;                                       // resultado real (1/0.5/0)
    if (hs > as) w = 1; else if (hs === as) w = 0.5; else w = 0;

    // multiplicador por diferencia de goles (FIFA / World Football Elo)
    const gd = Math.abs(hs - as);
    let g = 1;
    if (gd === 2) g = 1.5;
    else if (gd >= 3) g = (11 + gd) / 8;

    const delta = CFG.K_FACTOR * g * (w - we);
    ratings[homeId] = eh + delta;
    ratings[awayId] = ea - delta;
  }

  // Dado el set de equipos (con elo semilla) y los partidos terminados (en orden),
  // devuelve los ratings ACTUALES sin tocar la semilla en la BD.
  function currentRatings(teams, finishedMatches) {
    const ratings = {};
    teams.forEach((t) => (ratings[t.id] = Number(t.elo)));
    finishedMatches.forEach((m) => {
      if (m.home_team && m.away_team && m.home_score != null && m.away_score != null) {
        updateElo(ratings, m.home_team, m.away_team, m.home_score, m.away_score, advantage(m.home_team));
      }
    });
    return ratings;
  }

  window.Predictor = { predict, currentRatings, advantage, expectedScore };
})();

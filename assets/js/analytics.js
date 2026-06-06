// ============================================================
//  Análisis multivariable del partido
//  Combina TODAS las estadísticas (tiros, tiros a puerta, posesión,
//  córners, faltas, tarjetas…) en:
//   - un xG aproximado por equipo
//   - un "índice de dominio" 0..1 (cuánto controló el partido el local)
//   - un resultado "merecido" que alimenta al motor de pronóstico
//  Se nutre de la tabla match_stats (manual o vía API).
// ============================================================
(function () {
  const num = (v) => Number(v || 0);
  const share = (h, a) => (h + a <= 0 ? 0.5 : h / (h + a));

  // xG aproximado: tiro a puerta ≈ 0.30, tiro fuera ≈ 0.09, córner ≈ 0.02
  function xgProxy(s) {
    if (!s) return null;
    return 0.09 * num(s.shots) + 0.21 * num(s.shots_on_target) + 0.02 * num(s.corners);
  }

  // Índice de dominio (0..1 a favor del local) — promedio ponderado de varias stats
  function dominance(h, a) {
    const xgH = xgProxy(h) || 0, xgA = xgProxy(a) || 0;
    const disciplineH = num(a.fouls) + num(a.yellow_cards) * 2 + num(a.red_cards) * 4; // del rival: menos es mejor
    const disciplineA = num(h.fouls) + num(h.yellow_cards) * 2 + num(h.red_cards) * 4;
    const comps = [
      [0.30, share(num(h.shots_on_target), num(a.shots_on_target))],
      [0.30, share(xgH, xgA)],
      [0.15, share(num(h.shots), num(a.shots))],
      [0.15, share(num(h.possession), num(a.possession))],
      [0.07, share(num(h.corners), num(a.corners))],
      [0.03, share(disciplineH, disciplineA)],
    ];
    let wsum = 0, val = 0;
    comps.forEach(([w, s]) => { wsum += w; val += w * s; });
    return wsum ? val / wsum : 0.5;
  }

  // Análisis completo de un partido
  function analyze(h, a, hs, as) {
    if (!h || !a) return null;
    const xgH = xgProxy(h), xgA = xgProxy(a);
    if (xgH == null || xgA == null) return null;
    const dom = dominance(h, a);
    const perf = 1 / (1 + Math.exp(-((xgH - xgA) / 0.6))); // prob. de que el local "mereciera" ganar
    const actual = hs > as ? 1 : hs === as ? 0.5 : 0;
    let verdict;
    if (Math.abs(perf - actual) < 0.2) verdict = "Resultado justo";
    else if (perf > actual) verdict = "El local mereció más";
    else verdict = "La visita mereció más";
    return { xgH, xgA, dom, perf, verdict };
  }

  window.Analytics = { xgProxy, dominance, analyze };
})();

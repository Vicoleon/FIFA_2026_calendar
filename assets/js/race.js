// ============================================================
//  La carrera de la quiniela — animación tipo "carrera de caballos"
//  Lee la tabla por día (RPC race_timeline / race_meta, agregada y
//  protegida por el código del grupo) y la anima: el carril = posición,
//  avanzar a la derecha = más puntos. Hereda el tema activo (CSS vars).
// ============================================================
(function () {
  const cfg = window.APP_CONFIG || {};
  const rdb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Colores de identidad de cada jugador (estables entre temas, legibles en claro y oscuro)
  const PAL = ["#2b6bff","#ff2d95","#0ca678","#e8920a","#7c5cff","#e8590c","#16a34a","#dc2626","#0891b2","#9333ea"];
  const MONTHS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const CODE_KEY = "wc-quiniela-code";

  let S = null; // estado de la carrera montada actualmente

  const fmtDay = (iso) => { const d = new Date(iso + "T12:00:00"); return d.getDate() + " " + MONTHS[d.getMonth()]; };
  const initials = (n) => { const p = (n||"?").trim().split(/\s+/).filter(Boolean); return ((p[0]||"?")[0] + (p[1]?p[1][0]:"")).toUpperCase(); };
  const shortName = (n) => (n||"").trim().split(/\s+/)[0] || n;
  const q = (s) => S.root.querySelector(s);

  const TEMPLATE = `
    <section class="race">
      <button id="race-back" class="btn btn-ghost race-back">← Mis grupos</button>
      <div class="race-head">
        <div>
          <h3 class="race-title">🏇 La carrera de la quiniela</h3>
          <div class="race-sub" id="race-pool">Elige tu grupo para ver la carrera.</div>
        </div>
        <div class="race-pick">
          <select id="race-group" hidden aria-label="Grupo"></select>
          <input id="race-code" type="text" maxlength="12" placeholder="Código del grupo" autocomplete="off" />
          <button id="race-load" class="btn btn-ghost">Ver</button>
        </div>
      </div>
      <div class="race-controls" id="race-controls" hidden>
        <button id="race-play" class="btn">▶ Reproducir</button>
        <button id="race-restart" class="btn btn-ghost" title="Reiniciar" aria-label="Reiniciar">⟲</button>
        <input id="race-scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Línea de tiempo por día" />
        <span class="race-readout"><b id="race-day">—</b><span class="race-lead">Líder: <b id="race-lead">—</b></span></span>
      </div>
      <div class="race-stage" id="race-stage"><p class="loading">Cargando…</p></div>
      <p class="race-foot">Datos en vivo · sólo se muestra la tabla (nombre + puntos por día); los pronósticos individuales siguen privados.</p>
    </section>`;

  async function mount(container) {
    if (S && S.raf) cancelAnimationFrame(S.raf);
    container.innerHTML = TEMPLATE;
    S = { root: container, t: 0, playing: false, raf: null, last: null, dur: 850, race: null, meId: null, G: {} };

    // Volver a la vista "Mis grupos" (la enruta la capa de quiniela vía evento).
    q("#race-back").onclick = () => document.dispatchEvent(new CustomEvent("quiniela:nav", { detail: { view: "misgrupos" } }));
    q("#race-load").onclick = () => loadRace(q("#race-code").value);
    q("#race-code").addEventListener("keydown", (e) => { if (e.key === "Enter") loadRace(q("#race-code").value); });
    q("#race-group").onchange = (e) => e.target.value && loadRace(e.target.value);
    q("#race-play").onclick = () => (S.playing ? stop() : play());
    q("#race-restart").onclick = () => { stop(); S.t = 0; render(0); };
    q("#race-scrub").oninput = () => { stop(); const L = S.race.days.length - 1; S.t = (+q("#race-scrub").value / 1000) * L; render(S.t); };

    const saved = localStorage.getItem(CODE_KEY) || "";
    q("#race-code").value = saved;

    // Si hay sesión, ofrece sus grupos (sin teclear código) y resalta al usuario
    let session = null;
    try { ({ data: { session } } = await rdb.auth.getSession()); } catch (_) {}
    S.meId = session?.user?.id || null;

    if (session) {
      const { data: groups } = await rdb.rpc("race_my_groups");
      if (groups && groups.length) {
        const sel = q("#race-group");
        sel.hidden = false; q("#race-code").hidden = true;
        sel.innerHTML = groups.map((g) => `<option value="${g.join_code}">${esc(g.name)} (${g.members})</option>`).join("");
        const pick = groups.find((g) => g.join_code === saved) ? saved : groups[0].join_code;
        sel.value = pick; loadRace(pick); return;
      }
    }
    if (saved) loadRace(saved);
    else showMsg('Escribe el código de tu grupo y dale <b>Ver</b>.');
  }

  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
  function showMsg(html) { const st = q("#race-stage"); if (st) st.innerHTML = `<p class="loading">${html}</p>`; }

  async function loadRace(code) {
    code = (code || "").trim();
    if (!code) { showMsg("Falta el código del grupo."); return; }
    localStorage.setItem(CODE_KEY, code);
    showMsg("Cargando la carrera…");
    q("#race-controls").hidden = true;

    const [{ data: rows, error: e1 }, { data: metaRows, error: e2 }] = await Promise.all([
      rdb.rpc("race_timeline", { p_join_code: code }),
      rdb.rpc("race_meta", { p_join_code: code })
    ]);
    if (e1 || e2) { showMsg("Error al cargar: " + esc(e1?.message || e2?.message)); return; }
    if (!rows || !rows.length) { showMsg("No encontré una carrera para ese código."); return; }

    const meta = metaRows && metaRows[0];
    q("#race-pool").innerHTML = meta
      ? `<b>${esc(meta.name)}</b> · ${meta.members} jugadores · bote ${meta.buy_in} ${esc(meta.currency)} · ${meta.finished_days} días`
      : "";

    const days = [...new Set(rows.map((r) => r.day))].sort();
    const byUser = new Map();
    for (const r of rows) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, { id: r.user_id, name: r.display_name || "Anónimo", avatar: r.avatar || "", cum: {} });
      byUser.get(r.user_id).cum[r.day] = r.cum_points;
    }
    const players = [...byUser.values()].map((p, i) => {
      let prev = 0;
      const series = days.map((d) => { if (p.cum[d] != null) prev = p.cum[d]; return prev; });
      return { ...p, idx: i, series, me: S.meId && p.id === S.meId };
    });
    const maxPts = Math.max(1, ...players.map((p) => p.series[p.series.length - 1]));

    S.race = { players, days, maxPts, orders: days.map((_, j) => players.map((p, i) => i).sort((a, b) => players[b].series[j] - players[a].series[j] || a - b)) };
    buildStage();
    const LAST = days.length - 1;
    S.t = LAST;
    q("#race-controls").hidden = false;
    render(LAST);
  }

  // ---------- geometría responsiva ----------
  function geometry() {
    const st = q("#race-stage"), W = st.clientWidth || 640, N = S.race.players.length, G = S.G;
    G.N = N; G.laneH = Math.max(34, Math.min(54, Math.floor(380 / N)));
    G.top = 10; G.height = G.top + N * G.laneH + 34;
    G.leftCol = Math.min(220, Math.max(150, Math.floor(W * 0.30)));
    G.x0 = G.leftCol + 16; G.x1 = W - 70;
    if (G.x1 < G.x0 + 60) G.x1 = G.x0 + 60;
  }
  const cy = (i) => S.G.top + i * S.G.laneH + S.G.laneH / 2;
  const xFor = (v) => S.G.x0 + (v / S.race.maxPts) * (S.G.x1 - S.G.x0);
  const laneOf = (pi, j) => S.race.orders[j].indexOf(pi);
  function niceTicks(max) { const step = max <= 12 ? 4 : max <= 30 ? 10 : max <= 80 ? 20 : 50; const out = []; for (let v = 0; v < max; v += step) out.push(v); return out; }

  function buildStage() {
    geometry();
    const st = q("#race-stage"), G = S.G;
    st.style.height = G.height + "px";
    let bg = "";
    for (let i = 0; i < G.N; i++) bg += `<div class="race-lane" style="left:${G.x0}px;top:${cy(i)}px;width:${G.x1-G.x0}px"></div>`;
    for (const v of niceTicks(S.race.maxPts)) {
      const x = xFor(v);
      bg += `<div class="race-grid" style="left:${x}px;top:${G.top}px;height:${G.N*G.laneH-8}px"></div>`;
      bg += `<div class="race-axlbl" style="left:${x-5}px;top:${G.height-16}px">${v}</div>`;
    }
    bg += `<div class="race-axlbl" style="left:${G.x1-12}px;top:${G.height-16}px">pts</div>`;
    const fx = xFor(S.race.maxPts) + 8;
    bg += `<div class="race-finish" style="left:${fx}px;top:${G.top}px;height:${G.N*G.laneH-8}px"></div>`;
    bg += `<div class="race-axlbl" style="left:${fx-6}px;top:${G.top-6}px">🏁 meta</div>`;
    st.innerHTML = bg;

    S.race.players.forEach((p) => {
      p.color = PAL[p.idx % PAL.length];
      const np = document.createElement("div");
      np.className = "race-np" + (p.me ? " me" : "");
      np.title = esc(p.name);
      np.style.width = G.leftCol + "px";
      const av = p.avatar
        ? `<img class="race-av" src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'race-av',textContent:'${initials(p.name)}',style:'background:${p.color}'}))" style="background:${p.color}">`
        : `<div class="race-av" style="background:${p.color}">${initials(p.name)}</div>`;
      np.innerHTML = `<span class="race-rk"></span>${av}<span class="race-who">${esc(shortName(p.name))}${p.me?" (tú)":""}</span><span class="race-pts">0</span>`;
      np.onclick = () => { p.me = !p.me; np.classList.toggle("me", p.me); tok.classList.toggle("me", p.me); };
      st.appendChild(np);

      const tok = document.createElement("div");
      tok.className = "race-tok" + (p.me ? " me" : "");
      tok.style.background = p.color;
      tok.innerHTML = p.avatar
        ? `<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.textContent='${initials(p.name)}'">`
        : initials(p.name);
      st.appendChild(tok);
      p._np = np; p._tok = tok; p._pts = np.querySelector(".race-pts"); p._rk = np.querySelector(".race-rk");
    });
  }

  function render(t) {
    if (!S.race) return;
    const days = S.race.days, LAST = days.length - 1;
    const fl = Math.min(LAST, Math.floor(t)), cl = Math.min(LAST, fl + 1), fr = t - Math.floor(t);
    let leadPts = -1, leadName = "", leadPlayer = null;
    S.race.players.forEach((p, pi) => {
      const pts = p.series[fl] + (p.series[cl] - p.series[fl]) * (cl > fl ? fr : 0);
      const li = laneOf(pi, fl) + (laneOf(pi, cl) - laneOf(pi, fl)) * (cl > fl ? fr : 0);
      const y = cy(li), x = xFor(pts);
      p._tok.style.transform = `translate(${x-11}px,${y-11}px)`;
      p._np.style.transform = `translateY(${y-17}px)`;
      p._pts.textContent = Math.round(pts) + " pts";
      p._rk.textContent = Math.round(li) + 1;
      if (pts > leadPts) { leadPts = pts; leadName = shortName(p.name); leadPlayer = p; }
    });
    S.race.players.forEach((p) => {
      let c = p._np.querySelector(".race-crown");
      const isLead = (p === leadPlayer && leadPts > 0);
      if (isLead && !c) { c = document.createElement("span"); c.className = "race-crown"; c.textContent = "👑"; p._np.appendChild(c); }
      if (c) { c.style.opacity = isLead ? "1" : "0"; if (isLead) c.style.left = (S.G.leftCol - 18) + "px"; }
    });
    q("#race-day").textContent = fmtDay(days[Math.min(LAST, Math.round(t))]);
    q("#race-lead").textContent = leadName || "—";
    q("#race-scrub").value = Math.round((t / Math.max(1, LAST)) * 1000);
  }

  function setPlay(p) { q("#race-play").innerHTML = p ? "❚❚ Pausa" : "▶ Reproducir"; }
  function frame(ts) {
    if (!S.root.querySelector("#race-stage")?.isConnected) { stop(); return; } // se cambió de pestaña
    const LAST = S.race.days.length - 1;
    if (S.last == null) S.last = ts;
    S.t += (ts - S.last) / S.dur; S.last = ts;
    if (S.t >= LAST) { S.t = LAST; render(S.t); stop(); return; }
    render(S.t); S.raf = requestAnimationFrame(frame);
  }
  function play() { if (S.playing || !S.race) return; const LAST = S.race.days.length - 1; if (S.t >= LAST) S.t = 0; S.playing = true; S.last = null; setPlay(true); S.raf = requestAnimationFrame(frame); }
  function stop() { S.playing = false; if (S.raf) cancelAnimationFrame(S.raf); S.raf = null; setPlay(false); }

  // reposiciona al cambiar el ancho (rota de pestaña/orientación)
  let rz = null;
  window.addEventListener("resize", () => {
    if (!S || !S.race || !S.root.querySelector("#race-stage")?.isConnected) return;
    clearTimeout(rz); rz = setTimeout(() => { buildStage(); render(S.t); }, 150);
  });

  window.QuinielaRace = { mount };
})();

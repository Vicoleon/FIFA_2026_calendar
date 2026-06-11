// ============================================================
//  Vista "Mi perfil": avatar, nombre/país editables, toggle
//  Auto-pick, estadísticas, insignias y botón de compartir.
// ============================================================
import { db, siteUrl } from "./lib/db.js";
import { state } from "./lib/state.js";
import { esc, toast, refreshApp } from "./lib/dom.js";
import { loadMyAchievements, badgeStrip } from "./achievements.js";

// Cache de logros del usuario para que las acciones (compartir) los reutilicen.
let myAchievements = [];

// ── Vista principal ──────────────────────────────────────────
export async function renderPerfil() {
  // Sin sesión: invitamos a entrar (las acciones de perfil requieren cuenta).
  if (!state.session) {
    return `
      <section class="panel center">
        <h2>👤 Mi perfil</h2>
        <p>Inicia sesión con Google para personalizar tu perfil, ver tus
           estadísticas y presumir tus insignias.</p>
        <button class="btn btn-primary btn-google" data-act="signin">
          <span class="g">G</span> Iniciar sesión
        </button>
      </section>`;
  }

  const uid = state.session.user.id;
  const p = state.profile || {};
  const name = p.display_name || state.session.user.email || "Jugador";

  // Insignias del usuario (módulo achievements). Tolerante a fallos del módulo vecino.
  try {
    myAchievements = (await loadMyAchievements(uid)) || [];
  } catch {
    myAchievements = [];
  }

  // Estadísticas en memoria (state.myPicks ya está cargado).
  const totalPts = Object.values(state.myPicks).reduce((s, x) => s + (x.points || 0), 0);
  const exactCount = Object.values(state.myPicks).filter((x) => x.exact).length;
  const groupCount = state.myGroups.length;
  const autopickOn = !!p.autopick;

  return `
    <section class="panel profile">
      <header class="profile-head">
        ${avatarHtml(p, name)}
        <div class="profile-id">
          <label class="field">
            <span class="field-lbl">Nombre para mostrar</span>
            <input class="prof-name input" type="text" maxlength="40"
                   value="${esc(name)}" placeholder="Tu nombre">
          </label>
          <label class="field">
            <span class="field-lbl">País (opcional)</span>
            <input class="prof-country input" type="text" maxlength="40"
                   value="${esc(p.country || "")}" placeholder="🇲🇽 México">
          </label>
          <button class="btn btn-sm btn-primary" data-act="prof-save">Guardar cambios</button>
        </div>
      </header>

      <div class="profile-autopick">
        <div class="ap-text">
          <b>🤖 Auto-pick</b>
          <span class="muted">Si no pronosticas a tiempo, usamos el pronóstico de la casa por ti.</span>
        </div>
        <button class="toggle ${autopickOn ? "on" : ""}" data-act="prof-autopick"
                role="switch" aria-checked="${autopickOn}"
                aria-label="Activar o desactivar auto-pick">
          <span class="toggle-knob"></span>
        </button>
      </div>

      <div class="profile-stats">
        <div class="stat"><b>${totalPts}</b><span>puntos</span></div>
        <div class="stat"><b>${exactCount}</b><span>exactos 🎯</span></div>
        <div class="stat"><b>${groupCount}</b><span>grupos 👥</span></div>
      </div>

      <div class="profile-badges">
        <h3 class="mq-h">🏅 Mis insignias</h3>
        ${badgeStripSafe(myAchievements)}
      </div>

      <div class="profile-share">
        <button class="btn btn-ghost" data-act="share-card"
                data-title="${esc(name)}"
                data-big="${totalPts} pts"
                data-subtitle="${exactCount} exactos 🎯 · ${groupCount} grupos 👥"
                data-link="${esc(siteUrl())}">
          📤 Compartir
        </button>
      </div>
    </section>`;
}

/** Avatar grande (imagen de Google o inicial de respaldo). */
function avatarHtml(p, name) {
  if (p.avatar_url) {
    return `<img class="avatar avatar--lg" src="${esc(p.avatar_url)}" alt=""
                 referrerpolicy="no-referrer">`;
  }
  const initial = esc((name[0] || "?").toUpperCase());
  return `<span class="avatar avatar--lg avatar--fallback">${initial}</span>`;
}

/** Tira de insignias tolerante: usa badgeStrip del vecino o un fallback simple. */
function badgeStripSafe(list) {
  try {
    const html = badgeStrip(list);
    if (html) return html;
  } catch {
    // El módulo vecino aún no está listo; caemos al fallback.
  }
  if (!list || !list.length) {
    return `<p class="muted">Aún no tienes insignias. ¡Empieza a acertar marcadores!</p>`;
  }
  return `<div class="badge-strip">${list.map(badgeFallback).join("")}</div>`;
}

/** Render mínimo de una insignia (respaldo si badgeStrip no está disponible). */
function badgeFallback(a) {
  return `<span class="badge" title="${esc(a.description || a.name || a.code || "")}">
      ${esc(a.emoji || "🏅")} ${esc(a.name || a.code || "")}
    </span>`;
}

// ── Cableado de la vista (inputs + atajos) ───────────────────
export function wirePerfil(container) {
  if (!container) return;
  // Enter en cualquiera de los inputs guarda el perfil.
  container.querySelectorAll(".prof-name, .prof-country").forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); saveProfile(); }
    });
  });
}

// ── Acciones (enrutadas por el delegado global de app.js) ────
export const actions = {
  "prof-save": () => saveProfile(),
  "prof-autopick": (btn) => toggleAutopick(btn)
};

/** Guarda nombre y país del usuario actual. */
async function saveProfile() {
  const uid = state.session?.user?.id;
  if (!uid) { toast("Inicia sesión para editar tu perfil", "error"); return; }

  const nameEl = document.querySelector(".prof-name");
  const countryEl = document.querySelector(".prof-country");
  const display_name = (nameEl?.value || "").trim();
  const country = (countryEl?.value || "").trim() || null;

  if (!display_name) { toast("El nombre no puede estar vacío", "error"); return; }

  const { error } = await db.from("profiles")
    .update({ display_name, country })
    .eq("id", uid);
  if (error) { toast(error.message, "error"); return; }

  toast("Perfil actualizado ✓", "success");
  refreshApp();
}

/** Alterna el auto-pick (rellena con el pronóstico de la casa si no juegas). */
async function toggleAutopick(btn) {
  const uid = state.session?.user?.id;
  if (!uid) { toast("Inicia sesión para configurar el auto-pick", "error"); return; }

  const next = !(state.profile?.autopick);
  // Feedback inmediato en el botón antes del refresh.
  btn?.classList.toggle("on", next);
  btn?.setAttribute("aria-checked", String(next));

  const { error } = await db.from("profiles")
    .update({ autopick: next })
    .eq("id", uid);
  if (error) {
    btn?.classList.toggle("on", !next);
    btn?.setAttribute("aria-checked", String(!next));
    toast(error.message, "error");
    return;
  }

  toast(next ? "Auto-pick activado 🤖" : "Auto-pick desactivado", "success");
  refreshApp();
}

// ============================================================
//  Selector de tema visual (Neón / Fiesta / Editorial).
//  Persiste en localStorage (instantáneo + anónimo) y, si hay
//  sesión, en profiles.theme (para recordarlo en cualquier dispositivo).
// ============================================================
import { db } from "./lib/db.js";
import { state } from "./lib/state.js";

export const THEMES = [
  { id: "neon", name: "Neón" },
  { id: "fiesta", name: "Fiesta" },
  { id: "editorial", name: "Editorial" }
];

const KEY = "wc-theme";
const isValid = (id) => THEMES.some((t) => t.id === id);

export function currentTheme() {
  return document.documentElement.dataset.theme || "neon";
}

/** Aplica un tema; persiste en localStorage y (si hay sesión) en el perfil. */
export function applyTheme(id, { persist = true } = {}) {
  if (!isValid(id)) id = "neon";
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem(KEY, id); } catch (_) { /* ignora */ }
  document.querySelectorAll(".td-opt").forEach((o) =>
    o.classList.toggle("active", o.dataset.themeId === id));

  if (persist && state.session?.user?.id && state.profile) {
    state.profile = { ...state.profile, theme: id };
    db.from("profiles").update({ theme: id }).eq("id", state.session.user.id)
      .then(({ error }) => { if (error) console.warn("theme save:", error.message); });
  }
}

/** Aplica el tema guardado en el perfil del usuario (al iniciar sesión). */
export function applyUserTheme() {
  const fromProfile = state.profile?.theme;
  applyTheme(isValid(fromProfile) ? fromProfile : currentTheme(), { persist: false });
}

/** Conecta el dock de temas (una vez, al arrancar). */
export function wireThemeDock() {
  document.querySelectorAll(".td-opt").forEach((o) =>
    (o.onclick = () => applyTheme(o.dataset.themeId)));
  applyTheme(currentTheme(), { persist: false });
}

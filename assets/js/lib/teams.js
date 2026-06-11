// ============================================================
//  Helpers de presentación de equipos (compartido, sin ciclos).
// ============================================================
import { state } from "./state.js";
import { esc } from "./dom.js";

export function teamName(id) { return state.teamMap[id]?.name_es || id || null; }
export function teamFlag(id) { return state.teamMap[id]?.flag || "🏳️"; }

export function teamChip(id, placeholder) {
  if (id) {
    const t = state.teamMap[id];
    return `<span class="team"><span class="flag">${esc(t?.flag || "🏳️")}</span><span class="tname">${esc(t?.name_es || id)}</span></span>`;
  }
  return `<span class="team team--ph"><span class="flag">❓</span><span class="tname">${esc(placeholder || "Por definir")}</span></span>`;
}

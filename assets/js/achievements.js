// ============================================================
//  Logros / insignias (achievements / badges).
//  Catálogo público + insignias ganadas por cada usuario.
//  Sólo lectura: las gana el motor de puntaje (funciones SQL).
// ============================================================
import { db } from "./lib/db.js";
import { esc } from "./lib/dom.js";

// Caché en memoria del catálogo de logros (code -> {name, emoji, description}).
// Se carga una sola vez por sesión de página y se reutiliza.
let catalogCache = null;
let catalogPromise = null;

/** Carga (y cachea) el catálogo de logros como mapa por código. */
async function loadCatalog() {
  if (catalogCache) return catalogCache;
  // Evita cargas duplicadas si varias llamadas concurren antes de resolver.
  if (!catalogPromise) {
    catalogPromise = db
      .from("achievements")
      .select("*")
      .then(({ data, error }) => {
        if (error) {
          // Ante error, devolvemos catálogo vacío (degradación elegante).
          catalogPromise = null;
          return {};
        }
        catalogCache = Object.fromEntries(
          (data || []).map((a) => [a.code, a])
        );
        return catalogCache;
      });
  }
  return catalogPromise;
}

/**
 * Devuelve las insignias ganadas por un usuario (deduplicadas por código).
 * @param {string} userId
 * @returns {Promise<Array<{code,name,emoji,description,earned_at}>>}
 */
export async function loadMyAchievements(userId) {
  if (!userId) return [];

  const [{ data: rows, error }, catalog] = await Promise.all([
    db.from("user_achievements").select("code, earned_at, group_id").eq("user_id", userId),
    loadCatalog()
  ]);
  if (error || !rows?.length) return [];

  // Dedup por code: conservamos la fecha MÁS RECIENTE de obtención.
  const byCode = new Map();
  for (const r of rows) {
    const prev = byCode.get(r.code);
    if (!prev || new Date(r.earned_at) > new Date(prev.earned_at)) {
      byCode.set(r.code, r);
    }
  }

  return [...byCode.values()].map((r) => {
    const meta = catalog[r.code] || {};
    return {
      code: r.code,
      name: meta.name || r.code,
      emoji: meta.emoji || "🏅",
      description: meta.description || "",
      earned_at: r.earned_at
    };
  });
}

/**
 * Tira de insignias en HTML. Cada logro como <span class="badge-chip">.
 * @param {Array<{code,name,emoji,description}>} list
 * @returns {string} HTML (cadena vacía si no hay insignias)
 */
export function badgeStrip(list) {
  if (!list?.length) return "";
  const chips = list
    .map(
      (b) =>
        `<span class="badge-chip" title="${esc(b.description || b.name || "")}">` +
        `${esc(b.emoji || "🏅")} ${esc(b.name || b.code || "")}</span>`
    )
    .join("");
  return `<div class="badge-strip">${chips}</div>`;
}

/**
 * Atajo: sólo los emojis de las insignias del usuario (cadena corta),
 * útil junto a nombres en tablas de posiciones.
 * @param {string} userId
 * @returns {Promise<string>} p. ej. "🎯🔥" (vacía si no hay)
 */
export async function badgesFor(userId) {
  const list = await loadMyAchievements(userId);
  // Emojis ya provienen del catálogo (seguros); no requieren esc() al ser sólo emojis.
  return list.map((b) => b.emoji || "🏅").join("");
}

// ============================================================
//  Recordatorio in-app: banner que avisa de partidos que arrancan
//  pronto y que el usuario aún no ha pronosticado.
//  Estrategia "push": el aviso aparece solo, sin que el usuario
//  tenga que buscarlo (ver principios de Jose: spoon-feed al usuario).
// ============================================================
import { state } from "./lib/state.js";
import { hasKickedOff, navigate } from "./lib/dom.js";

// Ventana de aviso: partidos que arrancan dentro de las próximas 36 horas.
const VENTANA_MS = 36 * 60 * 60 * 1000;

/**
 * ¿Este partido cuenta como pendiente urgente?
 * Requiere: equipos resueltos, no finalizado, sin haber arrancado,
 * kickoff dentro de la ventana (now < kickoff <= now+36h) y SIN pick.
 */
function esPendienteUrgente(m, now) {
  if (!m._home || !m._away) return false;          // equipos aún sin definir
  if (m.status === "finished") return false;        // ya terminó
  if (hasKickedOff(m)) return false;                // ya arrancó
  if (state.myPicks[m.id]) return false;            // ya tiene pronóstico
  const t = m.kickoff ? new Date(m.kickoff).getTime() : NaN;
  if (!Number.isFinite(t)) return false;            // sin fecha válida
  return t > now && t <= now + VENTANA_MS;          // arranca pronto
}

/**
 * Banner de recordatorio. SÍNCRONA: devuelve un HTML string (o "").
 * Sin sesión o sin partidos urgentes -> "" (no se muestra nada).
 */
export function reminderBanner() {
  if (!state.session) return "";

  const now = Date.now();
  const n = state.matches.filter((m) => esPendienteUrgente(m, now)).length;
  if (n === 0) return "";

  // Pluralización ligera en español.
  const sustantivo = n === 1 ? "partido" : "partidos";
  return `
    <div class="reminder-banner" role="status">
      <span class="reminder-text">
        ⏰ Tienes <b>${n}</b> ${sustantivo} por pronosticar que ${n === 1 ? "arranca" : "arrancan"} pronto
      </span>
      <button class="btn btn-sm btn-primary" data-act="go-miquiniela">Pronosticar ahora</button>
    </div>`;
}

// ── Acciones (las enruta el delegado global de app.js por data-act) ──
export const actions = {
  "go-miquiniela": () => navigate("miquiniela")
};

// ============================================================
//  Invitaciones a grupos: por link tokenizado y por email.
//  Maneja también el parámetro ?invite= al cargar la app.
//  Las acciones de UI viven en groups.js (este módulo solo expone helpers).
// ============================================================
import { rpc, siteUrl, invokeFn } from "./lib/db.js";
import { toast } from "./lib/dom.js";
import { state } from "./lib/state.js";

/** Construye el link público de invitación a partir de un token. */
function inviteUrl(token) {
  // siteUrl() ya termina en "/", así que añadimos el query directamente.
  return siteUrl() + "?invite=" + token;
}

/** Quita el parámetro ?invite= de la URL sin recargar la página. */
function clearInviteParam() {
  const url = new URL(location.href);
  url.searchParams.delete("invite");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

/**
 * Lee ?invite= al cargar la app y decide qué hacer.
 *  - Sin token  -> undefined.
 *  - Con token + sesión: acepta la invitación y devuelve la vista "misgrupos".
 *  - Con token sin sesión: muestra a qué grupo lo invitan y pide iniciar sesión
 *    (el token sobrevive al redirect de Google porque va en la URL).
 * @returns {Promise<string|undefined>} clave de vista a la que navegar, o undefined.
 */
export async function maybeHandleInviteParam() {
  const token = new URLSearchParams(location.search).get("invite");
  if (!token) return undefined;

  // Hay sesión -> aceptamos directamente y limpiamos la URL.
  if (state.session) {
    try {
      await rpc("accept_invite", { p_token: token });
      toast("Te uniste al grupo ✓", "success");
      clearInviteParam();
      return "misgrupos";
    } catch (e) {
      toast(e.message || "No se pudo aceptar la invitación", "error");
      clearInviteParam();
      return undefined;
    }
  }

  // Sin sesión -> intentamos resolver el nombre del grupo para el mensaje.
  let groupName = "el grupo";
  try {
    const info = await rpc("invite_info", { p_token: token });
    // invite_info devuelve una tabla -> tomamos la primera fila si existe.
    const row = Array.isArray(info) ? info[0] : info;
    if (row?.group_name) groupName = row.group_name;
  } catch {
    // Si falla la consulta del nombre, seguimos con el mensaje genérico.
  }
  toast("Inicia sesión para unirte a " + groupName, "info");
  // No limpiamos el token: debe sobrevivir al redirect de inicio de sesión.
  return undefined;
}

/**
 * Crea un link de invitación (sin email asociado) para un grupo.
 * @param {string} groupId
 * @returns {Promise<string>} URL completa lista para compartir.
 */
export async function createInviteLink(groupId) {
  const token = await rpc("create_invite", { p_group: groupId, p_email: null });
  return inviteUrl(token);
}

/**
 * Envía invitaciones por email: genera un token por destinatario y dispara
 * la Edge Function de correo. Agrupa errores y reporta el resultado por toast.
 * @param {string} groupId
 * @param {string[]} emails  lista de correos (se filtran los inválidos/vacíos).
 * @returns {Promise<{ sent: number, failed: string[] }>}
 */
export async function sendEmailInvites(groupId, emails) {
  const valid = (emails || [])
    .map((e) => String(e || "").trim())
    .filter((e) => isValidEmail(e));

  if (!valid.length) {
    toast("Escribe al menos un email válido", "error");
    return { sent: 0, failed: [] };
  }

  let sent = 0;
  const failed = [];

  // Secuencial para no saturar la función de correo y aislar fallos por email.
  // La Edge Function 'send-email' crea la invitación (verificando que somos
  // miembros del grupo) y arma el link en el servidor: no enviamos un link
  // desde el cliente para evitar que se use como relay de correo.
  for (const email of valid) {
    try {
      await invokeFn(window.APP_CONFIG.EMAIL_FN, {
        type: "invite",
        to: email,
        group_id: groupId
      });
      sent++;
    } catch {
      failed.push(email);
    }
  }

  // Resumen del resultado para el usuario.
  if (sent && !failed.length) {
    toast(`Invitación enviada a ${sent} ${sent === 1 ? "correo" : "correos"} ✓`, "success");
  } else if (sent && failed.length) {
    toast(`Enviadas ${sent}; fallaron: ${failed.join(", ")}`, "error");
  } else {
    toast("No se pudo enviar ninguna invitación", "error");
  }

  return { sent, failed };
}

/** Validación simple de email (anti-typos básicos; el backend valida de nuevo). */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Las acciones de botones viven en groups.js; aquí no exponemos ninguna.
export const actions = {};

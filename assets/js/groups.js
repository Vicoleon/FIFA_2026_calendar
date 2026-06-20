// ============================================================
//  Vista "Mis grupos": crear, unirse, ver standings + bote (pot),
//  invitar (link / email) y administrar (pagos, expulsar, salir, eliminar).
//  Las vistas devuelven HTML string; las acciones se enrutan por data-act.
// ============================================================
import { db, rpc } from "./lib/db.js";
import { state } from "./lib/state.js";
import { esc, toast, refreshApp } from "./lib/dom.js";

// ── Helpers de formato ────────────────────────────────────

/** UID del usuario actual (o null). */
function uid() { return state.session?.user?.id || null; }

/** Formatea un monto con su moneda (ej. "1,200 MXN"). */
function fmtMoney(amount, currency) {
  const n = Number(amount || 0);
  return `${n.toLocaleString("es-MX")} ${esc(currency || "MXN")}`;
}

/** Avatar (imagen o inicial) para una fila de la tabla. */
function avatarHtml(row) {
  const name = row.display_name || "Jugador";
  if (row.avatar_url) {
    return `<img class="avatar avatar--sm" src="${esc(row.avatar_url)}" alt="" referrerpolicy="no-referrer">`;
  }
  return `<span class="avatar avatar--sm avatar--fallback">${esc((name[0] || "?").toUpperCase())}</span>`;
}

// ── Vista principal ───────────────────────────────────────

/** Renderiza la vista "Mis grupos". Devuelve un HTML string. */
export async function renderGrupos() {
  // Sin sesión: CTA para iniciar sesión.
  if (!state.session) {
    return `<section class="panel center">
      <h2>👥 Mis grupos</h2>
      <p>Inicia sesión con Google para crear grupos, invitar a tus amigos y competir por el bote.</p>
      <button class="btn btn-primary btn-google" data-act="signin"><span class="g">G</span> Iniciar sesión</button>
    </section>`;
  }

  // Carga en paralelo la tabla de cada grupo (standings).
  const groups = state.myGroups || [];
  const standings = await Promise.all(groups.map((g) => loadStandings(g.id)));
  const byGroup = Object.fromEntries(groups.map((g, i) => [g.id, standings[i]]));

  return `
    <section class="panel">
      <h2>👥 Mis grupos</h2>
      ${createFormHtml()}
      ${joinFormHtml()}
      ${groups.length
        ? `<div class="grp-list">${groups.map((g) => groupCardHtml(g, byGroup[g.id])).join("")}</div>`
        : `<p class="muted">Aún no perteneces a ningún grupo. Crea uno o únete con un código.</p>`}
    </section>`;
}

/** Carga la tabla de posiciones de un grupo (ordenada por puntos). */
async function loadStandings(gid) {
  const { data, error } = await db
    .from("leaderboard_group")
    .select("*")
    .eq("group_id", gid);
  if (error) return [];
  // Orden: más puntos, luego más exactos, luego quien acertó antes.
  return (data || []).sort((a, b) =>
    (b.total_pts - a.total_pts) ||
    (b.exact_count - a.exact_count) ||
    (lastCorrectMs(a) - lastCorrectMs(b))
  );
}

/** Timestamp (ms) de last_correct_at; sin valor va al final. */
function lastCorrectMs(row) {
  return row.last_correct_at ? new Date(row.last_correct_at).getTime() : Infinity;
}

// ── Formularios ───────────────────────────────────────────

/** Formulario "Crear grupo". */
function createFormHtml() {
  return `
    <form class="grp-form card" data-grp-create>
      <h3 class="grp-h">➕ Crear grupo</h3>
      <div class="grp-fields">
        <input class="grp-name" type="text" maxlength="60" placeholder="Nombre del grupo" aria-label="Nombre del grupo" required>
        <input class="grp-buyin" type="number" min="0" step="1" inputmode="numeric" value="0" placeholder="Costo de entrada" aria-label="Costo de entrada">
        <input class="grp-currency" type="text" maxlength="6" value="MXN" placeholder="Moneda" aria-label="Moneda">
        <button class="btn btn-primary" type="button" data-act="grp-create">Crear</button>
      </div>
    </form>`;
}

/** Formulario "Unirme por código". */
function joinFormHtml() {
  return `
    <form class="grp-form card" data-grp-join>
      <h3 class="grp-h">🔑 Unirme por código</h3>
      <div class="grp-fields">
        <input class="grp-code" type="text" maxlength="12" placeholder="Código (ej. A1B2C3)" aria-label="Código de grupo" required>
        <button class="btn btn-primary" type="button" data-act="grp-join">Unirme</button>
      </div>
    </form>`;
}

// ── Tarjeta de grupo ──────────────────────────────────────

/** Tarjeta de un grupo: standings, bote, invitaciones y administración. */
function groupCardHtml(group, rows) {
  const isOwner = group.owner_id === uid();
  const paidCount = rows.filter((r) => r.paid).length;
  const pot = Number(group.buy_in || 0) * paidCount;
  // Líder = primero con puntos > 0 (antes de que empiece el torneo no hay líder).
  const leader = rows.find((r) => (r.total_pts || 0) > 0) || null;

  return `
    <article class="grp-card card" data-gid="${esc(group.id)}">
      <header class="grp-card-head">
        <h3 class="grp-card-title">${esc(group.name)}</h3>
        <span class="grp-code-badge" title="Código para unirse">Código: <b>${esc(group.join_code)}</b></span>
      </header>

      ${inviteHtml(group)}
      ${potHtml(group, pot, paidCount, leader)}
      ${standingsHtml(group, rows, isOwner)}
      ${raceCardBtnHtml(group)}
      ${adminFooterHtml(group, isOwner)}
    </article>`;
}

/** Botón que abre la carrera animada de ESTE grupo (guarda su código y navega). */
function raceCardBtnHtml(group) {
  return `<button class="btn grp-race-btn" data-act="grp-carrera" data-code="${esc(group.join_code)}">
    🏇 Ver la carrera de la quiniela
  </button>`;
}

/** Bloque de invitaciones (link + email). */
function inviteHtml(group) {
  const gid = esc(group.id);
  return `
    <div class="grp-invite">
      <button class="btn btn-sm btn-ghost" data-act="grp-invite-link" data-gid="${gid}">🔗 Copiar link de invitación</button>
      <div class="grp-invite-email">
        <input class="grp-emails" type="text" placeholder="correos separados por coma" aria-label="Correos a invitar">
        <button class="btn btn-sm" data-act="grp-invite-email" data-gid="${gid}">✉️ Invitar por email</button>
      </div>
    </div>`;
}

/** Bloque del bote (pot) + a quién se pagaría. */
function potHtml(group, pot, paidCount, leader) {
  const payee = leader
    ? `Pagaría al líder: <b>${esc(leader.display_name || "Jugador")}</b> (${leader.total_pts} pts)`
    : `Aún sin líder`;
  return `
    <div class="grp-pot">
      <div class="grp-pot-amount"><span class="grp-pot-label">💰 Bote</span> <b>${fmtMoney(pot, group.currency)}</b></div>
      <div class="grp-pot-meta">${paidCount} pagado(s) · ${payee}</div>
    </div>`;
}

/** Tabla de miembros / standings del grupo. */
function standingsHtml(group, rows, isOwner) {
  if (!rows.length) return `<p class="muted">Aún no hay miembros con actividad.</p>`;
  const gid = esc(group.id);
  return `
    <table class="grp-table">
      <thead>
        <tr>
          <th>#</th><th>Jugador</th><th>Pts</th><th>🎯</th><th>Pago</th>
          ${isOwner ? `<th>Acciones</th>` : ""}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => memberRowHtml(group, r, i, isOwner, gid)).join("")}
      </tbody>
    </table>`;
}

/** Fila de un miembro en la tabla del grupo. */
function memberRowHtml(group, r, i, isOwner, gid) {
  const uId = esc(r.user_id);
  const paidBadge = r.paid
    ? `<span class="paid paid--yes">✓ Pagado</span>`
    : `<span class="paid paid--no">— Pendiente</span>`;
  const isMe = r.user_id === uid();

  // Acciones de owner por miembro: alternar pago y expulsar (excepto a sí mismo).
  const ownerActions = isOwner
    ? `<td class="grp-row-actions">
         <button class="btn btn-sm btn-ghost" data-act="grp-paid"
                 data-gid="${gid}" data-uid="${uId}" data-paid="${r.paid ? "0" : "1"}">
           ${r.paid ? "Marcar no pagado" : "Marcar pagado"}
         </button>
         ${isMe ? "" : `<button class="btn btn-sm btn-ghost" data-act="grp-remove" data-gid="${gid}" data-uid="${uId}">Expulsar</button>`}
       </td>`
    : "";

  return `
    <tr class="${isMe ? "is-me" : ""}">
      <td class="grp-rank">${i + 1}</td>
      <td class="grp-player">${avatarHtml(r)} <span class="grp-pname">${esc(r.display_name || "Jugador")}</span></td>
      <td class="grp-pts"><b>${r.total_pts}</b></td>
      <td class="grp-exact">${r.exact_count}</td>
      <td class="grp-paid">${paidBadge}</td>
      ${ownerActions}
    </tr>`;
}

/** Pie de administración: eliminar (owner) o salir (miembro). */
function adminFooterHtml(group, isOwner) {
  const gid = esc(group.id);
  if (isOwner) {
    return `<footer class="grp-card-foot">
      <button class="btn btn-sm" data-act="grp-delete" data-gid="${gid}">🗑️ Eliminar grupo</button>
    </footer>`;
  }
  return `<footer class="grp-card-foot">
    <button class="btn btn-sm" data-act="grp-leave" data-gid="${gid}">🚪 Salir del grupo</button>
  </footer>`;
}

// ── wire (sin necesidad de lógica extra; delegación global maneja todo) ──
export function wireGrupos(_container) { /* sin acciones que conectar aquí */ }

// ── Acciones (enrutadas por el delegado global de app.js vía data-act) ──

export const actions = {
  "grp-create": (btn) => createGroup(btn),
  "grp-join": (btn) => joinGroup(btn),
  "grp-invite-link": (btn) => inviteLink(btn.dataset.gid),
  "grp-invite-email": (btn) => inviteEmail(btn),
  "grp-paid": (btn) => setPaid(btn.dataset.gid, btn.dataset.uid, btn.dataset.paid === "1"),
  "grp-remove": (btn) => removeMember(btn.dataset.gid, btn.dataset.uid),
  "grp-leave": (btn) => leaveGroup(btn.dataset.gid),
  "grp-delete": (btn) => deleteGroup(btn.dataset.gid),
  "grp-carrera": (btn) => openRace(btn.dataset.code)
};

/** Guarda el código del grupo y abre la vista de la carrera (la pinta app.js). */
function openRace(code) {
  // Misma clave que usa race.js (CODE_KEY) para autoseleccionar este grupo.
  try { localStorage.setItem("wc-quiniela-code", code); } catch (_) {}
  document.dispatchEvent(new CustomEvent("quiniela:nav", { detail: { view: "carrera" } }));
}

/** Crea un grupo a partir del formulario contenedor del botón. */
async function createGroup(btn) {
  const form = btn.closest("[data-grp-create]");
  const name = form?.querySelector(".grp-name")?.value.trim() || "";
  const buyIn = Number(form?.querySelector(".grp-buyin")?.value || 0);
  const currency = form?.querySelector(".grp-currency")?.value.trim() || "MXN";
  if (!name) { toast("Escribe un nombre para el grupo", "error"); return; }
  if (!Number.isFinite(buyIn) || buyIn < 0) { toast("Costo de entrada inválido", "error"); return; }
  try {
    await rpc("create_group", { p_name: name, p_buy_in: buyIn, p_currency: currency });
    toast("Grupo creado ✓", "success");
    refreshApp();
  } catch (e) {
    toast(e.message, "error");
  }
}

/** Une al usuario a un grupo mediante código. */
async function joinGroup(btn) {
  const form = btn.closest("[data-grp-join]");
  const code = form?.querySelector(".grp-code")?.value.trim() || "";
  if (!code) { toast("Escribe el código del grupo", "error"); return; }
  try {
    await rpc("join_group_by_code", { p_code: code });
    toast("Te uniste al grupo ✓", "success");
    refreshApp();
  } catch (e) {
    toast(e.message, "error");
  }
}

/** Genera un link de invitación y lo copia al portapapeles. */
async function inviteLink(gid) {
  try {
    const { createInviteLink } = await import("./invites.js");
    const link = await createInviteLink(gid);
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copiado al portapapeles ✓", "success");
    } catch {
      // Sin permiso de portapapeles: muestra el link en el toast.
      toast("Link de invitación: " + link, "info");
    }
  } catch (e) {
    toast(e.message, "error");
  }
}

/** Envía invitaciones por email (lista separada por comas). */
async function inviteEmail(btn) {
  const gid = btn.dataset.gid;
  const card = btn.closest(".grp-card");
  const raw = card?.querySelector(".grp-emails")?.value || "";
  const emails = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!emails.length) { toast("Escribe al menos un correo", "error"); return; }
  try {
    const invites = await import("./invites.js");
    // sendEmailInvites ya muestra el toast del resultado; aquí solo usamos el conteo.
    const { sent } = await invites.sendEmailInvites(gid, emails);
    if (sent) {
      const input = card?.querySelector(".grp-emails");
      if (input) input.value = "";
    }
  } catch (e) {
    toast(e.message, "error");
  }
}

/** Owner: marca a un miembro como pagado / no pagado. */
async function setPaid(gid, userId, paid) {
  try {
    await rpc("set_member_paid", { p_group: gid, p_user: userId, p_paid: paid });
    refreshApp();
  } catch (e) {
    toast(e.message, "error");
  }
}

/** Owner: expulsa a un miembro del grupo. */
async function removeMember(gid, userId) {
  if (!confirm("¿Expulsar a este miembro del grupo?")) return;
  try {
    await rpc("remove_member", { p_group: gid, p_user: userId });
    toast("Miembro expulsado");
    refreshApp();
  } catch (e) {
    toast(e.message, "error");
  }
}

/** Miembro: sale del grupo. */
async function leaveGroup(gid) {
  if (!confirm("¿Salir de este grupo?")) return;
  try {
    await rpc("leave_group", { p_group: gid });
    toast("Saliste del grupo");
    refreshApp();
  } catch (e) {
    toast(e.message, "error");
  }
}

/** Owner: elimina el grupo por completo (vía RPC security-definer). */
async function deleteGroup(gid) {
  if (!confirm("¿Eliminar este grupo? Esta acción no se puede deshacer.")) return;
  try {
    await rpc("delete_group", { p_group: gid });
    toast("Grupo eliminado");
    refreshApp();
  } catch (e) {
    toast(e.message, "error");
  }
}

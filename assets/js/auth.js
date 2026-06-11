// ============================================================
//  Autenticación con Google (Supabase Auth) + perfil + rol editor.
// ============================================================
import { db, siteUrl } from "./lib/db.js";
import { state, loadUserData } from "./lib/state.js";
import { esc, toast } from "./lib/dom.js";

const cfg = window.APP_CONFIG;

export function currentUser() { return state.session?.user || null; }

/** ¿El usuario es editor autorizado? (solo afecta la UI; RLS protege la BD). */
export function isEditor() {
  const email = (currentUser()?.email || "").toLowerCase();
  return !!email && cfg.EDITOR_EMAILS.map((e) => e.toLowerCase()).includes(email);
}

export async function signInWithGoogle() {
  const { error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.href }   // vuelve a la misma página (preserva ?invite=)
  });
  if (error) toast("No se pudo iniciar sesión: " + error.message, "error");
}

export async function signOut() {
  await db.auth.signOut();
  toast("Sesión cerrada");
}

/** Crea el perfil si no existe (respaldo del trigger) y lo carga en el estado. */
export async function ensureProfile() {
  const u = currentUser();
  if (!u) { state.profile = null; return; }
  const meta = u.user_metadata || {};
  await db.from("profiles").upsert(
    {
      id: u.id,
      display_name: meta.full_name || meta.name || (u.email || "").split("@")[0],
      avatar_url: meta.avatar_url || meta.picture || null,
      email: u.email
    },
    { onConflict: "id", ignoreDuplicates: true }
  );
  const { data } = await db.from("profiles").select("*").eq("id", u.id).single();
  state.profile = data || null;
}

/**
 * Inicializa la sesión y se suscribe a cambios.
 * @param {(event:string)=>void} onChange  callback al cambiar la sesión
 */
export async function initAuth(onChange) {
  const { data } = await db.auth.getSession();
  state.session = data.session;
  if (state.session) await ensureProfile();

  db.auth.onAuthStateChange(async (event, session) => {
    state.session = session;
    if (session) { await ensureProfile(); await loadUserData(); }
    else { state.profile = null; state.myPicks = {}; state.myGroups = []; }
    onChange?.(event);
  });
}

/** HTML del área de sesión en la barra superior. */
export function authBarHtml() {
  const u = currentUser();
  if (!u) {
    return `<button id="btn-google" class="btn btn-primary btn-google">
      <span class="g">G</span> Iniciar sesión</button>`;
  }
  const name = esc(state.profile?.display_name || u.email || "Jugador");
  const avatar = state.profile?.avatar_url
    ? `<img class="avatar" src="${esc(state.profile.avatar_url)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="avatar avatar--fallback">${esc(name[0] || "?").toUpperCase()}</span>`;
  return `
    <div class="usermenu">
      <button id="btn-user" class="userbtn" aria-haspopup="true" aria-expanded="false">
        ${avatar}<span class="uname">${name}</span> ▾
      </button>
      <div id="usermenu-pop" class="usermenu-pop" hidden>
        <button class="menu-item" data-go="perfil">👤 Mi perfil</button>
        <button class="menu-item" data-go="miquiniela">📝 Mi quiniela</button>
        <button class="menu-item" data-go="misgrupos">👥 Mis grupos</button>
        <button class="menu-item" id="btn-signout">🚪 Cerrar sesión</button>
      </div>
    </div>`;
}

/** Conecta los eventos del área de sesión. `go(view)` cambia de vista. */
export function wireAuthBar(go) {
  const gbtn = document.getElementById("btn-google");
  if (gbtn) gbtn.onclick = signInWithGoogle;

  const ubtn = document.getElementById("btn-user");
  const pop = document.getElementById("usermenu-pop");
  if (ubtn && pop) {
    ubtn.onclick = (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      pop.hidden = !open;
      ubtn.setAttribute("aria-expanded", String(open));
    };
    document.addEventListener("click", () => { pop.hidden = true; }, { once: true });
    pop.querySelectorAll("[data-go]").forEach((b) => {
      b.onclick = () => { pop.hidden = true; go?.(b.dataset.go); };
    });
    const so = document.getElementById("btn-signout");
    if (so) so.onclick = signOut;
  }
}

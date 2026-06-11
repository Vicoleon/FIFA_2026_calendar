// ============================================================
//  Cliente Supabase compartido + utilidades de conexión.
//  (supabase-js se carga por CDN como window.supabase antes de este módulo)
// ============================================================
const cfg = window.APP_CONFIG;
export const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

/** URL base del sitio (para links de invitación / share). Funciona en cualquier host. */
export function siteUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

/** Llama una función RPC; lanza Error con mensaje legible si falla. */
export async function rpc(name, args = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message || `RPC ${name} falló`);
  return data;
}

/** Invoca una Edge Function (requiere sesión válida). */
export async function invokeFn(name, body) {
  const { data, error } = await db.functions.invoke(name, { body });
  if (error) throw new Error(error.message || `Función ${name} falló`);
  return data;
}

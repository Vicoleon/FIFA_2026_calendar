// ============================================================
//  Edge Function: send-email
//  --------------------------------------------------------
//  Envía invitaciones a grupos por correo (Resend).
//  La invoca un usuario autenticado desde el front:
//      invokeFn('send-email', { type:'invite', to, group_id })
//
//  Seguridad (verify_jwt = true, ver supabase/config.toml):
//   - Exige sesión válida (Authorization: Bearer <jwt>).
//   - Verifica que el invitante PERTENECE al grupo creando la
//     invitación con el cliente del usuario (RPC create_invite,
//     que aplica is_group_member). No se confía en ningún 'link'
//     del cliente: el token y el enlace se construyen en el servidor.
//   - Valida el formato del email del destinatario.
//
//  Variables de entorno:
//   - RESEND_API_KEY (obligatoria)
//   - SITE_URL       (opcional; si falta se usa el header Origin)
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM = "Quiniela Mundial 2026 <onboarding@resend.dev>"; // cambia al verificar tu dominio
const BRAND = "Quiniela Mundial 2026";
const FOOTER_URL = "https://www.rubik-soft.com";
const FOOTER_TEXT = "Desarrollado por www.rubik-soft.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function inviteHtml(groupName: string, link: string): string {
  const safeLink = esc(link);
  const safeGroup = esc(groupName || "una quiniela");
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#7c3aed);padding:28px 32px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">⚽ ${esc(BRAND)}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 12px;font-size:18px;font-weight:700;">¡Te invitaron a "${safeGroup}"!</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444;">
            Únete a la quiniela del Mundial 2026, pronostica los marcadores y compite por la cima de la tabla.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td align="center" style="border-radius:10px;background:#0d9488;">
              <a href="${safeLink}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#fff;text-decoration:none;border-radius:10px;">Unirme a la quiniela</a>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#888;">
            Si el botón no funciona, copia este enlace:<br>
            <a href="${safeLink}" target="_blank" style="color:#0d9488;word-break:break-all;">${safeLink}</a>
          </p>
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid #eee;text-align:center;">
          <a href="${esc(FOOTER_URL)}" target="_blank" style="font-size:12px;color:#7c3aed;text-decoration:none;">${esc(FOOTER_TEXT)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "Falta RESEND_API_KEY en los secretos de la función." }, 500);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json({ error: "No autorizado." }, 401);

  // Cliente con el JWT del usuario -> RLS y auth.uid() aplican como ese usuario.
  const userClient = createClient(supabaseUrl!, anonKey!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sesión inválida." }, 401);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }

  const to = String(payload.to ?? "").trim();
  const groupId = String(payload.group_id ?? "").trim();
  if (!EMAIL_RE.test(to) || /[\r\n,]/.test(to)) return json({ error: "Email destinatario inválido." }, 400);
  if (!groupId) return json({ error: "Falta group_id." }, 400);

  // Crea la invitación COMO el usuario: create_invite valida is_group_member.
  const { data: token, error: invErr } = await userClient.rpc("create_invite", {
    p_group: groupId, p_email: to,
  });
  if (invErr || !token) return json({ error: invErr?.message || "No autorizado para invitar a este grupo." }, 403);

  // Nombre del grupo (para el cuerpo); RLS permite leerlo a un miembro.
  const { data: g } = await userClient.from("groups").select("name").eq("id", groupId).single();

  // Link construido en el servidor (SITE_URL o el Origin del navegador), nunca del body.
  const origin = (Deno.env.get("SITE_URL") || req.headers.get("Origin") || "").replace(/\/$/, "");
  if (!origin) return json({ error: "Configura SITE_URL en los secretos para construir el enlace." }, 500);
  const link = `${origin}/?invite=${token}`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject: `Te invitaron a ${g?.name || BRAND}`, html: inviteHtml(g?.name, link) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: `No se pudo enviar: ${data?.message || res.status}` }, 502);
    return json({ ok: true, id: data?.id ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "desconocido";
    return json({ error: `Fallo al contactar el proveedor de correo: ${msg}` }, 502);
  }
});

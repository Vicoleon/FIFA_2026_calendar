# Puesta en marcha — FIFA Calendario 2026

La app es **100% estática** (HTML/CSS/JS) + **Supabase**. La base de datos ya está
migrada y lista (proyecto `ozdjeotbfxnbisyedioq`). Solo faltan 3 pasos manuales que
**no se pueden automatizar** porque requieren credenciales tuyas.

---

## 1. Activar Google Sign-In (obligatorio para jugar)

1. **Google Cloud Console** → *APIs & Services → Credentials → Create credentials →
   OAuth client ID → Web application*.
2. En **Authorized redirect URIs** agrega la callback de Supabase:
   ```
   https://ozdjeotbfxnbisyedioq.supabase.co/auth/v1/callback
   ```
3. Copia el **Client ID** y **Client Secret**.
4. En **Supabase → Authentication → Providers → Google**: pégalos y activa el proveedor.
5. En **Supabase → Authentication → URL Configuration**:
   - **Site URL**: la URL pública del front (ej. `https://<usuario>.github.io/FIFA_2026_calendar/`
     o tu dominio / `http://localhost:8080` para pruebas).
   - **Redirect URLs**: agrega esa misma URL (y `http://localhost:8080` si pruebas local).

> Sin esto, el botón "Iniciar sesión" no completará el login.

## 2. Correo (invitaciones, recordatorios, resumen) — opcional al inicio

Todo funciona sin correo **excepto** enviar invitaciones por email y los recordatorios/resumen.

1. Crea cuenta gratuita en **[Resend](https://resend.com)** y genera un **API Key**.
2. **Supabase → Edge Functions → Secrets** (o `supabase secrets set`):
   - `RESEND_API_KEY = re_xxxxxxxx`
   - `CRON_SECRET = <una cadena larga aleatoria>`
   - `SITE_URL = https://tu-sitio`
3. (Opcional) Verifica tu dominio en Resend y cambia el remitente `from` en
   `supabase/functions/send-email/index.ts` (por defecto usa `onboarding@resend.dev`).

## 3. Programar tareas automáticas (recordatorio diario, resumen, auto-pick)

Una vez desplegadas las funciones y configurado `CRON_SECRET`:
- Abre `supabase/migrations/0008_cron.sql`, reemplaza `<CRON_SECRET>` por el mismo valor,
  y ejecútalo en el **SQL Editor** de Supabase.

---

## Desplegar el front

Es estático: cualquier host sirve.

```bash
# Local
python3 -m http.server 8080      # abre http://localhost:8080
```

**GitHub Pages:** Settings → Pages → Deploy from branch → `main` / root.

> Recuerda que la URL pública debe coincidir con la **Site URL / Redirect URLs** del paso 1.

---

## Edge Functions (ya escritas en `supabase/functions/`)

| Función | Para qué | Disparador |
|---|---|---|
| `send-email` | invitaciones por correo | la llama el front (usuario autenticado) |
| `daily-reminder` | aviso de partidos por pronosticar | pg_cron diario |
| `weekly-digest` | resumen semanal por jugador | pg_cron lunes |
| `auto-pick` | rellena picks faltantes con el modelo (opt-in) | pg_cron cada 15 min |

Despliegue (lo hace el asistente vía MCP, o tú con la CLI):
```bash
supabase functions deploy send-email
supabase functions deploy daily-reminder
supabase functions deploy weekly-digest
supabase functions deploy auto-pick
```

---

## Editores (cargar resultados reales)

El "Modo edición" lo pueden usar solo los correos en `public.is_editor()` **y** en
`assets/js/config.js → EDITOR_EMAILS`. Para añadir editores, edita ambos
(la seguridad real vive en la función `is_editor()` de la base de datos):

```sql
create or replace function public.is_editor()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'email','') = any (array[
    'joseleonsalgado@gmail.com',
    'otro-editor@ejemplo.com'
  ]);
$$;
```

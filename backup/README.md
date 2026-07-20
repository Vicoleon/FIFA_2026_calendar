# 📦 Respaldo final — Mundial 2026

Instantánea tomada el **2026-07-20**, justo antes de dar de baja la
infraestructura (Supabase + hosting) al terminar el Mundial.

El sitio es estático, así que **el repo sigue siendo el sitio**. Lo que se
apagó fue el backend: la base de datos, las Edge Functions y los cron.

---

## Qué hay aquí

| Ruta | Contenido |
|------|-----------|
| `backup/data/*.json` | Datos del torneo, tal cual salieron de la base |
| `../supabase/live_schema.sql` | Esquema **vivo** completo al momento del apagado |
| `../supabase/migrations/*.sql` | Migraciones históricas (ya estaban versionadas) |
| `../supabase/functions/*/index.ts` | Las 8 Edge Functions, incluidas 3 que **solo vivían en Supabase** |
| `../supabase/cron_jobs.sql` | Los 5 cron de `pg_cron` (secretos redactados) |

### Datos incluidos (`backup/data/`)

| Archivo | Filas |
|---------|------:|
| `teams.json` | 48 |
| `matches.json` | 104 |
| `match_stats.json` | 208 |
| `goals.json` | 308 |
| `predictions.json` | 104 |
| `achievements.json` | 5 |
| `user_achievements.json` | 42 |

Estas siete tablas tenían política `for select to public using (true)`: ya eran
legibles por cualquiera con la clave publishable. Versionarlas **no cambia su
nivel de exposición**.

---

## ⚠️ Lo que NO está en este repo (a propósito)

Cinco tablas estaban protegidas por RLS y contienen datos personales de los
participantes (nombres, correos, pronósticos individuales, códigos de grupo):

`profiles` · `picks` · `groups` · `group_members` · `invites`

Este repositorio es **público**. Publicarlas aquí expondría datos de terceros
que nunca fueron públicos. Por eso viven **solo en local**, fuera del repo:

```
~/Documents/Mirror/Mirror/development/FIFA_2026_calendar_backup_2026-07-20/data-private/
```

Ese directorio incluye `picks.json` y `picks.csv` (790 pronósticos, los 10
jugadores) — el registro completo de la quiniela. **No lo muevas dentro del
repo.** Si algún día quieres publicar la tabla de posiciones, exporta una
versión con los nombres seudonimizados.

---

## Cómo restaurar

```bash
# 1. proyecto nuevo de Supabase
psql "$DATABASE_URL" -f supabase/live_schema.sql

# 2. datos públicos
#    (cada .json es un array; súbelo con PostgREST o \copy vía jq -> csv)

# 3. datos privados desde el respaldo local
#    ojo con el orden: profiles -> groups -> group_members -> picks

# 4. funciones y cron
supabase functions deploy sync-espn site   # etc.
psql "$DATABASE_URL" -f supabase/cron_jobs.sql   # sustituye <CRON_SECRET> y <PROJECT_REF>
```

Los secretos de las funciones (`FOOTBALL_DATA_TOKEN`, `RESEND_API_KEY`,
`CRON_SECRET`, …) **no** están respaldados: hay que volver a crearlos.

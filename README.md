# ⚽ Mundial 2026 — Calendario, Resultados y Pronósticos

Aplicación web del **Mundial FIFA 2026** (Canadá · México · Estados Unidos) con:

- 📅 **Calendario completo** — 104 partidos: 72 de fase de grupos (12 grupos A–L, 48 equipos) + el cuadro de eliminatorias de dieciseisavos a la final, según el sorteo oficial.
- ✍️ **Resultados editables en línea** — inicias sesión como editor y cargas marcadores; los cambios se guardan en **Supabase** y se ven **en vivo** en cualquier dispositivo (Realtime).
- 📊 **Estadísticas por partido** — posesión, tiros, córners, faltas, tarjetas, goleadores… guardadas en base de datos. Cada partido terminado muestra su tarjeta de estadísticas.
- 🔮 **Pronósticos automáticos** — un motor **Elo + Poisson** calcula probabilidades de victoria/empate/derrota y el marcador más probable, y **se reajusta solo** conforme cargas resultados reales.

Es un sitio **100% estático** (HTML/CSS/JS sin compilación) + backend Supabase. Se puede abrir directo o publicar gratis en GitHub Pages, Netlify, Render, etc.

---

## 🚀 Cómo correrlo

### Local
```bash
# desde la carpeta del proyecto
python3 -m http.server 8080
# abre http://localhost:8080
```
(o simplemente abre `index.html` en el navegador).

### Publicar en GitHub Pages
1. Sube el repo a GitHub (rama `main`).
2. *Settings → Pages → Source: Deploy from a branch → `main` / root.*
3. Tu sitio quedará en `https://<usuario>.github.io/FIFA_2026_calendar/`.

No hay que configurar nada más: las credenciales públicas de Supabase ya están en `assets/js/config.js`.

---

## 🔐 Modo edición (cargar resultados)

1. Clic en **🔒 Modo edición** → escribe tu **correo y contraseña** (sin correos de verificación).
   - Editor por defecto: `joseleonsalgado@gmail.com` · contraseña inicial: `Mundial2026!`
2. Aparece **✏️ Editar** en cada tarjeta: marcador, estado (programado/en vivo/finalizado) y estadísticas por equipo.
3. Botón **♻️ Recalcular** guarda una instantánea de los pronósticos en la base.

> 🔑 **Cambiar la contraseña** (recomendado): Supabase → SQL Editor:
> ```sql
> update auth.users set encrypted_password = crypt('TU_NUEVA_CLAVE', gen_salt('bf'))
> where email = 'joseleonsalgado@gmail.com';
> ```

La edición está protegida por **Row Level Security**: cualquiera puede *ver*, pero sólo los correos autorizados pueden *escribir*.

**Autorizar más editores:** en Supabase → SQL Editor:
```sql
create or replace function public.is_editor()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'email','') = any (array[
    'joseleonsalgado@gmail.com',
    'otro-correo@ejemplo.com'
  ]);
$$;
```

---

## 🧠 Cómo funciona el pronóstico

`assets/js/predictor.js`

1. Cada selección tiene un **rating Elo** inicial (columna `teams.elo`, editable).
2. Al cargar resultados, los ratings se **recalculan en memoria** replicando los partidos terminados (Elo de fútbol con multiplicador por diferencia de goles). La semilla en la BD no se sobrescribe → el cálculo es determinista.
   - 🏆 **El desempeño dentro del Mundial pesa ×2** (`TOURNAMENT_WEIGHT`): cada resultado del torneo mueve el rating el doble, así que una selección que rinde por encima de lo esperado (efecto *"Costa Rica 2014"*) sube rápido y eso **domina el pronóstico de sus siguientes partidos**. Súbelo a 3–4 para que la forma del torneo pese aún más.
3. Para cada partido pendiente se derivan los **goles esperados (λ)** de cada lado a partir de la diferencia de Elo (+ ventaja de anfitrión) y se construye una **matriz de Poisson** → probabilidades de 1/X/2 y marcador más probable.
4. 📈 **Análisis multivariable** (`assets/js/analytics.js`): si un partido tiene estadísticas (tiros, tiros a puerta, posesión, córners, faltas, tarjetas…), se calcula un **xG aproximado** y un **índice de dominio**, y el rating se ajusta por **merecimiento** y no solo por el marcador (un equipo que domina pero empata igual sube). Peso configurable con `PERF_BLEND`.

La vista **Eliminatorias** se dibuja como un **árbol** que converge desde ambos lados hacia la Final en el centro 🏆.

Parámetros ajustables en `assets/js/config.js` (`PREDICTOR`).

---

## 🔴 Marcadores en vivo (automáticos) — ESPN, gratis

Cuando un partido está en curso, la app trae el **marcador y el minuto** desde la
**API pública no oficial de ESPN** (gratis, sin llave) y los muestra solos
(tarjeta "● EN VIVO"), sincronizados en todos los dispositivos. Misma fuente que
las estadísticas: ESPN cubre **todo** (marcador + stats + goleadores).

Arquitectura: la Edge Function `sync-espn` tiene un **modo rápido** `?mode=scores`
que consulta **solo** el `scoreboard` de ESPN (marcador/minuto/estado), mapea los
equipos y actualiza la tabla `matches`. Realtime refresca la UI en todos lados.

- **Automatización (sin navegador abierto):** un cron en Supabase (`pg_cron`)
  ejecuta `sync-espn?mode=scores` **cada minuto** (`sync-espn-scores`, `* * * * *`).
  La función tiene un *guard de ventana en vivo*: si no hay ningún partido activo
  (arranque en [-3 h, +20 min] y sin finalizar) **no llama a ESPN**, así que correrlo
  cada minuto es barato. ESPN actualiza el marcador casi en tiempo real.
- **Nudge al abrir:** el frontend además llama `sync-espn` (modo `scores`) cada 60 s
  mientras la página está abierta, solo para que el primer dato aparezca al instante.
- **Probar el mapeo** sin esperar a un partido (no escribe nada):
  `…/functions/v1/sync-espn?mode=scores&debug=1`

## 📊 Estadísticas automáticas (ESPN) — gratis

Las estadísticas detalladas (posesión, tiros, tiros a puerta, córners, faltas,
tarjetas) **y los goleadores** se obtienen de la **API pública no oficial de ESPN**
(gratis, sin llave), vía la Edge Function `sync-espn`, que las escribe en
`match_stats` y `goals`. Luego el modelo recalcula solo (análisis multivariable).

- **Automatización:** un cron en Supabase (`pg_cron`) ejecuta `sync-espn` **cada hora**
  (`sync-espn-hourly`, `0 * * * *`), así los stats de cada partido entran en ≤1 h de terminar.
  Cambia la frecuencia en SQL, p. ej. cada 4 h: `cron.schedule('sync-espn-hourly', '0 */4 * * *', …)`.
- **Validar manualmente** (sin escribir nada), usando el `eventId` de un partido en ESPN:
  `…/functions/v1/sync-espn?league=fifa.world&event=<ID>`
- ⚠️ Es una API **no oficial** (sin soporte ni SLA): puede cambiar. Para uso personal
  es práctica y gratuita. Alternativa "de verdad" con más detalle (xG real): FBref/Opta (de pago).

> Fuente única: **ESPN** cubre **todo** gratis vía `sync-espn` — el marcador en vivo
> (`?mode=scores`, cron cada minuto) y las **estadísticas + goleadores** (modo completo,
> cron cada hora). Ya no se usa football-data.org. *(La función `live-scores` sigue
> desplegada pero en desuso; el frontend dejó de llamarla.)*

## 🗂️ Estructura

```
index.html                 # shell de la app y vistas (Grupos / Eliminatorias / Calendario)
assets/css/styles.css       # estilos
assets/js/config.js         # URL + clave pública de Supabase y parámetros del modelo
assets/js/predictor.js      # motor Elo + Poisson
assets/js/standings.js      # tablas de grupos + resolución del cuadro (1E, 2A, W74, mejores 3.º)
assets/js/app.js            # carga de datos, render, editor, auth y realtime
supabase/schema.sql         # respaldo del esquema de base de datos
```

## 🗄️ Modelo de datos (Supabase)

| Tabla | Para qué |
|-------|----------|
| `teams` | 48 selecciones: grupo, posición, bandera, Elo |
| `matches` | 104 partidos: fase, sede, fecha, marcador, placeholders del cuadro |
| `match_stats` | estadísticas por equipo y partido |
| `goals` | goleadores (jugador, minuto) |
| `predictions` | instantánea de pronósticos guardados |

---

## ⚠️ Notas

- Los equipos, grupos y el **calendario oficial completo de la fase de grupos** (72 partidos con sede, fecha y hora local) corresponden al sorteo final del Mundial 2026; el **cuadro de eliminatorias** (sedes y fechas) sigue el calendario oficial. Todo es **editable en línea** por si la FIFA ajusta algún horario.
- La resolución de los "mejores terceros" usa una heurística por puntos/diferencia de gol; puedes corregir cualquier cruce manualmente desde el editor.
- Las claves de Supabase incluidas son **públicas por diseño** (publishable/anon). La seguridad real vive en las políticas RLS de la base.

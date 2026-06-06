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
3. Para cada partido pendiente se derivan los **goles esperados (λ)** de cada lado a partir de la diferencia de Elo (+ ventaja de anfitrión) y se construye una **matriz de Poisson** → probabilidades de 1/X/2 y marcador más probable.

Parámetros ajustables en `assets/js/config.js` (`PREDICTOR`).

---

## 🔴 Datos en vivo (automáticos)

Cuando un partido está en curso, la app trae el marcador (y el minuto) desde
**football-data.org** y los muestra solos (tarjeta "● EN VIVO"), sincronizados en
todos los dispositivos.

Arquitectura: el frontend NO llama a la API externa directamente (sería inseguro y
la bloquea CORS). En su lugar llama cada 60 s a una **Supabase Edge Function**
(`live-scores`) que actúa de proxy: lee el token desde un secreto, consulta la API,
mapea los equipos y actualiza la tabla `matches`. Realtime hace el resto.

> ⚠️ **Importante sobre el plan de football-data.org:**
> - El plan **Free (€0)** entrega los marcadores **con retraso** (no en tiempo real):
>   los partidos se actualizan solos pero con demora, no minuto a minuto.
> - Para marcadores **realmente en vivo** necesitas el plan **"Free w/ Livescores" (€12/mes)**.
>   El código es idéntico: solo cambias de plan con el mismo token, sin tocar nada.

**Configurar (una vez):**
1. Token en https://www.football-data.org/client/register
2. Supabase → tu proyecto → **Edge Functions → Secrets** → nuevo secreto:
   - Nombre: `FOOTBALL_DATA_TOKEN` · Valor: tu token
3. ¡Listo! Fuera de horario de partidos la función sale barato (no gasta cuota).

Probar el mapeo sin esperar a un partido: abre en el navegador
`https://<tu-proyecto>.supabase.co/functions/v1/live-scores?debug=1`
(devuelve el JSON de los partidos que reconoce, sin escribir nada).

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

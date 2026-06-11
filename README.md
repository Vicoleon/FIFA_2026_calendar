# ⚽ Quiniela Mundial 2026

App web del **Mundial FIFA 2026** (Canadá · México · Estados Unidos) convertida en
una **quiniela social**: pronostica los marcadores, compite con tus amigos en grupos,
sube en la tabla de posiciones y gana.

**100% estática** (HTML/CSS/JS sin build) + **Supabase** (Postgres, Auth, Realtime,
Edge Functions, pg_cron). Sin servidor propio.

> Desarrollado por **[www.rubik-soft.com](https://www.rubik-soft.com)**

---

## ✨ Qué hace

**Base (calendario, intacto):**
- 📅 Calendario completo — 104 partidos (72 de grupos + cuadro de eliminatorias).
- ✍️ Resultados editables en línea (editores autorizados) con estadísticas por partido.
- 🔮 Pronóstico de la casa **Elo + Poisson** que se reajusta solo.

**Quiniela (nuevo):**
- 🔐 **Inicio de sesión con Google.**
- 📝 **Pronósticos por partido** (marcador exacto). Se bloquean al iniciar cada partido.
- 🎯 **Puntaje** — marcador exacto = **3 pts**, resultado acertado = **1 pt**.
- ★ **Joker / Doble** — un partido por jornada con puntos dobles.
- 👥 **Grupos privados** — crea, comparte por **link** o **código**, invita por **email**.
- 🏆 **Tabla de posiciones** global y por grupo, **en vivo**.
- 💰 **Bote** por grupo — registra buy-in y pagos, calcula el premio al líder (solo registro).
- 🧠 **Sabiduría de masas** + **cara a cara** con un rival (tras el cierre del partido).
- 🏅 **Logros** — Jornada Perfecta, En Racha, Mataguigantes, El Profeta, Pleno.
- ⏰ **Recordatorios** — banner in-app + correo diario; **resumen semanal** por correo.
- 🛟 **Auto-pick** opcional — rellena con el pronóstico de la casa si no juegas a tiempo.
- 📤 **Tarjetas compartibles** de tu posición/resultados (con link de invitación).

## 🚀 Correr

```bash
python3 -m http.server 8080   # http://localhost:8080
```
Publicación gratis en GitHub Pages / Netlify / Render (es estático).

## ⚙️ Configuración (3 pasos manuales)

Ver **[SETUP.md](SETUP.md)** — activar Google Sign-In, configurar Resend (correo) y
programar las tareas (pg_cron). La base de datos ya está migrada.

## 🗂️ Estructura

```
index.html
assets/css/styles.css
assets/js/
  config.js predictor.js standings.js     # base (clásicos)
  lib/{db,dom,state,teams}.js             # núcleo compartido (ES modules)
  app.js                                   # router + bootstrap
  auth.js calendar.js picks.js            # sesión, calendario, pronósticos
  leaderboard.js groups.js invites.js     # tabla, grupos, invitaciones
  crowd.js achievements.js share.js       # masas/h2h, logros, compartir
  reminders.js profile.js                 # recordatorio in-app, perfil
supabase/
  migrations/*.sql                         # esquema (aplicado en vivo)
  functions/{send-email,daily-reminder,weekly-digest,auto-pick}/
docs/superpowers/specs/                    # diseño aprobado
```

## 🔐 Seguridad

Row Level Security en todo: cada quien edita solo sus picks; los picks ajenos se ocultan
hasta el inicio del partido; el puntaje lo escribe solo el motor (security definer);
membresía e invitaciones vía RPCs con token. La clave anónima de Supabase es pública
por diseño; ningún secreto vive en el front.

## 🧠 Puntaje (resumen)

Al marcar un partido como `finished`, un trigger calcula los puntos de cada pick
(exacto = 3, resultado = 1, ×2 si era Joker) y evalúa logros. La tabla se actualiza
en vivo por Realtime.

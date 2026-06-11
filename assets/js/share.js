// ============================================================
//  Tarjetas compartibles (imagen PNG) de resultados / posición.
//  Dibuja un <canvas> con marca de la app + link de invitación
//  y firma "Desarrollado por www.rubik-soft.com".
//  Comparte vía Web Share (con archivo) o descarga + copia el link.
// ============================================================
import { siteUrl } from "./lib/db.js";
import { toast } from "./lib/dom.js";

// Lienzo cuadrado tipo "story" (ideal para redes sociales).
const SIZE = 1080;

// Paleta alineada con la estética de la app (navy + dorado).
const COLORS = {
  top: "#1a2649",
  mid: "#141b33",
  bottom: "#0b1020",
  text: "#eaf0ff",
  muted: "#95a2c9",
  accent: "#f4c84a",   // dorado (acento de marca)
  line: "#2c3868"
};

/**
 * Acciones enrutadas por el delegado global (data-act).
 * Botón de ejemplo:
 *   <button class="btn btn-sm" data-act="share-card"
 *           data-title="Jose" data-big="#3 · 24 pts"
 *           data-subtitle="Quiniela de amigos" data-link="https://...">
 *     Compartir
 *   </button>
 */
export const actions = {
  "share-card": (btn) => shareResultCard({
    title: btn.dataset.title,
    subtitle: btn.dataset.subtitle,
    big: btn.dataset.big,
    link: btn.dataset.link
  })
};

/**
 * Genera la tarjeta compartible y la comparte o descarga.
 * @param {{title?:string, subtitle?:string, big?:string, link?:string}} opts
 */
export async function shareResultCard(opts = {}) {
  try {
    const cfg = window.APP_CONFIG || {};
    const appName = cfg.APP_NAME || "Quiniela Mundial 2026";
    const rubikUrl = cfg.RUBIK_URL || "https://www.rubik-soft.com";
    const link = (opts.link || siteUrl() || "").trim();

    // 1) Dibujar la tarjeta en un canvas.
    const canvas = drawCard({
      title: opts.title || "",
      subtitle: opts.subtitle || "",
      big: opts.big || "",
      link,
      appName,
      rubikUrl
    });

    // 2) Pasar a blob PNG.
    const blob = await canvasToBlob(canvas);
    if (!blob) { toast("No se pudo generar la imagen", "error"); return; }

    const fileName = "quiniela-mundial-2026.png";
    const file = new File([blob], fileName, { type: "image/png" });
    const shareText = buildShareText(opts, appName);

    // 3) Compartir con archivo si el navegador lo soporta (móvil).
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: shareText, url: link || undefined });
        return; // compartido con éxito
      } catch (err) {
        // El usuario canceló el diálogo: no es un error real.
        if (err && err.name === "AbortError") return;
        // Si falla por otra razón, caemos al plan B (descarga).
      }
    }

    // 4) Plan B: descargar el PNG y copiar el link al portapapeles.
    downloadBlob(blob, fileName);
    const copied = await copyToClipboard(link);
    toast(
      copied ? "Imagen descargada · link copiado ✓" : "Imagen descargada ✓",
      "success"
    );
  } catch (err) {
    toast("No se pudo compartir: " + (err?.message || "error"), "error");
  }
}

// ── Dibujo del canvas ───────────────────────────────────────

/** Construye y devuelve el <canvas> ya dibujado. */
function drawCard({ title, subtitle, big, link, appName, rubikUrl }) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  drawBackground(ctx);
  drawBorder(ctx);

  ctx.textAlign = "center";
  const cx = SIZE / 2;

  // Emoji de balón como sello superior.
  ctx.font = "120px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
  ctx.fillText("⚽", cx, 230);

  // Título (p.ej. nombre del jugador).
  if (title) {
    ctx.fillStyle = COLORS.text;
    ctx.font = "600 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(truncate(ctx, title, SIZE - 160), cx, 360);
  }

  // Dato grande (p.ej. "#3 · 24 pts") con acento dorado.
  if (big) {
    ctx.fillStyle = COLORS.accent;
    ctx.font = "800 130px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(truncate(ctx, big, SIZE - 120), cx, 540);
  }

  // Subtítulo (p.ej. nombre del grupo / mensaje).
  if (subtitle) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = "400 46px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(truncate(ctx, subtitle, SIZE - 160), cx, 630);
  }

  // Nombre de la app.
  ctx.fillStyle = COLORS.text;
  ctx.font = "700 56px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(truncate(ctx, appName, SIZE - 120), cx, 800);

  // Link de invitación (debajo del nombre).
  if (link) {
    ctx.fillStyle = COLORS.accent;
    ctx.font = "400 36px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(truncate(ctx, prettyLink(link), SIZE - 120), cx, 870);
  }

  // Firma de marca al pie.
  ctx.fillStyle = COLORS.muted;
  ctx.font = "400 32px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("Desarrollado por " + prettyLink(rubikUrl), cx, SIZE - 70);

  return canvas;
}

/** Fondo en degradado vertical (navy oscuro). */
function drawBackground(ctx) {
  const grad = ctx.createLinearGradient(0, 0, 0, SIZE);
  grad.addColorStop(0, COLORS.top);
  grad.addColorStop(0.55, COLORS.mid);
  grad.addColorStop(1, COLORS.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

/** Marco interior sutil para dar acabado de "tarjeta". */
function drawBorder(ctx) {
  const m = 36;
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 3;
  ctx.strokeRect(m, m, SIZE - m * 2, SIZE - m * 2);
}

// ── Utilidades ──────────────────────────────────────────────

/** Texto que acompaña a la imagen al compartir. */
function buildShareText(opts, appName) {
  const parts = [];
  if (opts.title) parts.push(opts.title);
  if (opts.big) parts.push(opts.big);
  parts.push(appName + " ⚽");
  return parts.join(" · ");
}

/** Quita el protocolo para mostrar el link más limpio. */
function prettyLink(url) {
  return String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** Recorta el texto con "…" si excede el ancho disponible en el canvas. */
function truncate(ctx, text, maxWidth) {
  let s = String(text || "");
  if (ctx.measureText(s).width <= maxWidth) return s;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

/** Convierte el canvas a Blob PNG (promisificado). */
function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob(resolve, "image/png");
    else resolve(null);
  });
}

/** Descarga un blob como archivo mediante un enlace temporal. */
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Libera la URL en el siguiente ciclo para no cortar la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copia texto al portapapeles; devuelve true si lo logró. */
async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Cae al método heredado si el portapapeles moderno falla.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

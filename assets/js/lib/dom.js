// ============================================================
//  Helpers de DOM y formato (módulo compartido)
// ============================================================

export const $  = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/** Escapa texto para interpolación segura en HTML. */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Formato de fecha/hora en español (MX). */
export function fmtDate(iso) {
  if (!iso) return "Por definir";
  return new Date(iso).toLocaleString("es-MX", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
  });
}

/** ¿Ya inició el partido? (kickoff en el pasado) */
export function hasKickedOff(match) {
  return !!(match?.kickoff && new Date(match.kickoff).getTime() <= Date.now());
}

/** Toast no bloqueante (reemplaza a alert() para feedback ligero). */
let toastTimer = null;
export function toast(msg, type = "info") {
  let host = $("#toast");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast";
    document.body.appendChild(host);
  }
  host.textContent = msg;
  host.className = `toast toast--${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove("show"), 3200);
}

/** Pide a la app recargar datos y re-renderizar la vista actual. */
export const refreshApp = () => document.dispatchEvent(new CustomEvent("quiniela:refresh"));

/** Navega a una vista por su clave (grupos, calendario, miquiniela, tabla, …). */
export const navigate = (view) =>
  document.dispatchEvent(new CustomEvent("quiniela:nav", { detail: { view } }));

/** Crea un elemento con atributos + hijos (mini hyperscript). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

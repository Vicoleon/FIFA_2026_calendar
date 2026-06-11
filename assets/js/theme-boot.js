// Aplica el tema guardado ANTES de pintar (evita parpadeo). Script clásico en <head>.
(function () {
  try {
    var t = localStorage.getItem("wc-theme");
    document.documentElement.dataset.theme =
      (t === "neon" || t === "fiesta" || t === "editorial") ? t : "neon";
  } catch (e) {
    document.documentElement.dataset.theme = "neon";
  }
})();

// ============================================================
//  Configuración pública de Supabase
//  (la clave "publishable" es segura para exponer en el cliente:
//   el acceso real está protegido por Row Level Security en la BD)
// ============================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://ozdjeotbfxnbisyedioq.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_lM3KGHcfhBiuNpWdSca-jw_xiJrJngY",

  APP_NAME: "FIFA Calendario 2026",
  RUBIK_URL: "https://www.rubik-soft.com",

  // Editores autorizados (debe coincidir con public.is_editor() en la BD).
  // Solo controla qué muestra la UI; la seguridad real vive en RLS.
  EDITOR_EMAILS: ["joseleonsalgado@gmail.com"],

  // Edge Function que envía correos (invitaciones). Se despliega en Supabase.
  EMAIL_FN: "send-email",

  // Parámetros del motor de pronóstico
  PREDICTOR: {
    HOME_ADV: 35,           // ventaja Elo para el equipo "local" (sedes casi neutrales)
    HOST_BONUS: 45,         // bonus extra si el local es anfitrión (MEX/USA/CAN)
    K_FACTOR: 40,           // peso de actualización Elo (Mundial = alto)
    TOURNAMENT_WEIGHT: 2,   // ⬅️ el desempeño DENTRO del Mundial pesa x2 en el rating
                            //    (sube a 3-4 si quieres que la forma del torneo domine aún más)
    PERF_BLEND: 0.35,       // análisis multivariable: cuánto pesa el "merecimiento" (xG/tiros/posesión)
                            //    vs el resultado puro al actualizar el rating (0 = solo marcador, 1 = solo stats)
    BASE_GOALS: 1.35,       // goles esperados base por equipo
    MAX_GOALS: 8            // tope de la matriz de Poisson
  },

  HOSTS: ["MEX", "USA", "CAN"]
};

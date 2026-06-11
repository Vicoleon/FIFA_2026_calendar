// ============================================================
//  Configuración pública de la app (segura para el cliente).
//  La clave "publishable" es anónima: el acceso real está
//  protegido por Row Level Security en Supabase.
// ============================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://ozdjeotbfxnbisyedioq.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_lM3KGHcfhBiuNpWdSca-jw_xiJrJngY",

  APP_NAME: "Quiniela Mundial 2026",
  RUBIK_URL: "https://www.rubik-soft.com",

  // Editores autorizados (debe coincidir con public.is_editor() en la BD).
  // Solo controla qué muestra la UI; la seguridad real vive en RLS.
  EDITOR_EMAILS: ["joseleonsalgado@gmail.com"],

  // Edge Function que envía correos (invitaciones). Se despliega en Supabase.
  EMAIL_FN: "send-email",

  // Parámetros del motor de pronóstico (modelo de la casa)
  PREDICTOR: {
    HOME_ADV: 35,      // ventaja Elo para el equipo "local" (sedes casi neutrales)
    HOST_BONUS: 45,    // bonus extra si el local es anfitrión (MEX/USA/CAN)
    K_FACTOR: 40,      // peso de actualización Elo (Mundial = alto)
    BASE_GOALS: 1.35,  // goles esperados base por equipo
    MAX_GOALS: 8       // tope de la matriz de Poisson
  },

  HOSTS: ["MEX", "USA", "CAN"]
};

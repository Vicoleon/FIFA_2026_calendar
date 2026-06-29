// ============================================================
//  Configuración pública de Supabase
//  (la clave "publishable" es segura para exponer en el cliente:
//   el acceso real está protegido por Row Level Security en la BD)
// ============================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://ozdjeotbfxnbisyedioq.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_lM3KGHcfhBiuNpWdSca-jw_xiJrJngY",

  // Parámetros del motor de pronóstico
  PREDICTOR: {
    HOME_ADV: 35,      // ventaja Elo para el equipo "local" (sedes casi neutrales)
    HOST_BONUS: 45,    // bonus extra si el local es anfitrión (MEX/USA/CAN)
    K_FACTOR: 40,      // peso de actualización Elo (Mundial = alto)
    BASE_GOALS: 1.35,  // goles esperados base por equipo
    MAX_GOALS: 8       // tope de la matriz de Poisson
  },

  HOSTS: ["MEX", "USA", "CAN"]
};

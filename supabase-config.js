/**
 * Stock Kiosco — Configuración de Supabase
 *
 * 1. Entrá a https://supabase.com → creá un proyecto (gratis).
 * 2. Andá a Project Settings → API.
 * 3. Copiá "Project URL" y "anon public key" acá abajo.
 *
 * Esta clave "anon" es pública (va en el navegador) y está bien que
 * lo esté: la seguridad real la da Row Level Security (RLS), que ya
 * está configurada en supabase/schema.sql — cada usuario solo puede
 * ver y modificar SUS propios productos.
 */
const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
const SUPABASE_ANON_KEY = "TU-ANON-KEY-ACA";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

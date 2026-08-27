/**
 * Vendify — Configuración de Supabase
 *
 * 1. Entrá a https://supabase.com → creá un proyecto (gratis).
 * 2. Andá a Project Settings → API.
 * 3. Copiá "Project URL" y "anon public key" acá abajo.
 *
 * Esta clave "anon" es pública (va en el navegador) y está bien que
 * lo esté: la seguridad real la da Row Level Security (RLS), que ya
 * está configurada con Row Level Security (RLS). En la v2 los datos
 * pertenecen al negocio (negocio_id) y los permisos se resuelven por rol.
 */
const SUPABASE_URL = "https://puhkmblnptntorwptvld.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1aGttYmxucHRudG9yd3B0dmxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MTcxMTEsImV4cCI6MjEwMzE5MzExMX0.k5zICWroYkhh3YCCspQpnAB0yXoFVrYo1JkcFQfP79o";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
const SUPABASE_URL = "https://vebqlbcfjxnpryjdgfvq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlYnFsYmNmanhucHJ5amRnZnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNDE0NzcsImV4cCI6MjEwMjgxNzQ3N30.Ck67I-M3uBGZBkOfou2bM5qbo3uURA4VOO_2dCsMT7M";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

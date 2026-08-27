/**
 * Vendify v2.4 — Login dual y empleados internos
 * Basado en Stock Kiosco v6 — Fase 2: multi-dispositivo en vivo
 * - Login por email + contraseña vía Supabase Auth
 * - Datos en Supabase Postgres (antes: localStorage)
 * - Realtime: los cambios se ven al instante en todos los dispositivos
 * - Venta / reposición atómica (sin pisar stock entre dispositivos)
 * - PWA instalable + onboarding (se mantienen igual que antes)
 */

const THEME_KEY = "kiosco_theme";
const ONBOARDING_KEY = "kiosco_onboarding_done";
const INSTALL_DISMISS_KEY = "kiosco_install_dismiss";
const MAX_IMG_SIZE = 400;


// ============================================================
// VENDIFY V2.3 - HELPERS LOGIN DUAL / EMPLEADOS
// ============================================================

const EMPLOYEE_DOMAIN = "employees.vendify.internal";

function normalizarLoginInterno(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function emailInternoEmpleado(codigoNegocio, username) {
  const code = normalizarLoginInterno(codigoNegocio);
  const user = normalizarLoginInterno(username);
  return `${code}.${user}@${EMPLOYEE_DOMAIN}`;
}

function generarPasswordTemporal() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const array = new Uint32Array(12);
  crypto.getRandomValues(array);
  return Array.from(array, (n) => chars[n % chars.length]).join("");
}

function mostrarPanelLogin(tipo) {
  const esOwner = tipo === "owner";

  $("#tab-owner")?.classList.toggle("active", esOwner);
  $("#tab-employee")?.classList.toggle("active", !esOwner);

  $("#auth-owner-panel")?.classList.toggle("hidden", !esOwner);
  $("#auth-employee-panel")?.classList.toggle("hidden", esOwner);

  $("#register-form")?.classList.add("hidden");
  $("#forgot-form")?.classList.add("hidden");
  $("#auth-message")?.classList.add("hidden");

  const loginError = $("#login-error");
  const employeeError = $("#employee-login-error");

  if (loginError) loginError.textContent = "";
  if (employeeError) employeeError.textContent = "";
}


let deferredInstallPrompt = null;
let sesionActual = null;
let realtimeChannel = null;

const CATEGORIAS_DEFAULT = [
  "Bebidas", "Golosinas", "Snacks", "Cigarrillos", "Lácteos",
  "Panadería", "Helados", "Limpieza", "Útiles", "Otros",
];

// =====================
// Productos de ejemplo
// =====================

// 🔴🔴🔴 INICIO DE LA MODIFICACIÓN 🔴🔴🔴

const ICONS_BASE_URL =
  "https://raw.githubusercontent.com/MatiasEzequielPereyra/Ventas-Kiosco-v1.0/main/icons/";

const PRODUCTOS_EJEMPLO = [
  {
    nombre: "Coca Cola 500ml",
    categoria: "Bebidas",
    precioCompra: 800,
    precioVenta: 1200,
    stock: 24,
    stockMinimo: 6
    // No existe imagen Coca Cola en tu carpeta icons
  },

  {
    nombre: "Sprite 500ml",
    categoria: "Bebidas",
    precioCompra: 750,
    precioVenta: 1100,
    stock: 18,
    stockMinimo: 6,
    foto: `${ICONS_BASE_URL}sprite.webp`
  },

  {
    nombre: "Agua Villavicencio 500ml",
    categoria: "Bebidas",
    precioCompra: 400,
    precioVenta: 700,
    stock: 30,
    stockMinimo: 8,
    foto: `${ICONS_BASE_URL}villavicencio.jpg`
  },

  {
    nombre: "Cerveza Quilmes 473ml",
    categoria: "Bebidas",
    precioCompra: 900,
    precioVenta: 1400,
    stock: 12,
    stockMinimo: 4,
    foto: `${ICONS_BASE_URL}quilmes.webp`
  },

  {
    nombre: "Alfajor Havanna",
    categoria: "Golosinas",
    precioCompra: 600,
    precioVenta: 1000,
    stock: 20,
    stockMinimo: 5,
    foto: `${ICONS_BASE_URL}alfajorhabana.jpg`
  },

  {
    nombre: "Chocolate Milka 55g",
    categoria: "Golosinas",
    precioCompra: 900,
    precioVenta: 1400,
    stock: 15,
    stockMinimo: 4,
    foto: `${ICONS_BASE_URL}milka.webp`
  },

  {
    nombre: "Caramelos Sugus x5",
    categoria: "Golosinas",
    precioCompra: 200,
    precioVenta: 400,
    stock: 40,
    stockMinimo: 10,
    foto: `${ICONS_BASE_URL}sugus.webp`
  },

  {
    nombre: "Chicles Beldent",
    categoria: "Golosinas",
    precioCompra: 350,
    precioVenta: 600,
    stock: 25,
    stockMinimo: 8,
    foto: `${ICONS_BASE_URL}beldent.webp`
  },

  {
    nombre: "Papas Lays Clásicas",
    categoria: "Snacks",
    precioCompra: 1100,
    precioVenta: 1700,
    stock: 10,
    stockMinimo: 4,
    foto: `${ICONS_BASE_URL} lays.webp`
  },

  {
    nombre: "Maní salado 100g",
    categoria: "Snacks",
    precioCompra: 500,
    precioVenta: 900,
    stock: 14,
    stockMinimo: 5,
    foto: `${ICONS_BASE_URL}mani.webp`
  },

  {
    nombre: "Palitos salados",
    categoria: "Snacks",
    precioCompra: 400,
    precioVenta: 700,
    stock: 3,
    stockMinimo: 5,
    foto: `${ICONS_BASE_URL}palitos.webp`
  },

  {
    nombre: "Marlboro Box 20",
    categoria: "Cigarrillos",
    precioCompra: 2800,
    precioVenta: 3500,
    stock: 8,
    stockMinimo: 3,
    foto: `${ICONS_BASE_URL}CIGARRILLOS%20MARLBORO%20BOX%2020.JPG`
  },

  {
    nombre: "Philip Morris 20",
    categoria: "Cigarrillos",
    precioCompra: 2500,
    precioVenta: 3200,
    stock: 2,
    stockMinimo: 3,
    foto: `${ICONS_BASE_URL}philips.png`
  },

  {
    nombre: "Yogur La Serenísima",
    categoria: "Lácteos",
    precioCompra: 500,
    precioVenta: 850,
    stock: 12,
    stockMinimo: 4,
    foto: `${ICONS_BASE_URL}yogur.jpg`
  },

  {
    nombre: "Leche larga vida 1L",
    categoria: "Lácteos",
    precioCompra: 900,
    precioVenta: 1300,
    stock: 10,
    stockMinimo: 4,
    foto: `${ICONS_BASE_URL}leche.webp`
  },

  {
    nombre: "Facturas x unitario",
    categoria: "Panadería",
    precioCompra: 300,
    precioVenta: 500,
    stock: 16,
    stockMinimo: 6,
    foto: `${ICONS_BASE_URL}facturas.webp`
  },

  {
    nombre: "Helado Frigor 1L",
    categoria: "Helados",
    precioCompra: 2500,
    precioVenta: 3800,
    stock: 6,
    stockMinimo: 2
    // No existe imagen de helado en tu carpeta icons
  },

  {
    nombre: "Servilletas x50",
    categoria: "Limpieza",
    precioCompra: 400,
    precioVenta: 700,
    stock: 8,
    stockMinimo: 3,
    foto: `${ICONS_BASE_URL}servilleta.webp`
  },

  {
    nombre: "Fósforos",
    categoria: "Útiles",
    precioCompra: 150,
    precioVenta: 300,
    stock: 20,
    stockMinimo: 5,
    foto: `${ICONS_BASE_URL}Fosforos-400.jpg`
  },

  {
    nombre: "Pilas AA x2",
    categoria: "Útiles",
    precioCompra: 800,
    precioVenta: 1300,
    stock: 1,
    stockMinimo: 3,
    foto: `${ICONS_BASE_URL}pilasd.webp`
  }
];

// 🔴🔴🔴 FIN DE LA MODIFICACIÓN 🔴🔴🔴

let productos = [];
let categorias = [];
let productoEditandoId = null;
let fotoActualBase64 = null;
let stockAjusteId = null;
let stockAjusteValor = 0;
let confirmCallback = null;
let filtroStockBajo = false;
let carrito = []; // [{id, nombre, precioVenta, stock, cantidad}]

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================================
// V2 — CONTEXTO SAAS / MULTIEMPRESA
// ============================================================
window.appContext = {
  user: null,
  business: null,
  membership: null,
  branch: null,
  cashRegister: null,
  permissions: {},
  employee: null,
  ready: false,
};

async function cargarContextoApp() {
  const { data, error } = await supabaseClient.rpc("obtener_contexto_app");

  if (error) {
    console.error("[V2] Error cargando contexto:", error);
    throw new Error(error.message || "No se pudo cargar el contexto del negocio");
  }

  window.appContext = {
    user: data?.user || null,
    business: data?.business || null,
    membership: data?.membership || null,
    branch: data?.branch || null,
    cashRegister: data?.cashRegister || null,
    permissions: data?.permissions || {},
    employee: null,
    ready: true,
  };

  // Si es un usuario interno, recuperamos nombre y username reales.
  const { data: employeeProfile, error: employeeProfileError } =
    await supabaseClient.rpc("obtener_perfil_empleado_actual");

  if (!employeeProfileError && employeeProfile) {
    appContext.employee = employeeProfile;
  }

  actualizarContextoUI();
  aplicarPermisosV2();

  console.info("[V2] Contexto cargado", window.appContext);
  return window.appContext;
}

function limpiarContextoApp() {
  window.appContext = {
    user: null,
    business: null,
    membership: null,
    branch: null,
    cashRegister: null,
    permissions: {},
    employee: null,
    ready: false,
  };
  document.body.removeAttribute("data-role");
  document.body.classList.remove("rol-cashier");
}

function tienePermisoV2(permiso) {
  return window.appContext?.permissions?.[permiso] === true;
}

function exigirPermisoV2(permiso, mensaje = "No tenés permiso para realizar esta acción") {
  if (tienePermisoV2(permiso)) return true;
  mostrarToast(mensaje, "error");
  return false;
}

function actualizarContextoUI() {
  const usuarioEl = $("#context-usuario");
  const rolEl = $("#context-rol");
  const sesionEl = $("#sesion-email");

  const perfilEmpleado = appContext.employee;
  const emailSesion = sesionActual?.user?.email || "";

  let nombreVisible;

  if (perfilEmpleado?.nombre) {
    nombreVisible = perfilEmpleado.nombre;
  } else {
    // Para propietarios/admins con email mostramos la parte anterior al @.
    nombreVisible =
      emailSesion && !emailSesion.endsWith("@employees.vendify.internal")
        ? emailSesion.split("@")[0]
        : appContext.business?.nombre || "Usuario";
  }

  if (usuarioEl) usuarioEl.textContent = nombreVisible;
  if (rolEl) rolEl.textContent = nombreRolV2(appContext.membership?.role);

  // Evitamos mostrar el email técnico de empleados.
  if (sesionEl) {
    sesionEl.textContent = perfilEmpleado?.username
      ? `@${perfilEmpleado.username}`
      : emailSesion;
  }
}

function nombreRolV2(rol) {
  const nombres = {
    owner: "Propietario",
    admin: "Administrador",
    manager: "Encargado",
    cashier: "Cajero",
  };
  return nombres[rol] || rol || "Usuario";
}

function aplicarPermisosV2() {
  if (!appContext.ready) return;

  const role = appContext.membership?.role || "cashier";

  const esOwner = role === "owner";
  const esAdmin = role === "admin";
  const esManager = role === "manager";
  const esCashier = role === "cashier";

  const puedeGestionarProductos = esOwner || esAdmin || esManager;
  const puedeAjustarStock = esOwner || esAdmin || esManager;
  const puedeConfigurar = esOwner || esAdmin || esManager;
  const puedeExportar = esOwner || esAdmin || esManager;
  const puedeVerHistorial = esOwner || esAdmin || esManager;

  // Equipo queda solamente para propietario y administrador.
  const puedeGestionarEquipo = esOwner || esAdmin;

  document.body.dataset.role = role;
  document.body.classList.toggle("rol-cashier", esCashier);

  const setHidden = (selector, hidden) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.hidden = hidden;
      el.classList.toggle("permiso-hidden", hidden);
    });
  };

  setHidden(
    "#btn-nuevo, #btn-empty-nuevo, #btn-cargar-ejemplos, #btn-cargar-ejemplos-config",
    !puedeGestionarProductos
  );

  setHidden("#btn-config", !puedeConfigurar);
  setHidden("#btn-equipo", !puedeGestionarEquipo);
  setHidden("#btn-export", !puedeExportar);
  setHidden("#btn-historial", !puedeVerHistorial);

  setHidden(".card-acciones", !puedeGestionarProductos);
  setHidden(".card-stock-controls", !puedeAjustarStock);

  // Los costos son información sensible para cajeros.
  document.body.classList.toggle("ocultar-costos", esCashier);

  // Si por cualquier motivo un cajero quedó con permissions antiguas
  // en memoria, el rol real sigue teniendo prioridad en la UI.
  if (esCashier) {
    document.querySelectorAll(
      '[data-action="editar"], [data-action="eliminar"], [data-action="sumar"], [data-action="restar"], [data-action="ajustar"]'
    ).forEach((el) => {
      el.hidden = true;
      el.classList.add("permiso-hidden");
    });
  }
}

async function listarSucursalesV2() {
  const { data, error } = await supabaseClient.rpc("listar_sucursales_app");
  if (error) throw new Error(error.message);
  return data || [];
}

async function cambiarSucursalV2(sucursalId) {
  const { data, error } = await supabaseClient.rpc("obtener_contexto_sucursal", {
    p_sucursal_id: sucursalId,
  });
  if (error) throw new Error(error.message);

  appContext.branch = data.branch;
  appContext.cashRegister = data.cashRegister;
  actualizarContextoUI();
  suscribirRealtime();
  return data;
}

async function registrarVentaV2(items, medioPago) {
  if (!exigirPermisoV2("sell", "Tu usuario no tiene permiso para registrar ventas")) return null;
  if (!appContext.ready) throw new Error("El contexto del negocio todavía no está cargado");

  const payload = (items || []).map((item) => ({
    producto_id: item.id || item.producto_id,
    cantidad: Number(item.cantidad),
  }));

  const { data, error } = await supabaseClient.rpc("registrar_venta_v2", {
    p_items: payload,
    p_medio_pago: medioPago || null,
    p_sucursal_id: appContext.branch.id,
    p_caja_id: appContext.cashRegister.id,
  });

  if (error) throw new Error(error.message || "No se pudo registrar la venta");
  return data;
}

async function ajustarStockV2(productoId, delta, tipo = "ajuste") {
  if (!exigirPermisoV2("adjustStock", "Tu usuario no tiene permiso para modificar stock")) return null;

  const { data, error } = await supabaseClient.rpc("ajustar_stock_v2", {
    p_producto_id: productoId,
    p_delta: Number(delta),
    p_tipo: tipo,
  });

  if (error) throw new Error(error.message || "No se pudo ajustar el stock");
  return data;
}

// =====================
// Autenticación Vendify — email + contraseña
// =====================
let flujoRecuperacionActivo = false;

function mostrarPanelAuth(panel) {
  const map = {
    "auth-login-panel": "owner",
    "auth-register-panel": "register",
    "auth-reset-panel": "forgot",
    "auth-new-password-panel": "new-password",
  };

  const target = map[panel] || panel;

  $("#auth-owner-panel")?.classList.toggle("hidden", target !== "owner");
  $("#auth-employee-panel")?.classList.toggle("hidden", target !== "employee");
  $("#register-form")?.classList.toggle("hidden", target !== "register");
  $("#forgot-form")?.classList.toggle("hidden", target !== "forgot");
  $("#new-password-form")?.classList.toggle("hidden", target !== "new-password");

  $("#tab-owner")?.classList.toggle("active", target === "owner");
  $("#tab-employee")?.classList.toggle("active", target === "employee");
  $("#auth-tabs-wrap")?.classList.toggle("hidden", !["owner", "employee"].includes(target));
  $("#auth-message")?.classList.add("hidden");

  ["#login-error", "#employee-login-error", "#register-error", "#forgot-error", "#new-password-error"].forEach((sel) => {
    const el = $(sel);
    if (el) el.textContent = "";
  });
}

function mostrarMensajeAuth(mensaje, tipo = "info") {
  const el = $("#auth-message");
  if (!el) return;
  el.className = `auth-message ${tipo}`;
  el.textContent = mensaje;
  el.classList.remove("hidden");
}

async function initAuth() {
  const { data } = await supabaseClient.auth.getSession();
  sesionActual = data.session;

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    sesionActual = session;

    if (event === "PASSWORD_RECOVERY") {
      flujoRecuperacionActivo = true;
      mostrarLogin();
      mostrarPanelAuth("auth-new-password-panel");
      return;
    }

    if (session && !flujoRecuperacionActivo) {
      await mostrarApp();
    } else if (!session) {
      mostrarLogin();
      if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
    }
  });

  if (sesionActual && !flujoRecuperacionActivo) await mostrarApp();
  else mostrarLogin();
}

function mostrarLogin() {
  $("#auth-screen")?.classList.remove("hidden");
  $(".app")?.classList.add("hidden");
  if (!flujoRecuperacionActivo) mostrarPanelAuth("owner");
}

async function mostrarApp() {
  $("#auth-screen")?.classList.add("hidden");
  $(".app")?.classList.remove("hidden");
  try {
    await cargarContextoApp();
  } catch (error) {
    console.error(error);
    mostrarToast("No se pudo cargar el negocio: " + error.message, "error");
    return;
  }

  await cargarCategorias();
  await cargarProductos();
  actualizarFiltroCategorias();
  renderGrid();
  aplicarPermisosV2();
  suscribirRealtime();
}

async function iniciarSesionPassword(e) {
  e.preventDefault();
  const email = $("#login-email")?.value.trim();
  const password = $("#login-password")?.value || "";
  const btn = $("#btn-login");
  const err = $("#login-error");
  if (!btn || !err) return;

  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Ingresando...";

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  btn.disabled = false;
  btn.textContent = "Iniciar sesión";

  if (error) {
    err.textContent = error.message === "Invalid login credentials"
      ? "Email o contraseña incorrectos."
      : error.message;
  }
}


async function loginEmpleado(e) {
  e.preventDefault();

  const code = $("#employee-business-code").value.trim();
  const username = $("#employee-username").value.trim();
  const password = $("#employee-password").value;
  const errorEl = $("#employee-login-error");
  const btn = $("#btn-employee-login");

  errorEl.textContent = "";

  const email = emailInternoEmpleado(code, username);

  btn.disabled = true;
  btn.textContent = "Ingresando...";

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  btn.disabled = false;
  btn.textContent = "Entrar a Vendify";

  if (error) {
    errorEl.textContent = "Código, usuario o contraseña incorrectos.";
  }
}

async function registrarCuenta(e) {
  e.preventDefault();
  const businessName = $("#register-business")?.value.trim();
  const email = $("#register-email")?.value.trim();
  const password = $("#register-password")?.value || "";
  const err = $("#register-error");
  const btn = $("#btn-register");
  if (!err || !btn) return;

  err.textContent = "";
  if (!businessName) { err.textContent = "Ingresá el nombre del negocio."; return; }
  if (password.length < 8) { err.textContent = "La contraseña debe tener al menos 8 caracteres."; return; }

  btn.disabled = true;
  btn.textContent = "Creando cuenta...";

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
      data: { business_name: businessName },
    },
  });

  btn.disabled = false;
  btn.textContent = "Crear cuenta";

  if (error) { err.textContent = error.message; return; }

  if (!data.session) {
    mostrarPanelAuth("owner");
    mostrarMensajeAuth("Cuenta creada. Revisá tu email una sola vez para confirmarla y después ingresá con tu contraseña.", "success");
  }
}

async function solicitarResetPassword(e) {
  e.preventDefault();
  const email = $("#forgot-email")?.value.trim();
  const btn = $("#btn-forgot-send");
  const err = $("#forgot-error");
  if (!btn || !err) return;

  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Enviando...";

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });

  btn.disabled = false;
  btn.textContent = "Enviar recuperación";

  if (error) { err.textContent = error.message; return; }
  mostrarPanelAuth("owner");
  mostrarMensajeAuth("Te enviamos un enlace para cambiar tu contraseña.", "success");
}

async function guardarNuevaPassword(e) {
  e.preventDefault();
  const password = $("#new-password")?.value || "";
  const confirm = $("#new-password-confirm")?.value || "";
  const err = $("#new-password-error");
  const btn = $("#btn-new-password");
  if (!err || !btn) return;

  err.textContent = "";
  if (password.length < 8) { err.textContent = "La contraseña debe tener al menos 8 caracteres."; return; }
  if (password !== confirm) { err.textContent = "Las contraseñas no coinciden."; return; }

  btn.disabled = true;
  btn.textContent = "Guardando...";
  const { error } = await supabaseClient.auth.updateUser({ password });
  btn.disabled = false;
  btn.textContent = "Guardar contraseña";

  if (error) { err.textContent = error.message; return; }

  flujoRecuperacionActivo = false;
  mostrarToast("Contraseña actualizada", "success");
  await mostrarApp();
}

function togglePassword(inputId, button) {
  const input = $("#" + inputId);
  if (!input) return;
  const mostrar = input.type === "password";
  input.type = mostrar ? "text" : "password";
  button.textContent = mostrar ? "🙈" : "👁";
  button.setAttribute("aria-label", mostrar ? "Ocultar contraseña" : "Mostrar contraseña");
}

async function cerrarSesion() {
  flujoRecuperacionActivo = false;
  limpiarContextoApp();
  await supabaseClient.auth.signOut();
}



// ============================================================
// V2.3 — EQUIPO / USUARIOS INTERNOS
// ============================================================

async function obtenerNegocioAdminV3() {
  const { data, error } = await supabaseClient.rpc("obtener_negocio_admin_actual");
  if (error) throw new Error(error.message);
  return data;
}

async function listarEquipoV3() {
  const { data, error } = await supabaseClient.rpc("listar_equipo_v3");
  if (error) throw new Error(error.message || "No se pudo cargar el equipo");
  return data || [];
}

async function abrirEquipo() {
  if (!exigirPermisoV2("manageEmployees", "No tenés permiso para administrar el equipo")) return;
  $("#modal-equipo")?.classList.remove("hidden");
  try {
    const negocio = await obtenerNegocioAdminV3();
    $("#equipo-business-code").textContent = negocio.codigo_acceso || "—";
  } catch (e) {
    mostrarToast(e.message, "error");
  }
  await renderEquipo();
}

function cerrarEquipo() {
  $("#modal-equipo")?.classList.add("hidden");
}

async function renderEquipo() {
  const lista = $("#equipo-lista");
  if (!lista) return;
  lista.innerHTML = `<p class="hint" style="text-align:center;padding:1rem;">Cargando equipo...</p>`;

  let personas;
  try {
    personas = await listarEquipoV3();
  } catch (error) {
    lista.innerHTML = "";
    mostrarToast(error.message, "error");
    return;
  }

  lista.innerHTML = personas.map((item) => {
    const esOwner = item.rol === "owner";
    const esYo = item.user_id === appContext.user?.id;
    const username = item.username
      ? `<span class="employee-username-badge">@${escapeHtml(item.username)}</span>`
      : `<span class="employee-username-badge">Email</span>`;

    const rolControl = esOwner
      ? `<span class="equipo-role-owner">Propietario</span>`
      : `
        <select class="select equipo-role-select" data-membership-id="${item.membership_id}" ${esYo ? "disabled" : ""}>
          <option value="cashier" ${item.rol === "cashier" ? "selected" : ""}>Cajero</option>
          <option value="manager" ${item.rol === "manager" ? "selected" : ""}>Encargado</option>
          <option value="admin" ${item.rol === "admin" ? "selected" : ""}>Administrador</option>
        </select>`;

    const acciones = (!esOwner && !esYo)
      ? `
         <button class="btn btn-ghost btn-sm"
                 data-equipo-action="edit-member"
                 data-id="${item.membership_id}"
                 data-nombre="${escapeHtml(item.nombre || "")}"
                 data-username="${escapeHtml(item.username || "")}"
                 data-rol="${item.rol}">
           Editar
         </button>
         <button class="btn btn-ghost btn-sm"
                 data-equipo-action="reset-password"
                 data-id="${item.membership_id}"
                 data-nombre="${escapeHtml(item.nombre || item.username || "Empleado")}">
           Reiniciar clave
         </button>
         <button class="btn ${item.activo ? "btn-ghost" : "btn-secondary"} btn-sm"
                 data-equipo-action="toggle-member"
                 data-id="${item.membership_id}"
                 data-activo="${item.activo ? "0" : "1"}">
            ${item.activo ? "Desactivar" : "Activar"}
         </button>`
      : "";

    return `
      <div class="equipo-item">
        <div class="equipo-persona">
          <div class="equipo-email">${escapeHtml(item.nombre || item.email || "Usuario")}${esYo ? " · Vos" : ""}</div>
          <div class="equipo-meta">
            ${username}
            <span class="equipo-status ${item.activo ? "active" : "inactive"}">${item.activo ? "Activo" : "Inactivo"}</span>
            ${item.debe_cambiar_password ? `<span class="equipo-status pending">Clave temporal</span>` : ""}
          </div>
        </div>
        <div>${rolControl}</div>
        <div class="equipo-actions">${acciones}</div>
      </div>`;
  }).join("");
}

async function crearEmpleadoV3(e) {
  e.preventDefault();

  if (!exigirPermisoV2("manageEmployees", "No tenés permiso para crear empleados")) return;

  const nombre = $("#equipo-nombre").value.trim();
  const username = normalizarLoginInterno($("#equipo-username").value);
  const rol = $("#equipo-rol").value;
  const password = $("#equipo-password").value;
  const errorEl = $("#equipo-error");
  const btn = $("#btn-crear-empleado");

  errorEl.textContent = "";

  btn.disabled = true;
  btn.textContent = "Creando...";

  const { data, error } = await supabaseClient.functions.invoke("crear-empleado", {
    body: { nombre, username, rol, password },
  });

  btn.disabled = false;
  btn.textContent = "Crear empleado";

  if (error || data?.error) {
    errorEl.textContent = data?.error || error?.message || "No se pudo crear el empleado";
    return;
  }

  $("#equipo-nombre").value = "";
  $("#equipo-username").value = "";
  $("#equipo-password").value = "";

  mostrarToast(`Empleado @${username} creado`, "success");
  await renderEquipo();
}

async function cambiarRolEquipo(membershipId, rol, selectEl) {
  selectEl.disabled = true;
  const { error } = await supabaseClient.rpc("actualizar_rol_miembro_v2", {
    p_membership_id: membershipId,
    p_rol: rol,
  });
  selectEl.disabled = false;

  if (error) {
    mostrarToast(error.message, "error");
    await renderEquipo();
    return;
  }
  mostrarToast(`Rol actualizado a ${nombreRolV2(rol)}`, "success");
}

async function cambiarEstadoEquipo(membershipId, activo) {
  const { error } = await supabaseClient.rpc("cambiar_estado_miembro_v3", {
    p_membership_id: membershipId,
    p_activo: activo,
  });
  if (error) {
    mostrarToast(error.message, "error");
    return;
  }
  mostrarToast(activo ? "Usuario activado" : "Usuario desactivado", "success");
  await renderEquipo();
}

async function cambiarPasswordEmpleadoV3(e) {
  e.preventDefault();

  const p1 = $("#employee-new-password").value;
  const p2 = $("#employee-new-password-repeat").value;
  const errorEl = $("#employee-password-error");
  errorEl.textContent = "";

  if (p1.length < 8) {
    errorEl.textContent = "La contraseña debe tener al menos 8 caracteres.";
    return;
  }
  if (p1 !== p2) {
    errorEl.textContent = "Las contraseñas no coinciden.";
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({ password: p1 });
  if (error) {
    errorEl.textContent = error.message;
    return;
  }

  const { error: rpcError } = await supabaseClient.rpc("marcar_password_empleado_cambiada");
  if (rpcError) {
    errorEl.textContent = rpcError.message;
    return;
  }

  if (appContext.employee) appContext.employee.debe_cambiar_password = false;
  $("#modal-password-empleado").classList.add("hidden");
  mostrarToast("Contraseña actualizada", "success");
}


function abrirEditarEmpleadoDesdeBoton(btn) {
  $("#editar-membership-id").value = btn.dataset.id || "";
  $("#editar-empleado-nombre").value = btn.dataset.nombre || "";
  $("#editar-empleado-username").value = btn.dataset.username || "";
  $("#editar-empleado-rol").value = btn.dataset.rol || "cashier";
  $("#editar-empleado-error").textContent = "";
  $("#modal-editar-empleado").classList.remove("hidden");
}

function cerrarEditarEmpleado() {
  $("#modal-editar-empleado")?.classList.add("hidden");
}

async function guardarEdicionEmpleado(e) {
  e.preventDefault();

  const membershipId = $("#editar-membership-id").value;
  const nombre = $("#editar-empleado-nombre").value.trim();
  const username = normalizarLoginInterno($("#editar-empleado-username").value);
  const rol = $("#editar-empleado-rol").value;
  const errorEl = $("#editar-empleado-error");
  const btn = $("#btn-guardar-editar-empleado");

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Guardando...";

  const { data, error } = await supabaseClient.functions.invoke("gestionar-empleado", {
    body: {
      action: "update",
      membership_id: membershipId,
      nombre,
      username,
      rol,
    },
  });

  btn.disabled = false;
  btn.textContent = "Guardar cambios";

  if (error || data?.error) {
    errorEl.textContent = data?.error || error?.message || "No se pudo actualizar";
    return;
  }

  cerrarEditarEmpleado();
  mostrarToast("Empleado actualizado", "success");
  await renderEquipo();
}

function abrirResetEmpleadoDesdeBoton(btn) {
  $("#reset-membership-id").value = btn.dataset.id || "";
  $("#reset-empleado-info").textContent =
    `Nueva contraseña temporal para ${btn.dataset.nombre || "el empleado"}.`;
  $("#reset-empleado-password").value = generarPasswordTemporal();
  $("#reset-empleado-error").textContent = "";
  $("#modal-reset-empleado").classList.remove("hidden");
}

function cerrarResetEmpleado() {
  $("#modal-reset-empleado")?.classList.add("hidden");
}

async function reiniciarPasswordEmpleado(e) {
  e.preventDefault();

  const membershipId = $("#reset-membership-id").value;
  const password = $("#reset-empleado-password").value;
  const errorEl = $("#reset-empleado-error");

  errorEl.textContent = "";

  const { data, error } = await supabaseClient.functions.invoke("gestionar-empleado", {
    body: {
      action: "reset_password",
      membership_id: membershipId,
      password,
    },
  });

  if (error || data?.error) {
    errorEl.textContent = data?.error || error?.message || "No se pudo reiniciar la contraseña";
    return;
  }

  cerrarResetEmpleado();
  mostrarToast("Contraseña reiniciada. El empleado deberá cambiarla al ingresar.", "success");
  await renderEquipo();
}


// =====================
// Realtime: los cambios se reflejan al instante en todos los dispositivos
// =====================
function suscribirRealtime() {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  if (!appContext?.business?.id) return;

  const businessId = appContext.business.id;

  realtimeChannel = supabaseClient
    .channel(`productos-${businessId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "productos", filter: `negocio_id=eq.${businessId}` },
      (payload) => {
        aplicarCambioRemoto(payload);
      }
    )
    .subscribe((status) => console.info("[V2] Realtime:", status));
}

function aplicarCambioRemoto(payload) {
  const { eventType, new: nuevo, old: viejo } = payload;
  if (eventType === "INSERT") {
    if (!productos.some((p) => p.id === nuevo.id)) {
      productos.push(mapearProductoDB(nuevo));
    }
  } else if (eventType === "UPDATE") {
    const idx = productos.findIndex((p) => p.id === nuevo.id);
    if (idx !== -1) productos[idx] = mapearProductoDB(nuevo);
  } else if (eventType === "DELETE") {
    productos = productos.filter((p) => p.id !== viejo.id);
  }
  actualizarFiltroCategorias();
  renderGrid();
  aplicarPermisosV2();
  if (!$("#modal-venta").classList.contains("hidden")) renderVentaProductos();
}

function mapearProductoDB(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    categoria: row.categoria || "",
    precioCompra: row.precio_compra || 0,
    precioVenta: row.precio_venta || 0,
    stock: row.stock || 0,
    stockMinimo: row.stock_minimo ?? 5,
    foto: row.foto || null,
    creado: row.creado,
  };
}

// =====================
// Persistencia (Supabase)
// =====================
async function cargarProductos() {
  const { data, error } = await supabaseClient
    .from("productos")
    .select("*")
    .order("nombre", { ascending: true });
  if (error) {
    mostrarToast("No se pudieron cargar los productos", "error");
    productos = [];
    return;
  }
  productos = (data || []).map(mapearProductoDB);
}

async function cargarCategorias() {
  const { data, error } = await supabaseClient
    .from("categorias")
    .select("*")
    .order("nombre", { ascending: true });
  if (error) {
    categorias = [...CATEGORIAS_DEFAULT];
    return;
  }
  if (!data || data.length === 0) {
    await crearCategoriasIniciales();
  } else {
    categorias = data.map((c) => c.nombre);
  }
}

async function crearCategoriasIniciales() {
  const uid = sesionActual.user.id;
  const filas = CATEGORIAS_DEFAULT.map((nombre) => ({ user_id: uid, nombre }));
  const { data, error } = await supabaseClient.from("categorias").insert(filas).select();
  categorias = error ? [...CATEGORIAS_DEFAULT] : data.map((c) => c.nombre);
}

// =====================
// Tema (se mantiene local: es solo una preferencia visual del dispositivo)
// =====================
function cargarTema() {
  const tema = localStorage.getItem(THEME_KEY) || "dark";
  document.documentElement.setAttribute("data-theme", tema === "light" ? "light" : "");
  $("#theme-icon").textContent = tema === "light" ? "🌙" : "☀️";
}

function toggleTema() {
  const actual = document.documentElement.getAttribute("data-theme");
  const nuevo = actual === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", nuevo === "light" ? "light" : "");
  localStorage.setItem(THEME_KEY, nuevo);
  $("#theme-icon").textContent = nuevo === "light" ? "🌙" : "☀️";
  mostrarToast(nuevo === "light" ? "Tema claro activado" : "Tema oscuro activado", "info");
}

// =====================
// Utilidades
// =====================
function formatearPrecio(valor) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS",
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(valor || 0);
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

function mostrarToast(mensaje, tipo = "success") {
  const container = $("#toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.textContent = mensaje;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}

function comprimirImagen(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Archivo no válido"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMG_SIZE || height > MAX_IMG_SIZE) {
          if (width > height) {
            height = Math.round((height * MAX_IMG_SIZE) / width);
            width = MAX_IMG_SIZE;
          } else {
            width = Math.round((width * MAX_IMG_SIZE) / height);
            height = MAX_IMG_SIZE;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = () => reject(new Error("No se pudo leer la imagen"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function mostrarPreviewFoto(base64) {
  const img = $("#foto-img");
  const placeholder = $("#foto-placeholder");
  if (base64) {
    img.src = base64;
    img.classList.remove("hidden");
    placeholder.classList.add("hidden");
  } else {
    img.src = "";
    img.classList.add("hidden");
    placeholder.classList.remove("hidden");
  }
}

// =====================
// Confirmación
// =====================
function confirmar(titulo, mensaje) {
  return new Promise((resolve) => {
    $("#confirm-titulo").textContent = titulo;
    $("#confirm-mensaje").textContent = mensaje;
    $("#modal-confirm").classList.remove("hidden");
    confirmCallback = resolve;
    $("#btn-confirm-ok").onclick = () => { cerrarConfirm(); resolve(true); };
    $("#btn-confirm-cancel").onclick = () => { cerrarConfirm(); resolve(false); };
    $("#btn-cerrar-confirm").onclick = () => { cerrarConfirm(); resolve(false); };
  });
}

function cerrarConfirm() {
  $("#modal-confirm").classList.add("hidden");
  confirmCallback = null;
}

// =====================
// Categorías
// =====================
function renderSelectCategorias(selected = "") {
  const select = $("#categoria");
  select.innerHTML = `<option value="">Sin categoría</option>`;
  categorias.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    if (c === selected) opt.selected = true;
    select.appendChild(opt);
  });
}

function actualizarFiltroCategorias() {
  const actual = $("#filtro-categoria").value;
  const usadas = [...new Set([
    ...categorias,
    ...productos.map((p) => p.categoria).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b, "es"));

  const select = $("#filtro-categoria");
  select.innerHTML = `<option value="">Todas las categorías</option>`;
  usadas.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
  if (usadas.includes(actual)) select.value = actual;
}

function renderListaCategoriasConfig() {
  const ul = $("#lista-categorias-config");
  if (categorias.length === 0) {
    ul.innerHTML = `<li style="justify-content:center;color:var(--text-muted);">No hay categorías. Agregá una.</li>`;
    return;
  }
  ul.innerHTML = categorias
    .map((c, i) => `
      <li>
        <span>${escapeHtml(c)}</span>
        <button type="button" class="btn-icon danger" data-cat-index="${i}" title="Eliminar">🗑️</button>
      </li>`)
    .join("");
}

async function agregarCategoria() {
  if (!exigirPermisoV2("manageProducts", "No tenés permiso para administrar categorías")) return;
  const input = $("#nueva-categoria");
  const nombre = input.value.trim();
  if (!nombre) {
    mostrarToast("Escribí un nombre de categoría", "error");
    return;
  }
  if (categorias.some((c) => c.toLowerCase() === nombre.toLowerCase())) {
    mostrarToast("Esa categoría ya existe", "error");
    return;
  }
  const { error } = await supabaseClient
    .from("categorias")
    .insert({ user_id: sesionActual.user.id, nombre });
  if (error) {
    mostrarToast("No se pudo guardar la categoría", "error");
    return;
  }
  categorias.push(nombre);
  categorias.sort((a, b) => a.localeCompare(b, "es"));
  renderListaCategoriasConfig();
  actualizarFiltroCategorias();
  input.value = "";
  input.focus();
  mostrarToast(`Categoría "${nombre}" agregada`);
}

async function eliminarCategoria(index) {
  if (!exigirPermisoV2("manageProducts", "No tenés permiso para administrar categorías")) return;
  const nombre = categorias[index];
  if (!nombre) return;
  const enUso = productos.some((p) => p.categoria === nombre);
  const msg = enUso
    ? `La categoría "${nombre}" está en uso. ¿La eliminás igual? Los productos quedan sin categoría.`
    : `¿Eliminar la categoría "${nombre}"?`;
  const ok = await confirmar("Eliminar categoría", msg);
  if (!ok) return;

  const { error } = await supabaseClient
    .from("categorias")
    .delete()
    .eq("user_id", sesionActual.user.id)
    .eq("nombre", nombre);
  if (error) {
    mostrarToast("No se pudo eliminar la categoría", "error");
    return;
  }

  if (enUso) {
    const idsAfectados = productos.filter((p) => p.categoria === nombre).map((p) => p.id);
    await supabaseClient.from("productos").update({ categoria: "" }).in("id", idsAfectados);
    productos.forEach((p) => { if (p.categoria === nombre) p.categoria = ""; });
  }
  categorias.splice(index, 1);
  renderListaCategoriasConfig();
  actualizarFiltroCategorias();
  renderGrid();
  mostrarToast("Categoría eliminada");
}

// =====================
// Filtro stock bajo
// =====================
function toggleFiltroStockBajo() {
  filtroStockBajo = !filtroStockBajo;
  $("#stat-bajo-card").classList.toggle("active", filtroStockBajo);
  $("#filtro-activo").classList.toggle("hidden", !filtroStockBajo);
  renderGrid();
  if (filtroStockBajo) mostrarToast("Filtrando productos con stock bajo", "info");
}

function limpiarFiltroStockBajo() {
  filtroStockBajo = false;
  $("#stat-bajo-card").classList.remove("active");
  $("#filtro-activo").classList.add("hidden");
  renderGrid();
}

// =====================
// Productos de ejemplo
// =====================
async function cargarEjemplos() {
  const nombresExistentes = new Set(productos.map((p) => p.nombre.toLowerCase()));
  const aAgregar = PRODUCTOS_EJEMPLO.filter((p) => !nombresExistentes.has(p.nombre.toLowerCase()));

  if (aAgregar.length === 0) {
    mostrarToast("Los productos de ejemplo ya están cargados", "info");
    return;
  }

  const catsFaltantes = [...new Set(aAgregar.map((p) => p.categoria))]
    .filter((c) => c && !categorias.includes(c));
  if (catsFaltantes.length > 0) {
    const uid = sesionActual.user.id;
    const { data } = await supabaseClient
      .from("categorias")
      .insert(catsFaltantes.map((nombre) => ({ user_id: uid, nombre })))
      .select();
    if (data) {
      categorias.push(...data.map((c) => c.nombre));
      categorias.sort((a, b) => a.localeCompare(b, "es"));
    }
  }

  const uid = sesionActual.user.id;
  const filas = aAgregar.map((p) => ({
    user_id: uid,
    nombre: p.nombre,
    categoria: p.categoria,
    precio_compra: p.precioCompra,
    precio_venta: p.precioVenta,
    stock: p.stock,
    stock_minimo: p.stockMinimo,
    foto: p.foto,
  }));
  const { data, error } = await supabaseClient.from("productos").insert(filas).select();
  if (error) {
    mostrarToast("No se pudieron cargar los ejemplos", "error");
    return;
  }
  productos.push(...data.map(mapearProductoDB));
  actualizarFiltroCategorias();
  renderGrid();
  mostrarToast(`${data.length} productos de ejemplo agregados`);
}

// =====================
// Render grid
// =====================
function filtrarYOrdenar() {
  const texto = $("#buscador").value.trim().toLowerCase();
  const cat = $("#filtro-categoria").value;
  const [campo, dir] = ($("#orden").value || "nombre-asc").split("-");

  let lista = productos.filter((p) => {
    const matchTexto =
      !texto ||
      p.nombre.toLowerCase().includes(texto) ||
      (p.categoria && p.categoria.toLowerCase().includes(texto));
    const matchCat = !cat || p.categoria === cat;
    const matchBajo = !filtroStockBajo || p.stock <= (p.stockMinimo ?? 5);
    return matchTexto && matchCat && matchBajo;
  });

  lista.sort((a, b) => {
    let va = a[campo] ?? "";
    let vb = b[campo] ?? "";
    if (typeof va === "string") {
      va = va.toLowerCase();
      vb = (vb + "").toLowerCase();
    }
    if (va < vb) return dir === "asc" ? -1 : 1;
    if (va > vb) return dir === "asc" ? 1 : -1;
    return 0;
  });

  return lista;
}

function renderGrid() {
  const lista = filtrarYOrdenar();
  const grid = $("#productos-grid");
  const empty = $("#empty-state");
  const noResults = $("#no-results");

  const role = appContext.membership?.role || "cashier";
  const puedeGestionar = ["owner", "admin", "manager"].includes(role);
  const puedeAjustarStock = ["owner", "admin", "manager"].includes(role);
  const puedeVerCostos = ["owner", "admin", "manager"].includes(role);

  const totalStock = productos.reduce((a, p) => a + (p.stock || 0), 0);
  const costoTotal = productos.reduce((a, p) => a + (p.stock || 0) * (p.precioCompra || 0), 0);
  const ventaTotal = productos.reduce((a, p) => a + (p.stock || 0) * (p.precioVenta || 0), 0);
  const stockBajo = productos.filter((p) => p.stock <= (p.stockMinimo ?? 5)).length;

  $("#stat-productos").textContent = productos.length;
  $("#stat-stock").textContent = totalStock;
  $("#stat-costo").textContent = puedeVerCostos ? formatearPrecio(costoTotal) : "—";
  $("#stat-venta").textContent = formatearPrecio(ventaTotal);
  $("#stat-bajo").textContent = stockBajo;

  if (productos.length === 0) {
    grid.innerHTML = "";
    if (puedeGestionar) empty.classList.remove("hidden");
    else empty.classList.add("hidden");
    noResults.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");

  if (lista.length === 0) {
    grid.innerHTML = "";
    noResults.classList.remove("hidden");
    return;
  }

  noResults.classList.add("hidden");

  grid.innerHTML = lista
    .map((p) => {
      const stockClass =
        p.stock === 0
          ? "cero"
          : p.stock <= (p.stockMinimo ?? 5)
            ? "bajo"
            : "";

      const cardClass =
        p.stock === 0
          ? "stock-cero-card"
          : p.stock <= (p.stockMinimo ?? 5)
            ? "stock-bajo-card"
            : "";

      const compra = p.precioCompra || 0;
      const venta = p.precioVenta || 0;
      const margen =
        compra > 0
          ? Math.round(((venta - compra) / compra) * 100)
          : null;

      const imgHtml = p.foto
        ? `<img src="${p.foto}" alt="${escapeHtml(p.nombre)}" loading="lazy" />`
        : `<div class="card-img-placeholder">📦</div>`;

      const costosHtml = puedeVerCostos
        ? `
          <div class="card-precio-row">
            <span class="card-precio-label">Compra</span>
            <span class="card-precio-valor">${formatearPrecio(compra)}</span>
          </div>
          ${margen !== null
            ? `<div class="card-margen">Margen ${margen >= 0 ? "+" : ""}${margen}%</div>`
            : ""}`
        : "";

      const stockControlsHtml = puedeAjustarStock
        ? `
          <div class="card-stock-controls">
            <button type="button" data-action="restar" title="Restar una unidad">−</button>
            <span class="card-stock-valor" data-action="ajustar" title="Ajuste manual de stock">${p.stock}</span>
            <button type="button" data-action="sumar" title="Sumar una unidad">+</button>
          </div>`
        : `
          <div class="card-stock-readonly">
            Stock: <strong>${p.stock}</strong>
          </div>`;

      const accionesHtml = puedeGestionar
        ? `
          <div class="card-acciones">
            <button type="button" class="btn-icon" data-action="editar" title="Editar">✏️</button>
            <button type="button" class="btn-icon danger" data-action="eliminar" title="Eliminar">🗑️</button>
          </div>`
        : "";

      return `
        <article class="producto-card ${cardClass}" data-id="${p.id}">
          <div class="card-img-wrap">
            ${imgHtml}
            <span class="card-stock-badge ${stockClass}">${p.stock}</span>
          </div>
          <div class="card-body">
            <div class="card-nombre">${escapeHtml(p.nombre)}</div>
            ${p.categoria ? `<div class="card-categoria">${escapeHtml(p.categoria)}</div>` : ""}

            <div class="card-precios">
              ${costosHtml}
              <div class="card-precio-row">
                <span class="card-precio-label">Venta</span>
                <span class="card-precio-valor venta">${formatearPrecio(venta)}</span>
              </div>
            </div>

            ${stockControlsHtml}
            ${accionesHtml}
          </div>
        </article>
      `;
    })
    .join("");
}
// =====================
// Modal Producto
// =====================
function abrirModal(producto = null) {
  if (!exigirPermisoV2("manageProducts", "No tenés permiso para modificar productos")) return;
  productoEditandoId = producto ? producto.id : null;
  fotoActualBase64 = producto?.foto || null;

  $("#modal-titulo").textContent = producto ? "Editar producto" : "Nuevo producto";
  $("#producto-id").value = producto?.id || "";
  $("#nombre").value = producto?.nombre || "";
  $("#precio-compra").value = producto?.precioCompra ?? "";
  $("#precio-venta").value = producto?.precioVenta ?? "";
  $("#stock").value = producto?.stock ?? 0;
  $("#stock-minimo").value = producto?.stockMinimo ?? 5;
  $("#error-nombre").textContent = "";
  $("#nombre").classList.remove("error");
  $("#foto-input").value = "";
  $("#foto-camara").value = "";

  renderSelectCategorias(producto?.categoria || "");
  mostrarPreviewFoto(fotoActualBase64);

  $("#modal").classList.remove("hidden");
  setTimeout(() => $("#nombre").focus(), 50);
}

function cerrarModal() {
  $("#modal").classList.add("hidden");
  $("#form-producto").reset();
  productoEditandoId = null;
  fotoActualBase64 = null;
  mostrarPreviewFoto(null);
}

// =====================
// Modal Config
// =====================
function abrirConfig() {
  renderListaCategoriasConfig();
  $("#modal-config").classList.remove("hidden");
  setTimeout(() => $("#nueva-categoria").focus(), 50);
}

function cerrarConfig() {
  $("#modal-config").classList.add("hidden");
  actualizarFiltroCategorias();
}

// =====================
// Modal Stock (ajuste manual — usa la función atómica ajustar_stock)
// =====================
function abrirModalStock(id) {
  const p = productos.find((x) => x.id === id);
  if (!p) return;
  stockAjusteId = id;
  stockAjusteValor = p.stock;
  $("#stock-nombre").textContent = p.nombre;
  $("#stock-actual").textContent = stockAjusteValor;
  $("#stock-manual").value = stockAjusteValor;
  $("#modal-stock").classList.remove("hidden");
}

function cerrarModalStock() {
  $("#modal-stock").classList.add("hidden");
  stockAjusteId = null;
}

function aplicarDeltaStock(delta) {
  stockAjusteValor = Math.max(0, stockAjusteValor + delta);
  $("#stock-actual").textContent = stockAjusteValor;
  $("#stock-manual").value = stockAjusteValor;
}

async function confirmarAjusteStock() {
  if (!exigirPermisoV2("adjustStock", "No tenés permiso para ajustar stock")) return;
  if (!stockAjusteId) return;
  const p = productos.find((x) => x.id === stockAjusteId);
  if (!p) return;
  const manual = parseInt($("#stock-manual").value, 10);
  const valorFinal = Number.isFinite(manual) ? Math.max(0, manual) : stockAjusteValor;
  const delta = valorFinal - p.stock;

  if (delta === 0) {
    cerrarModalStock();
    return;
  }

  let data;
  try {
    data = await ajustarStockV2(p.id, delta, "ajuste");
    if (!data) return;
  } catch (error) {
    mostrarToast(error.message || "No se pudo ajustar el stock", "error");
    return;
  }

  p.stock = data.stock;
  renderGrid();
  mostrarToast(`Stock de "${p.nombre}" → ${data.stock}`);
  cerrarModalStock();
}

// =====================
// CRUD de productos
// =====================
async function guardarProducto(e) {
  e.preventDefault();
  if (!exigirPermisoV2("manageProducts", "No tenés permiso para modificar productos")) return;
  const nombre = $("#nombre").value.trim();

  if (!nombre) {
    $("#error-nombre").textContent = "El nombre es obligatorio";
    $("#nombre").classList.add("error");
    $("#nombre").focus();
    return;
  }
  $("#error-nombre").textContent = "";
  $("#nombre").classList.remove("error");

  const btnGuardar = $("#btn-guardar");
  btnGuardar.disabled = true;

  const datosDB = {
    nombre,
    categoria: $("#categoria").value.trim(),
    precio_compra: parseFloat($("#precio-compra").value) || 0,
    precio_venta: parseFloat($("#precio-venta").value) || 0,
    stock: parseInt($("#stock").value, 10) || 0,
    stock_minimo: parseInt($("#stock-minimo").value, 10) || 0,
    foto: fotoActualBase64,
  };

  if (productoEditandoId) {
    const { data, error } = await supabaseClient
      .from("productos")
      .update({ ...datosDB, actualizado: new Date().toISOString() })
      .eq("id", productoEditandoId)
      .select()
      .single();
    btnGuardar.disabled = false;
    if (error) {
      mostrarToast("No se pudo actualizar el producto", "error");
      return;
    }
    const idx = productos.findIndex((p) => p.id === productoEditandoId);
    if (idx !== -1) productos[idx] = mapearProductoDB(data);
    mostrarToast("Producto actualizado");
  } else {
    const { data, error } = await supabaseClient
      .from("productos")
      .insert({ ...datosDB, user_id: sesionActual.user.id })
      .select()
      .single();
    btnGuardar.disabled = false;
    if (error) {
      mostrarToast("No se pudo guardar el producto", "error");
      return;
    }
    productos.push(mapearProductoDB(data));
    mostrarToast("Producto agregado");
  }

  actualizarFiltroCategorias();
  renderGrid();
  cerrarModal();
}

async function eliminarProducto(id) {
  const role = appContext.membership?.role;
  if (!["owner", "admin", "manager"].includes(role)) {
    mostrarToast("Tu rol no permite eliminar productos", "error");
    return;
  }
  if (!exigirPermisoV2("manageProducts", "No tenés permiso para eliminar productos")) return;
  const p = productos.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmar(
    "Eliminar producto",
    `¿Seguro que querés eliminar "${p.nombre}"? Esta acción no se puede deshacer.`
  );
  if (!ok) return;

  const { error } = await supabaseClient.from("productos").delete().eq("id", id);
  if (error) {
    mostrarToast("No se pudo eliminar el producto", "error");
    return;
  }
  productos = productos.filter((x) => x.id !== id);
  actualizarFiltroCategorias();
  renderGrid();
  mostrarToast("Producto eliminado");
}

// "sumar" = reposición de mercadería (ingreso) · "restar" = venta
async function cambiarStock(id, delta) {
  const role = appContext.membership?.role;
  if (!["owner", "admin", "manager"].includes(role)) {
    mostrarToast("Tu rol no permite modificar stock", "error");
    return;
  }
  if (!exigirPermisoV2("adjustStock", "No tenés permiso para ajustar stock")) return;
  const p = productos.find((x) => x.id === id);
  if (!p) return;
  if (delta < 0 && p.stock === 0) return;

  const tipo = delta > 0 ? "ingreso" : "ajuste";
  let data;
  try {
    data = await ajustarStockV2(id, delta, tipo);
    if (!data) return;
  } catch (error) {
    mostrarToast(error.message || "No se pudo actualizar el stock", "error");
    return;
  }

  p.stock = data.stock;
  renderGrid();
  requestAnimationFrame(() => {
    const el = document.querySelector(`.producto-card[data-id="${id}"] .card-stock-valor`);
    if (el) {
      el.classList.add("changed");
      setTimeout(() => el.classList.remove("changed"), 400);
    }
  });
}

// =====================
// Venta (POS) — carrito y cobro
// =====================
function abrirVenta() {
  carrito = [];
  $("#venta-buscador").value = "";
  $("#medio-pago").value = "Efectivo";
  renderVentaProductos();
  renderCarrito();
  $("#modal-venta").classList.remove("hidden");
  setTimeout(() => $("#venta-buscador").focus(), 50);
}

function cerrarVenta() {
  $("#modal-venta").classList.add("hidden");
  carrito = [];
}

function renderVentaProductos() {
  const texto = $("#venta-buscador").value.trim().toLowerCase();
  const lista = productos
    .filter((p) => !texto || p.nombre.toLowerCase().includes(texto) || (p.categoria && p.categoria.toLowerCase().includes(texto)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const cont = $("#venta-productos-lista");
  if (lista.length === 0) {
    cont.innerHTML = `<p class="carrito-vacio">Sin resultados</p>`;
    return;
  }

  cont.innerHTML = lista
    .map((p) => {
      const enCarrito = carrito.find((c) => c.id === p.id);
      const disponible = p.stock - (enCarrito?.cantidad || 0);
      const sinStock = disponible <= 0;
      const thumb = p.foto
        ? `<img class="venta-producto-thumb" src="${p.foto}" alt="" />`
        : `<div class="venta-producto-thumb">📦</div>`;
      return `
        <div class="venta-producto-item ${sinStock ? "sin-stock" : ""}" data-id="${p.id}">
          ${thumb}
          <div class="venta-producto-info">
            <div class="venta-producto-nombre">${escapeHtml(p.nombre)}</div>
            <div class="venta-producto-meta">${formatearPrecio(p.precioVenta)} · quedan ${disponible}</div>
          </div>
        </div>`;
    })
    .join("");
}

function agregarAlCarrito(id) {
  const p = productos.find((x) => x.id === id);
  if (!p) return;
  const item = carrito.find((c) => c.id === id);
  const enCarrito = item?.cantidad || 0;
  if (enCarrito >= p.stock) {
    mostrarToast(`No queda más stock de "${p.nombre}"`, "error");
    return;
  }
  if (item) {
    item.cantidad += 1;
  } else {
    carrito.push({ id: p.id, nombre: p.nombre, precioVenta: p.precioVenta, stock: p.stock, cantidad: 1 });
  }
  renderVentaProductos();
  renderCarrito();
}

function cambiarCantidadCarrito(id, delta) {
  const item = carrito.find((c) => c.id === id);
  if (!item) return;
  const p = productos.find((x) => x.id === id);
  const max = p ? p.stock : item.stock;
  item.cantidad = Math.max(1, Math.min(max, item.cantidad + delta));
  renderVentaProductos();
  renderCarrito();
}

function quitarDelCarrito(id) {
  carrito = carrito.filter((c) => c.id !== id);
  renderVentaProductos();
  renderCarrito();
}

function calcularTotalCarrito() {
  return carrito.reduce((a, c) => a + c.precioVenta * c.cantidad, 0);
}

function renderCarrito() {
  const cont = $("#carrito-items");
  const btnCobrar = $("#btn-cobrar");

  if (carrito.length === 0) {
    cont.innerHTML = `<p class="carrito-vacio" id="carrito-vacio">Tocá un producto para agregarlo</p>`;
    $("#carrito-total").textContent = formatearPrecio(0);
    btnCobrar.disabled = true;
    return;
  }

  cont.innerHTML = carrito
    .map((c) => `
      <div class="carrito-item" data-id="${c.id}">
        <div class="carrito-item-info">
          <div class="carrito-item-nombre">${escapeHtml(c.nombre)}</div>
          <div class="carrito-item-sub">${formatearPrecio(c.precioVenta)} c/u · ${formatearPrecio(c.precioVenta * c.cantidad)}</div>
        </div>
        <div class="carrito-item-qty">
          <button type="button" data-qty="-1">−</button>
          <span>${c.cantidad}</span>
          <button type="button" data-qty="1">+</button>
        </div>
        <button type="button" class="carrito-item-quitar" data-quitar title="Quitar">🗑️</button>
      </div>`)
    .join("");

  $("#carrito-total").textContent = formatearPrecio(calcularTotalCarrito());
  btnCobrar.disabled = false;
}

async function confirmarVenta() {
  if (carrito.length === 0) return;
  const btn = $("#btn-cobrar");
  btn.disabled = true;
  btn.textContent = "Cobrando...";

  const medioPago = $("#medio-pago").value;

  let data;
  try {
    data = await registrarVentaV2(carrito, medioPago);
  } catch (error) {
    btn.textContent = "Cobrar";
    btn.disabled = false;
    mostrarToast(error.message || "No se pudo registrar la venta", "error");
    return;
  }

  btn.textContent = "Cobrar";
  if (!data) {
    btn.disabled = false;
    return;
  }

  // Descontar localmente (además de lo que llegue por Realtime)
  carrito.forEach((c) => {
    const p = productos.find((x) => x.id === c.id);
    if (p) p.stock = Math.max(0, p.stock - c.cantidad);
  });

  const total = data?.venta?.total ?? calcularTotalCarrito();
  renderGrid();
  mostrarToast(`Venta cobrada: ${formatearPrecio(total)}`);
  cerrarVenta();
}

// =====================
// Export CSV
// =====================
function exportarCSV() {
  if (!exigirPermisoV2("viewReports", "No tenés permiso para exportar información")) return;
  if (productos.length === 0) {
    mostrarToast("No hay productos para exportar", "error");
    return;
  }
  const headers = ["Nombre", "Categoría", "Precio compra", "Precio venta", "Stock", "Stock mínimo"];
  const rows = productos.map((p) => [
    `"${(p.nombre || "").replace(/"/g, '""')}"`,
    `"${(p.categoria || "").replace(/"/g, '""')}"`,
    p.precioCompra || 0, p.precioVenta || 0, p.stock || 0, p.stockMinimo ?? 5,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vendify-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarToast("CSV exportado");
}

// =====================
// Historial de ventas (tickets)
// =====================
function rangoFechas(clave) {
  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  let desde = null;
  let hasta = null;

  switch (clave) {
    case "hoy":
      desde = inicioHoy;
      break;
    case "ayer": {
      desde = new Date(inicioHoy);
      desde.setDate(desde.getDate() - 1);
      hasta = new Date(inicioHoy);
      break;
    }
    case "7dias":
      desde = new Date(inicioHoy);
      desde.setDate(desde.getDate() - 6);
      break;
    case "mes":
      desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      break;
    case "todo":
    default:
      desde = null;
  }
  return { desde, hasta };
}

async function abrirHistorial() {
  $("#modal-historial").classList.remove("hidden");
  await renderHistorial();
}

function cerrarHistorial() {
  $("#modal-historial").classList.add("hidden");
}

async function renderHistorial() {
  const cont = $("#historial-lista");
  const vacio = $("#historial-vacio");
  const resumen = $("#historial-resumen");
  cont.innerHTML = `<p class="hint" style="text-align:center;padding:1rem;">Cargando...</p>`;
  vacio.classList.add("hidden");

  const clave = $("#historial-rango").value;
  const { desde, hasta } = rangoFechas(clave);

  let query = supabaseClient
    .from("ventas")
    .select("*, venta_items(*)")
    .order("creado", { ascending: false });

  if (desde) query = query.gte("creado", desde.toISOString());
  if (hasta) query = query.lt("creado", hasta.toISOString());

  const { data, error } = await query;

  if (error) {
    cont.innerHTML = "";
    mostrarToast("No se pudo cargar el historial", "error");
    return;
  }

  const ventasList = data || [];

  if (ventasList.length === 0) {
    cont.innerHTML = "";
    resumen.innerHTML = "";
    vacio.classList.remove("hidden");
    return;
  }
  vacio.classList.add("hidden");

  const totalPeriodo = ventasList.reduce((a, v) => a + (v.total || 0), 0);
  resumen.innerHTML = `
    <span><strong>${ventasList.length}</strong> ticket${ventasList.length === 1 ? "" : "s"}</span>
    <span><strong>${formatearPrecio(totalPeriodo)}</strong> vendido</span>
  `;

  cont.innerHTML = ventasList
    .map((v) => {
      const fecha = new Date(v.creado);
      const fechaTexto = fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
      const horaTexto = fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
      const items = (v.venta_items || []).sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre, "es"));

      const itemsHtml = items
        .map(
          (it) => `
            <div class="ticket-item-row">
              <span>${it.cantidad}× ${escapeHtml(it.producto_nombre)}</span>
              <span>${formatearPrecio(it.subtotal)}</span>
            </div>`
        )
        .join("");

      return `
        <details class="ticket-card">
          <summary>
            <span class="ticket-fecha">${fechaTexto} · ${horaTexto}</span>
            ${v.medio_pago ? `<span class="ticket-medio">${escapeHtml(v.medio_pago)}</span>` : ""}
            <span class="ticket-total">${formatearPrecio(v.total)}</span>
          </summary>
          <div class="ticket-items">${itemsHtml || '<p class="hint">Sin detalle de artículos</p>'}</div>
        </details>
      `;
    })
    .join("");
}

// =====================
// Eventos
// =====================
function inicializarEventos() {
  $("#login-form")?.addEventListener("submit", iniciarSesionPassword);
  $("#employee-login-form")?.addEventListener("submit", loginEmpleado);
  $("#register-form")?.addEventListener("submit", registrarCuenta);
  $("#forgot-form")?.addEventListener("submit", solicitarResetPassword);
  $("#new-password-form")?.addEventListener("submit", guardarNuevaPassword);

  $("#tab-owner")?.addEventListener("click", () => mostrarPanelAuth("owner"));
  $("#tab-employee")?.addEventListener("click", () => mostrarPanelAuth("employee"));
  $("#btn-show-register")?.addEventListener("click", () => mostrarPanelAuth("register"));
  $("#btn-back-login")?.addEventListener("click", () => mostrarPanelAuth("owner"));
  $("#btn-forgot")?.addEventListener("click", () => {
    const email = $("#login-email")?.value.trim();
    if ($("#forgot-email") && email) $("#forgot-email").value = email;
    mostrarPanelAuth("forgot");
  });
  $("#btn-forgot-back")?.addEventListener("click", () => mostrarPanelAuth("owner"));

  document.querySelectorAll("[data-toggle-password]").forEach((btn) => {
    btn.addEventListener("click", () => togglePassword(btn.dataset.togglePassword, btn));
  });

  $("#btn-cerrar-sesion")?.addEventListener("click", cerrarSesion);

  $("#btn-nuevo").addEventListener("click", () => abrirModal());
  $("#btn-empty-nuevo")?.addEventListener("click", () => abrirModal());
  $("#btn-vender").addEventListener("click", abrirVenta);
  $("#btn-cerrar-venta").addEventListener("click", cerrarVenta);
  $("#modal-venta .modal-backdrop").addEventListener("click", cerrarVenta);


  $("#btn-equipo")?.addEventListener("click", abrirEquipo);
  $("#btn-cerrar-equipo")?.addEventListener("click", cerrarEquipo);
  $("#modal-equipo .modal-backdrop")?.addEventListener("click", cerrarEquipo);
  $("#form-crear-empleado")?.addEventListener("submit", crearEmpleadoV3);
  $("#btn-refrescar-equipo")?.addEventListener("click", renderEquipo);
  $("#btn-generar-password")?.addEventListener("click", () => {
    $("#equipo-password").value = generarPasswordTemporal();
  });
  $("#btn-copy-business-code")?.addEventListener("click", async () => {
    const code = $("#equipo-business-code")?.textContent?.trim();
    if (code && code !== "—") {
      await navigator.clipboard.writeText(code);
      mostrarToast("Código copiado", "success");
    }
  });
  $("#form-password-empleado")?.addEventListener("submit", cambiarPasswordEmpleadoV3);

  $("#form-editar-empleado")?.addEventListener("submit", guardarEdicionEmpleado);
  $("#btn-cerrar-editar-empleado")?.addEventListener("click", cerrarEditarEmpleado);
  $("#btn-cancelar-editar-empleado")?.addEventListener("click", cerrarEditarEmpleado);
  $("#modal-editar-empleado .modal-backdrop")?.addEventListener("click", cerrarEditarEmpleado);

  $("#form-reset-empleado")?.addEventListener("submit", reiniciarPasswordEmpleado);
  $("#btn-cerrar-reset-empleado")?.addEventListener("click", cerrarResetEmpleado);
  $("#btn-cancelar-reset-empleado")?.addEventListener("click", cerrarResetEmpleado);
  $("#modal-reset-empleado .modal-backdrop")?.addEventListener("click", cerrarResetEmpleado);
  $("#btn-generar-reset-password")?.addEventListener("click", () => {
    $("#reset-empleado-password").value = generarPasswordTemporal();
  });

  $("#equipo-lista")?.addEventListener("change", (e) => {
    const select=e.target.closest(".equipo-role-select"); if(!select)return;
    cambiarRolEquipo(select.dataset.membershipId,select.value,select);
  });
  $("#equipo-lista")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-equipo-action]");
    if (!btn) return;

    if (btn.dataset.equipoAction === "toggle-member") {
      cambiarEstadoEquipo(btn.dataset.id, btn.dataset.activo === "1");
    } else if (btn.dataset.equipoAction === "edit-member") {
      abrirEditarEmpleadoDesdeBoton(btn);
    } else if (btn.dataset.equipoAction === "reset-password") {
      abrirResetEmpleadoDesdeBoton(btn);
    }
  });

  $("#btn-historial")?.addEventListener("click", abrirHistorial);
  $("#btn-cerrar-historial")?.addEventListener("click", cerrarHistorial);
  $("#modal-historial .modal-backdrop")?.addEventListener("click", cerrarHistorial);
  $("#historial-rango")?.addEventListener("change", renderHistorial);
  $("#venta-buscador").addEventListener("input", renderVentaProductos);
  $("#venta-productos-lista").addEventListener("click", (e) => {
    const item = e.target.closest(".venta-producto-item");
    if (!item || item.classList.contains("sin-stock")) return;
    agregarAlCarrito(item.dataset.id);
  });
  $("#carrito-items").addEventListener("click", (e) => {
    const fila = e.target.closest(".carrito-item");
    if (!fila) return;
    const id = fila.dataset.id;
    const qtyBtn = e.target.closest("[data-qty]");
    if (qtyBtn) { cambiarCantidadCarrito(id, parseInt(qtyBtn.dataset.qty, 10)); return; }
    if (e.target.closest("[data-quitar]")) quitarDelCarrito(id);
  });
  $("#btn-cobrar").addEventListener("click", confirmarVenta);
  $("#btn-theme").addEventListener("click", toggleTema);
  $("#btn-export").addEventListener("click", exportarCSV);
  $("#btn-config").addEventListener("click", abrirConfig);

  $("#stat-bajo-card").addEventListener("click", toggleFiltroStockBajo);
  $("#btn-limpiar-filtro").addEventListener("click", limpiarFiltroStockBajo);

  $("#btn-cargar-ejemplos")?.addEventListener("click", cargarEjemplos);
  $("#btn-cargar-ejemplos-config")?.addEventListener("click", cargarEjemplos);

  $("#btn-add-categoria").addEventListener("click", agregarCategoria);
  $("#nueva-categoria").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); agregarCategoria(); }
  });
  $("#lista-categorias-config").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat-index]");
    if (!btn) return;
    eliminarCategoria(parseInt(btn.dataset.catIndex, 10));
  });
  $("#btn-cerrar-config").addEventListener("click", cerrarConfig);
  $("#btn-cerrar-config-ok").addEventListener("click", cerrarConfig);
  $("#modal-config .modal-backdrop").addEventListener("click", cerrarConfig);

  async function manejarFoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      fotoActualBase64 = await comprimirImagen(file);
      mostrarPreviewFoto(fotoActualBase64);
      mostrarToast("Imagen cargada", "info");
    } catch {
      mostrarToast("No se pudo procesar la imagen", "error");
    }
  }
  $("#foto-input").addEventListener("change", manejarFoto);
  $("#foto-camara").addEventListener("change", manejarFoto);
  $("#btn-quitar-foto").addEventListener("click", () => {
    fotoActualBase64 = null;
    $("#foto-input").value = "";
    $("#foto-camara").value = "";
    mostrarPreviewFoto(null);
  });

  $("#btn-cerrar-modal").addEventListener("click", cerrarModal);
  $("#btn-cancelar").addEventListener("click", cerrarModal);
  $("#modal .modal-backdrop").addEventListener("click", cerrarModal);
  $("#form-producto").addEventListener("submit", guardarProducto);

  $("#modal-confirm .modal-backdrop").addEventListener("click", () => {
    cerrarConfirm();
    if (confirmCallback) confirmCallback(false);
  });

  $("#btn-cerrar-stock").addEventListener("click", cerrarModalStock);
  $("#btn-stock-cancel").addEventListener("click", cerrarModalStock);
  $("#modal-stock .modal-backdrop").addEventListener("click", cerrarModalStock);
  $("#btn-stock-ok").addEventListener("click", confirmarAjusteStock);
  $$(".btn-stock-big").forEach((btn) => {
    btn.addEventListener("click", () => aplicarDeltaStock(parseInt(btn.dataset.delta, 10)));
  });
  $("#stock-manual").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v)) {
      stockAjusteValor = Math.max(0, v);
      $("#stock-actual").textContent = stockAjusteValor;
    }
  });

  $("#buscador").addEventListener("input", renderGrid);
  $("#filtro-categoria").addEventListener("change", renderGrid);
  $("#orden").addEventListener("change", renderGrid);

  $("#productos-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const card = btn.closest(".producto-card");
    const id = card?.dataset.id;
    if (!id) return;
    const action = btn.dataset.action;
    switch (action) {
      case "sumar":
        if (exigirPermisoV2("adjustStock", "No tenés permiso para modificar stock")) cambiarStock(id, 1);
        break;
      case "restar":
        if (exigirPermisoV2("adjustStock", "No tenés permiso para modificar stock")) cambiarStock(id, -1);
        break;
      case "ajustar":
        if (exigirPermisoV2("adjustStock", "No tenés permiso para modificar stock")) abrirModalStock(id);
        break;
      case "editar": {
        if (!exigirPermisoV2("manageProducts", "No tenés permiso para editar productos")) return;
        const p = productos.find((x) => x.id === id);
        if (p) abrirModal(p);
        break;
      }
      case "eliminar":
        if (!exigirPermisoV2("manageProducts", "No tenés permiso para eliminar productos")) return;
        eliminarProducto(id);
        break;
    }
  });

  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    const escribiendo = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (e.key === "Escape") {
      if (!$("#modal").classList.contains("hidden")) cerrarModal();
      else if (!$("#modal-venta").classList.contains("hidden")) cerrarVenta();
      else if (!$("#modal-historial").classList.contains("hidden")) cerrarHistorial();
      else if (!$("#modal-equipo").classList.contains("hidden")) cerrarEquipo();
      else if (!$("#modal-editar-empleado").classList.contains("hidden")) cerrarEditarEmpleado();
      else if (!$("#modal-reset-empleado").classList.contains("hidden")) cerrarResetEmpleado();
      else if (!$("#modal-config").classList.contains("hidden")) cerrarConfig();
      else if (!$("#modal-confirm").classList.contains("hidden")) {
        cerrarConfirm();
        if (confirmCallback) confirmCallback(false);
      } else if (!$("#modal-stock").classList.contains("hidden")) cerrarModalStock();
      return;
    }
    if (escribiendo) return;

    if (e.key === "v" || e.key === "V") { e.preventDefault(); abrirVenta(); }
    else if (e.key === "t" || e.key === "T") { e.preventDefault(); toggleTema(); }
    else if (e.key === "/") { e.preventDefault(); $("#buscador").focus(); }
    else if ((e.key === "n" || e.key === "N") && tienePermisoV2("manageProducts")) { e.preventDefault(); abrirModal(); }
  });
}

// =====================
// PWA + Onboarding
// =====================
function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (localStorage.getItem(INSTALL_DISMISS_KEY)) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    $("#install-banner")?.classList.remove("hidden");
  });

  $("#btn-install")?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $("#install-banner")?.classList.add("hidden");
    if (outcome === "accepted") mostrarToast("¡App instalada!", "success");
  });

  $("#btn-install-dismiss")?.addEventListener("click", () => {
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    $("#install-banner")?.classList.add("hidden");
  });
}

function setupOnboarding() {
  const done = localStorage.getItem(ONBOARDING_KEY);
  if (done) return;
  const el = $("#onboarding");
  if (!el) return;
  el.classList.remove("hidden");

  const cerrar = () => {
    localStorage.setItem(ONBOARDING_KEY, "1");
    el.classList.add("hidden");
  };
  $("#btn-empezar")?.addEventListener("click", cerrar);
  $("#btn-empezar-ejemplos")?.addEventListener("click", () => { cerrar(); cargarEjemplos(); });
}

function init() {
  registrarServiceWorker();
  cargarTema();
  inicializarEventos();
  setupInstallPrompt();
  setupOnboarding();
  initAuth();
}

document.addEventListener("DOMContentLoaded", init);

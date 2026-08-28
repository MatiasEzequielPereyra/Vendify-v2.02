console.log("[Vendify] app loaded");
/**
 * Vendify v2.28 — Login dual y empleados internos
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

// Editor de recorte
let cropImage = null;
let cropScale = 1;
let cropBaseScale = 1;
let cropOffsetX = 0;
let cropOffsetY = 0;
let cropDragging = false;
let cropLastX = 0;
let cropLastY = 0;
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

  const roleName = nombreRolV2(appContext.membership?.role);
  const visibleName =
    appContext.employee?.nombre ||
    (sesionActual?.user?.email ? sesionActual.user.email.split("@")[0] : "") ||
    appContext.business?.nombre ||
    "Usuario";

  const userMenuName = $("#user-menu-name");
  const userMenuNamePopover = $("#user-menu-name-popover");
  const userMenuRole = $("#user-menu-role");
  const userAvatar = $("#user-avatar");

  if (userMenuName) userMenuName.textContent = visibleName;
  if (userMenuNamePopover) userMenuNamePopover.textContent = visibleName;
  if (userMenuRole) userMenuRole.textContent = roleName;
  if (userAvatar) userAvatar.textContent = visibleName.slice(0, 1).toUpperCase();

  const cn = $("#config-negocio");
  const cs = $("#config-sucursal");
  const cu = $("#config-usuario");
  const cr = $("#config-rol");

  if (cn) cn.textContent = appContext.business?.nombre || "—";
  if (cs) cs.textContent = appContext.branch?.nombre || "—";
  if (cu) cu.textContent = visibleName;
  if (cr) cr.textContent = roleName;
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

  setHidden("#btn-equipo", !puedeGestionarEquipo);
  setHidden("#btn-config-equipo", !puedeGestionarEquipo);
  setHidden("#btn-user-settings", !puedeConfigurar);
  setHidden("#config-discount-pin-card", !(esOwner || esAdmin));
  setHidden("#btn-nueva-sucursal-v226", !(esOwner || esAdmin));
  setHidden("#btn-transferir-stock-v226", esCashier);
  setHidden("#btn-eliminar-todos-productos", !(esOwner || esAdmin));
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

async function cambiarSucursalV2(sucursalId, { recargar = true } = {}) {
  const { data, error } = await supabaseClient.rpc("obtener_contexto_sucursal", {
    p_sucursal_id: sucursalId,
  });

  if (error) throw new Error(error.message);

  appContext.branch = data.branch;
  appContext.cashRegister = data.cashRegister;

  if (appContext.business?.id) {
    localStorage.setItem(
      `vendify_branch_${appContext.business.id}`,
      appContext.branch.id
    );
  }

  const selector = $("#branch-selector-v226");
  if (selector) selector.value = appContext.branch.id;

  actualizarContextoUI();

  await cargarCajasSucursalV227({ mantener: true });

  if (recargar) {
    carrito = [];
    await cargarProductos();
    actualizarFiltroCategorias();
    renderGrid();
    if (!$("#modal-venta")?.classList.contains("hidden")) renderVentaProductos();
  }

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
  emitirCambioStockRealtime("venta");
  return data;
}

async function ajustarStockV2(productoId, delta, tipo = "ajuste") {
  if (!exigirPermisoV2("adjustStock", "Tu usuario no tiene permiso para modificar stock")) return null;
  if (!appContext?.branch?.id) throw new Error("No hay una sucursal activa");

  const { data, error } = await supabaseClient.rpc("ajustar_stock_sucursal_v1", {
    p_producto_id: productoId,
    p_sucursal_id: appContext.branch.id,
    p_delta: Number(delta),
    p_tipo: tipo,
  });

  if (error) throw new Error(error.message || "No se pudo ajustar el stock");
  emitirCambioStockRealtime("ajuste_stock");
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

  await inicializarSucursalActivaV226();
  await inicializarCajaV227();
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


function posicionarMenuUsuarioMobile() {
  const menu = $("#user-menu");
  const trigger = $("#btn-user-menu");
  if (!menu || !trigger || menu.classList.contains("hidden")) return;

  if (window.innerWidth > 760) {
    menu.style.position = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.top = "";
    menu.style.width = "";
    menu.style.maxWidth = "";
    return;
  }

  const margin = 10;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(280, Math.max(220, window.innerWidth - margin * 2));

  let left = rect.right - width;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

  menu.style.position = "fixed";
  menu.style.left = `${left}px`;
  menu.style.right = "auto";
  menu.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 70)}px`;
  menu.style.width = `${width}px`;
  menu.style.maxWidth = `calc(100vw - ${margin * 2}px)`;

  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();

    if (menuRect.bottom > window.innerHeight - margin) {
      const top = Math.max(
        margin,
        rect.top - menuRect.height - 8
      );
      menu.style.top = `${top}px`;
    }

    const finalRect = menu.getBoundingClientRect();
    if (finalRect.left < margin) menu.style.left = `${margin}px`;
    if (finalRect.right > window.innerWidth - margin) {
      menu.style.left = `${window.innerWidth - finalRect.width - margin}px`;
    }
  });
}

function limpiarPosicionMenuUsuario() {
  const menu = $("#user-menu");
  if (!menu) return;
  menu.style.position = "";
  menu.style.left = "";
  menu.style.right = "";
  menu.style.top = "";
  menu.style.width = "";
  menu.style.maxWidth = "";
}

function abrirCerrarMenuUsuarioV224(force) {
  const menu = $("#user-menu");
  const trigger = $("#btn-user-menu");
  if (!menu || !trigger) return;

  const abrir =
    typeof force === "boolean"
      ? force
      : menu.classList.contains("hidden");

  menu.classList.toggle("hidden", !abrir);
  trigger.setAttribute("aria-expanded", abrir ? "true" : "false");

  if (abrir) {
    requestAnimationFrame(posicionarMenuUsuarioMobile);
  } else {
    limpiarPosicionMenuUsuario();
  }
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
         </button>
         ${appContext.membership?.role === "owner" ? `
           <button class="btn btn-danger btn-sm"
                   data-equipo-action="delete-member"
                   data-id="${item.membership_id}"
                   data-nombre="${escapeHtml(item.nombre || item.username || "Empleado")}">
             Eliminar
           </button>` : ""}`
      : "";

    return `
      <div class="equipo-item">
        <div class="equipo-persona">
          <div class="equipo-email">${escapeHtml(item.nombre || item.email || "Usuario")}${esYo ? " · Vos" : ""}</div>
          <div class="equipo-meta">
            ${username}
            <span class="equipo-status ${item.activo ? "active" : "inactive"}">${item.activo ? "Activo" : "Inactivo"}</span>
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




async function eliminarEmpleadoDefinitivo(btn) {
  if (appContext.membership?.role !== "owner") {
    mostrarToast("Solo el propietario puede eliminar usuarios", "error");
    return;
  }

  const nombre = btn.dataset.nombre || "este empleado";
  const ok = await confirmar(
    "Eliminar usuario",
    `¿Eliminar definitivamente a ${nombre}? Esta acción elimina su acceso a Vendify.`
  );

  if (!ok) return;

  const { data, error } = await supabaseClient.functions.invoke("gestionar-empleado", {
    body: {
      action: "delete",
      membership_id: btn.dataset.id,
    },
  });

  if (error || data?.error) {
    mostrarToast(data?.error || error?.message || "No se pudo eliminar el usuario", "error");
    return;
  }

  mostrarToast("Usuario eliminado definitivamente", "success");
  await renderEquipo();
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
    `Nueva contraseña para ${btn.dataset.nombre || "el empleado"}.`;
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
  mostrarToast("Contraseña del empleado actualizada", "success");
  await renderEquipo();
}


// =====================
// Realtime robusto — stock sincronizado entre dispositivos
// =====================
let realtimeReloadTimerV226 = null;
let realtimeReconnectTimer = null;
let realtimeFallbackTimer = null;
let realtimeStatus = "IDLE";
let realtimeFullRefreshTimer = null;
let realtimeSyncInFlight = false;

function actualizarEstadoRealtimeUI(status) {
  realtimeStatus = status || "UNKNOWN";
  document.documentElement.dataset.realtimeStatus = realtimeStatus.toLowerCase();
}

async function sincronizarStockLigero({ render = true } = {}) {
  if (
    realtimeSyncInFlight ||
    !appContext?.ready ||
    !appContext?.branch?.id ||
    document.visibilityState === "hidden"
  ) {
    return;
  }

  realtimeSyncInFlight = true;

  try {
    const branchId = appContext.branch.id;

    const { data, error } = await supabaseClient
      .from("producto_stock_sucursal")
      .select("producto_id,stock,stock_minimo")
      .eq("sucursal_id", branchId);

    if (error) throw error;

    let huboCambios = false;
    const stockMap = new Map(
      (data || []).map((row) => [row.producto_id, row])
    );

    productos.forEach((p) => {
      const row = stockMap.get(p.id);
      if (!row) return;

      const nuevoStock = Number(row.stock || 0);
      const nuevoMin = Number(row.stock_minimo || 0);

      if (
        Number(p.stock || 0) !== nuevoStock ||
        Number(p.stockMinimo || 0) !== nuevoMin
      ) {
        p.stock = nuevoStock;
        p.stockMinimo = nuevoMin;
        huboCambios = true;
      }
    });

    if (huboCambios && render) {
      renderGrid();
      aplicarPermisosV2();

      if (!$("#modal-venta")?.classList.contains("hidden")) {
        renderVentaProductos();
        renderCarrito();
      }
    }

    return huboCambios;
  } catch (error) {
    console.warn("[Vendify Realtime] sync ligero falló:", error?.message || error);
    return false;
  } finally {
    realtimeSyncInFlight = false;
  }
}

function programarRefreshInteligenteRealtime() {
  clearTimeout(realtimeFullRefreshTimer);

  realtimeFullRefreshTimer = setTimeout(async () => {
    if (!appContext?.ready || !appContext?.branch?.id) return;

    try {
      await cargarStockInteligente();
      renderGrid();
    } catch (error) {
      console.debug(
        "[Vendify Realtime] stock inteligente pendiente:",
        error?.message || error
      );
    }
  }, 900);
}

function refrescarProductosRealtimeV226() {
  clearTimeout(realtimeReloadTimerV226);

  realtimeReloadTimerV226 = setTimeout(async () => {
    await cargarProductos();
    actualizarFiltroCategorias();
    renderGrid();
    aplicarPermisosV2();

    if (!$("#modal-venta")?.classList.contains("hidden")) {
      renderVentaProductos();
      renderCarrito();
    }
  }, 120);
}

function recibirCambioStockRealtime(payload) {
  const branchId =
    payload?.new?.sucursal_id ||
    payload?.old?.sucursal_id ||
    payload?.payload?.branch_id ||
    payload?.branch_id;

  if (branchId && branchId !== appContext?.branch?.id) return;

  sincronizarStockLigero({ render: true });
  programarRefreshInteligenteRealtime();
}

function emitirCambioStockRealtime(reason = "stock") {
  if (!realtimeChannel || realtimeStatus !== "SUBSCRIBED") return;

  realtimeChannel
    .send({
      type: "broadcast",
      event: "stock_changed",
      payload: {
        branch_id: appContext?.branch?.id || null,
        reason,
        at: Date.now(),
      },
    })
    .catch?.(() => {});
}

function programarReconexionRealtime() {
  clearTimeout(realtimeReconnectTimer);

  if (
    !appContext?.ready ||
    !appContext?.business?.id ||
    !appContext?.branch?.id ||
    document.visibilityState === "hidden"
  ) {
    return;
  }

  realtimeReconnectTimer = setTimeout(() => {
    console.info("[Vendify Realtime] reconectando canal...");
    suscribirRealtime();
  }, 1600);
}

function suscribirRealtime() {
  clearTimeout(realtimeReconnectTimer);

  if (realtimeChannel) {
    try {
      supabaseClient.removeChannel(realtimeChannel);
    } catch {}
    realtimeChannel = null;
  }

  if (!appContext?.business?.id || !appContext?.branch?.id) return;

  const businessId = appContext.business.id;
  const branchId = appContext.branch.id;

  actualizarEstadoRealtimeUI("CONNECTING");

  realtimeChannel = supabaseClient
    .channel(`vendify-${businessId}-${branchId}`, {
      config: {
        broadcast: { self: false },
      },
    })
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "productos",
        filter: `negocio_id=eq.${businessId}`,
      },
      refrescarProductosRealtimeV226
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "producto_stock_sucursal",
        filter: `sucursal_id=eq.${branchId}`,
      },
      recibirCambioStockRealtime
    )
    .on(
      "broadcast",
      { event: "stock_changed" },
      recibirCambioStockRealtime
    )
    .subscribe(async (status) => {
      console.info("[Vendify Realtime]", status);
      actualizarEstadoRealtimeUI(status);

      if (status === "SUBSCRIBED") {
        clearTimeout(realtimeReconnectTimer);

        // Al reconectar no confiamos en la memoria local:
        // se compara inmediatamente contra PostgreSQL.
        await sincronizarStockLigero({ render: true });
        programarRefreshInteligenteRealtime();
        return;
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        programarReconexionRealtime();
      }
    });
}

function iniciarWatchdogRealtime() {
  if (realtimeFallbackTimer) return;

  // Respaldo liviano. Realtime debe ser instantáneo; esto corrige
  // teléfonos que suspenden el WebSocket al bloquear la pantalla.
  realtimeFallbackTimer = setInterval(async () => {
    if (
      document.visibilityState !== "visible" ||
      !appContext?.ready ||
      !appContext?.branch?.id
    ) {
      return;
    }

    await sincronizarStockLigero({ render: true });

    if (realtimeStatus !== "SUBSCRIBED") {
      programarReconexionRealtime();
    }
  }, 10000);

  const resincronizar = async () => {
    if (!appContext?.ready || !appContext?.branch?.id) return;

    await sincronizarStockLigero({ render: true });
    programarRefreshInteligenteRealtime();

    if (realtimeStatus !== "SUBSCRIBED") {
      suscribirRealtime();
    }
  };

  window.addEventListener("focus", resincronizar);
  window.addEventListener("online", resincronizar);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      resincronizar();
    }
  });
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
  if (!appContext?.branch?.id) {
    productos = [];
    return;
  }

  const { data, error } = await supabaseClient.rpc(
    "listar_productos_sucursal_v1",
    { p_sucursal_id: appContext.branch.id }
  );

  if (error) {
    console.error("[V2.26] Error cargando productos de sucursal:", error);
    mostrarToast("No se pudieron cargar los productos de la sucursal", "error");
    productos = [];
    return;
  }

  productos = (data || []).map(mapearProductoDB);
  await cargarStockInteligente();
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


function nombreCompletoProducto(p) {
  const nombre = String(p?.nombre || "").trim();
  const presentacion = String(p?.presentacion || "").trim();

  if (!presentacion) return nombre;

  const normalizar = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(",", ".")
      .trim();

  // Si el nombre ya contiene la presentación/gramaje, no la repetimos.
  if (normalizar(nombre).includes(normalizar(presentacion))) {
    return nombre;
  }

  return `${nombre} ${presentacion}`.trim();
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


async function leerArchivoImagen(file) {
  if (!file) throw new Error("No se recibió ninguna imagen");

  // createImageBitmap suele manejar mejor fotos grandes de cámara móvil
  // y respeta orientación EXIF en navegadores modernos.
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });

      // Normalizamos a canvas para evitar diferencias entre navegadores.
      const maxSide = 2200;
      let width = bitmap.width;
      let height = bitmap.height;

      if (Math.max(width, height) > maxSide) {
        const ratio = maxSide / Math.max(width, height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("No se pudo preparar la foto"));
        img.src = canvas.toDataURL("image/jpeg", 0.9);
      });

      return img;
    } catch (error) {
      console.warn("[Foto] createImageBitmap falló, usando fallback:", error);
    }
  }

  // Fallback compatible.
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error("Formato de imagen no compatible con este navegador"));

      img.src = reader.result;
    };

    reader.onerror = () =>
      reject(new Error("No se pudo leer la imagen"));

    reader.readAsDataURL(file);
  });
}

function abrirEditorRecorte(img) {
  if (!img || !img.width || !img.height) {
    throw new Error("La imagen no pudo cargarse correctamente");
  }

  const canvas = $("#crop-canvas");
  const modal = $("#modal-crop-foto");
  const zoom = $("#crop-zoom");

  if (!canvas || !modal || !zoom) {
    throw new Error("El editor de recorte no está disponible");
  }

  cropImage = img;

  const size = canvas.width;

  cropBaseScale = Math.max(
    size / img.width,
    size / img.height
  );

  cropScale = 1;
  cropOffsetX = 0;
  cropOffsetY = 0;

  zoom.value = "1";
  modal.classList.remove("hidden");

  requestAnimationFrame(() => {
    renderCropCanvas();
  });
}


function resetearCrop() {
  if (!cropImage) return;
  cropScale = 1;
  cropOffsetX = 0;
  cropOffsetY = 0;
  const zoom = $("#crop-zoom");
  if (zoom) zoom.value = "1";
  renderCropCanvas();
}

function cerrarEditorRecorte() {
  $("#modal-crop-foto")?.classList.add("hidden");
  cropImage = null;
  cropDragging = false;
}

function renderCropCanvas() {
  if (!cropImage) return;

  const canvas = $("#crop-canvas");
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const scale = cropBaseScale * cropScale;

  const drawW = cropImage.width * scale;
  const drawH = cropImage.height * scale;

  const centerX = size / 2 + cropOffsetX;
  const centerY = size / 2 + cropOffsetY;
  const x = centerX - drawW / 2;
  const y = centerY - drawH / 2;

  // Limitar desplazamiento para que nunca quede espacio vacío.
  const maxX = Math.max(0, (drawW - size) / 2);
  const maxY = Math.max(0, (drawH - size) / 2);
  cropOffsetX = Math.max(-maxX, Math.min(maxX, cropOffsetX));
  cropOffsetY = Math.max(-maxY, Math.min(maxY, cropOffsetY));

  const finalX = size / 2 + cropOffsetX - drawW / 2;
  const finalY = size / 2 + cropOffsetY - drawH / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(cropImage, finalX, finalY, drawW, drawH);
}

function aplicarRecorteFoto() {
  if (!cropImage) return;

  const source = $("#crop-canvas");
  const output = document.createElement("canvas");

  // Suficiente calidad para el producto sin guardar fotos gigantes.
  output.width = 800;
  output.height = 800;

  const ctx = output.getContext("2d");
  ctx.drawImage(source, 0, 0, 800, 800);

  fotoActualBase64 = output.toDataURL("image/jpeg", 0.82);
  mostrarPreviewFoto(fotoActualBase64);
  cerrarEditorRecorte();
  mostrarToast("Foto recortada", "success");
}

function puntoCropDesdeEvento(e) {
  const canvas = $("#crop-canvas");
  const rect = canvas.getBoundingClientRect();
  const source = e.touches?.[0] || e;

  return {
    x: (source.clientX - rect.left) * (canvas.width / rect.width),
    y: (source.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function iniciarDragCrop(e) {
  if (!cropImage) return;
  e.preventDefault();
  cropDragging = true;
  const p = puntoCropDesdeEvento(e);
  cropLastX = p.x;
  cropLastY = p.y;
}

function moverDragCrop(e) {
  if (!cropDragging || !cropImage) return;
  e.preventDefault();

  const p = puntoCropDesdeEvento(e);
  cropOffsetX += p.x - cropLastX;
  cropOffsetY += p.y - cropLastY;
  cropLastX = p.x;
  cropLastY = p.y;

  renderCropCanvas();
}

function terminarDragCrop() {
  cropDragging = false;
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
  const select = $("#filtro-stock-v29");

  if (select) select.value = "";
  filtroStockBajo = !filtroStockBajo;

  actualizarFiltroRapidoStockUI();
  renderGrid();

  if (filtroStockBajo) {
    mostrarToast("Filtrando stock bajo según velocidad de venta", "info");
  }
}

function limpiarFiltroStockBajo() {
  filtroStockBajo = false;

  const select = $("#filtro-stock-v29");
  if (select) select.value = "";

  actualizarFiltroRapidoStockUI();
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


const PRODUCT_VIEW_KEY = "vendify_product_view";

function obtenerVistaProductos() {
  return localStorage.getItem(PRODUCT_VIEW_KEY) || "list";
}

function aplicarVistaProductos(vista) {
  const cont = $("#productos-grid");
  const btnLista = $("#btn-vista-lista");
  const btnGrid = $("#btn-vista-grid");

  if (!cont) return;

  const modo = vista === "grid" ? "grid" : "list";

  cont.classList.toggle("vista-lista", modo === "list");
  cont.classList.toggle("vista-grid", modo === "grid");

  btnLista?.classList.toggle("active", modo === "list");
  btnGrid?.classList.toggle("active", modo === "grid");

  localStorage.setItem(PRODUCT_VIEW_KEY, modo);
}

function inicializarSelectorVistaProductos() {
  aplicarVistaProductos(obtenerVistaProductos());

  $("#btn-vista-lista")?.addEventListener("click", () => {
    aplicarVistaProductos("list");
  });

  $("#btn-vista-grid")?.addEventListener("click", () => {
    aplicarVistaProductos("grid");
  });
}



function renderGrid() {
  const cont = $("#productos-grid");
  if (!cont) return;

  aplicarVistaProductos(obtenerVistaProductos());

  const texto = ($("#buscar")?.value || "").trim().toLowerCase();
  const categoria = $("#filtro-categoria")?.value || "todas";
  const stockFiltro = $("#filtro-stock")?.value || "todos";
  const orden = $("#orden-productos")?.value || "nombre-asc";

  let lista = [...productos];

  if (texto) {
    lista = lista.filter((p) => {
      const haystack = [
        p.nombre,
        p.marca,
        p.presentacion,
        p.codigo_barras,
        p.categoria_nombre,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(texto);
    });
  }

  if (categoria !== "todas") {
    lista = lista.filter((p) => String(p.categoria_id ?? "") === String(categoria));
  }

  if (stockFiltro === "bajo") {
    lista = lista.filter((p) => Number(p.stock) <= Number(p.stock_minimo ?? 0));
  } else if (stockFiltro === "sin-stock") {
    lista = lista.filter((p) => Number(p.stock) <= 0);
  } else if (stockFiltro === "con-stock") {
    lista = lista.filter((p) => Number(p.stock) > 0);
  }

  lista.sort((a, b) => {
    if (orden === "nombre-desc") return String(b.nombre || "").localeCompare(String(a.nombre || ""));
    if (orden === "stock-asc") return Number(a.stock || 0) - Number(b.stock || 0);
    if (orden === "stock-desc") return Number(b.stock || 0) - Number(a.stock || 0);
    if (orden === "precio-asc") return Number(a.precio || 0) - Number(b.precio || 0);
    if (orden === "precio-desc") return Number(b.precio || 0) - Number(a.precio || 0);
    return String(a.nombre || "").localeCompare(String(b.nombre || ""));
  });

  if (!lista.length) {
    cont.innerHTML = `
      <div class="empty-state">
        <div class="empty-illustration">📦</div>
        <h3>No encontramos productos</h3>
        <p>Probá cambiar la búsqueda o los filtros.</p>
      </div>
    `;
    return;
  }

  const role = appContext.membership?.role || "cashier";
  const puedeGestionar = ["owner", "admin", "manager"].includes(role);
  const puedeAjustarStock = ["owner", "admin", "manager"].includes(role);
  const puedeVerCostos = ["owner", "admin", "manager"].includes(role);

  cont.innerHTML = lista
    .map((p) => {
      const catObj = categorias.find((c) => String(c.id) === String(p.categoria_id));
      const cat = catObj?.nombre || p.categoria_nombre || "Sin categoría";
      const nombre = nombreCompletoProducto(p);
      const inicial = (nombre || "?").charAt(0).toUpperCase();
      const stockBajo = Number(p.stock) <= Number(p.stock_minimo ?? 0);

      return `
        <article class="producto-card ${stockBajo ? "stock-bajo-card" : ""}" data-id="${p.id}">
          <div class="producto-row-media">
            ${
              p.foto
                ? `<img src="${p.foto}" alt="" class="producto-row-img" />`
                : `<div class="producto-row-icon">${escapeHtml(inicial)}</div>`
            }
          </div>

          <div class="producto-row-info">
            <div class="card-nombre">${escapeHtml(nombre)}</div>
            <div class="producto-row-meta">${escapeHtml(cat)}</div>
          </div>

          <div class="producto-row-stock">
            ${
              puedeAjustarStock
                ? `<div class="card-stock-controls">
                    <button class="btn-stock" data-action="restar" data-id="${p.id}" aria-label="Restar stock">−</button>
                    <span class="card-stock-number">${Number(p.stock || 0)}</span>
                    <button class="btn-stock" data-action="sumar" data-id="${p.id}" aria-label="Sumar stock">+</button>
                  </div>`
                : `<span class="stock-solo">${Number(p.stock || 0)}</span>`
            }
          </div>

          <div class="producto-row-price">
            <strong>${formatearPrecio(Number(p.precio || 0))}</strong>
            ${
              puedeVerCostos
                ? `<small>Costo ${formatearPrecio(Number(p.costo || 0))}</small>`
                : ""
            }
          </div>

          <div class="producto-row-actions">
            ${
              puedeGestionar
                ? `<button class="btn btn-secondary btn-sm" data-action="editar" data-id="${p.id}">Editar</button>
                   <button class="btn-icon danger" data-action="eliminar" data-id="${p.id}" aria-label="Eliminar">🗑</button>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");

  aplicarPermisosV2();
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
function activarTabConfigV224(tab) {
  const target = tab || "general";

  document.querySelectorAll(".config-tab-v224").forEach((btn) => {
    const active = btn.dataset.configTab === target;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll(".config-panel-v224").forEach((panel) => {
    const active = panel.dataset.configPanel === target;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
    panel.style.display = active ? "block" : "none";
  });

  const content = $(".config-content-v224");
  if (content) content.scrollTop = 0;
}

function abrirConfig(tab = "general") {
  renderListaCategoriasConfig();
  actualizarContextoUI();

  const welcomeBusiness = $("#config-welcome-business");
  if (welcomeBusiness) {
    welcomeBusiness.textContent = appContext.business?.nombre || "Tu negocio";
  }

  activarTabConfigV224(tab || "general");
  $("#modal-config").classList.remove("hidden");
  actualizarEstadoPinDescuento();

  requestAnimationFrame(() => activarTabConfigV224(tab || "general"));
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


async function eliminarTodosLosProductosV222() {
  const role = appContext.membership?.role;

  if (!["owner", "admin"].includes(role)) {
    mostrarToast("Solo propietario o administrador pueden eliminar todos los productos", "error");
    return;
  }

  if (!productos.length) {
    mostrarToast("No hay productos para eliminar", "info");
    return;
  }

  const cantidad = productos.length;

  const ok1 = await confirmar(
    "Eliminar todos los productos",
    `Vas a eliminar ${cantidad} productos del negocio. Esta acción no se puede deshacer.`
  );

  if (!ok1) return;

  const ok2 = await confirmar(
    "Confirmación final",
    `¿Realmente querés eliminar los ${cantidad} productos? Las ventas históricas no deberían borrarse, pero el catálogo actual quedará vacío.`
  );

  if (!ok2) return;

  const businessId = appContext.business?.id;

  if (!businessId) {
    mostrarToast("No se pudo identificar el negocio", "error");
    return;
  }

  const btn = $("#btn-eliminar-todos-productos");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Eliminando...";
  }

  const { error } = await supabaseClient
    .from("productos")
    .delete()
    .eq("negocio_id", businessId);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = "🗑 Eliminar todos";
  }

  if (error) {
    console.error("[Vendify] Error eliminando productos:", error);
    mostrarToast(error.message || "No se pudieron eliminar los productos", "error");
    return;
  }

  productos = [];
  actualizarFiltroCategorias();
  renderGrid();
  actualizarMetricas?.();
  mostrarToast(`${cantidad} productos eliminados`, "success");
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



// ============================================================
// Seguridad de descuentos — PIN Owner/Admin
// ============================================================

let descuentoAutorizacion = null;

function solicitudDescuentoActual() {
  const subtotal = Number(calcularTotalCarrito().toFixed(2));
  const tipo = $("#venta-descuento-tipo-v228")?.value || "";
  let valor = Number($("#venta-descuento-valor-v228")?.value || 0);

  if (tipo === "porcentaje") {
    valor = Math.max(0, Math.min(100, valor));
  } else if (tipo === "monto") {
    valor = Math.max(0, Math.min(subtotal, valor));
  } else {
    valor = 0;
  }

  return {
    subtotal,
    tipo: tipo || null,
    valor: Number(valor.toFixed(2)),
  };
}

function autorizacionDescuentoCoincide() {
  if (!descuentoAutorizacion?.ok) return false;

  const actual = solicitudDescuentoActual();

  return (
    actual.tipo === descuentoAutorizacion.tipo &&
    Math.abs(actual.valor - descuentoAutorizacion.valor) <= 0.001 &&
    Math.abs(actual.subtotal - descuentoAutorizacion.subtotal) <= 0.01 &&
    Date.now() < descuentoAutorizacion.expiraMs
  );
}

function actualizarUIAutorizacionDescuento() {
  const btn = $("#btn-autorizar-descuento");
  const status = $("#discount-auth-status");
  const caption = $("#discount-auth-caption");
  const solicitud = solicitudDescuentoActual();

  const tieneSolicitud =
    Boolean(solicitud.tipo) &&
    solicitud.valor > 0 &&
    solicitud.subtotal > 0;

  const autorizada = tieneSolicitud && autorizacionDescuentoCoincide();

  if (btn) {
    btn.disabled = !tieneSolicitud || autorizada;
    btn.innerHTML = autorizada ? "✓ Autorizado" : "🔒 Autorizar";
  }

  if (status) {
    status.classList.remove("pending", "authorized", "required");

    if (!solicitud.tipo || solicitud.valor <= 0) {
      status.classList.add("pending");
      status.innerHTML =
        '<span class="discount-auth-dot"></span><span>Sin descuento aplicado</span>';
    } else if (autorizada) {
      status.classList.add("authorized");
      status.innerHTML =
        `<span class="discount-auth-dot"></span>` +
        `<span>Autorizado por ${escapeHtml(descuentoAutorizacion.autorizador || "Administrador")}</span>`;
    } else {
      status.classList.add("required");
      status.innerHTML =
        '<span class="discount-auth-dot"></span><span>Ingresá un PIN de administrador para aplicar este descuento</span>';
    }
  }

  if (caption) {
    caption.textContent = autorizada
      ? "Autorizado"
      : "Requiere autorización";
  }
}

function invalidarAutorizacionDescuento({ recalcular = true } = {}) {
  descuentoAutorizacion = null;
  actualizarUIAutorizacionDescuento();
  if (recalcular) actualizarTotalesVentaV228();
}

function abrirAutorizacionDescuento() {
  const solicitud = solicitudDescuentoActual();

  if (!solicitud.tipo || solicitud.valor <= 0) {
    mostrarToast("Ingresá primero el descuento que querés aplicar", "info");
    return;
  }

  if (solicitud.subtotal <= 0) {
    mostrarToast("Agregá productos antes de autorizar el descuento", "info");
    return;
  }

  const request =
    solicitud.tipo === "porcentaje"
      ? `${solicitud.valor}%`
      : formatearPrecio(solicitud.valor);

  $("#discount-auth-subtotal").textContent =
    formatearPrecio(solicitud.subtotal);
  $("#discount-auth-request").textContent = request;
  $("#discount-admin-pin").value = "";
  $("#discount-auth-error").textContent = "";

  $("#modal-discount-auth").classList.remove("hidden");
  setTimeout(() => $("#discount-admin-pin")?.focus(), 60);
}

function cerrarAutorizacionDescuento() {
  $("#modal-discount-auth")?.classList.add("hidden");
  $("#discount-admin-pin").value = "";
  $("#discount-auth-error").textContent = "";
}

async function enviarAutorizacionDescuento(e) {
  e.preventDefault();

  const solicitud = solicitudDescuentoActual();
  const pin = $("#discount-admin-pin").value.trim();
  const errorEl = $("#discount-auth-error");
  const btn = $("#btn-submit-discount-auth");

  errorEl.textContent = "";

  if (!/^\d{4,8}$/.test(pin)) {
    errorEl.textContent = "El PIN debe tener entre 4 y 8 números.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Verificando...";

  const { data, error } = await supabaseClient.rpc(
    "autorizar_descuento_v1",
    {
      p_pin: pin,
      p_sucursal_id: appContext.branch.id,
      p_subtotal: solicitud.subtotal,
      p_descuento_tipo: solicitud.tipo,
      p_descuento_valor: solicitud.valor,
    }
  );

  btn.disabled = false;
  btn.textContent = "Autorizar descuento";

  if (error) {
    errorEl.textContent = error.message;
    return;
  }

  if (!data?.ok) {
    errorEl.textContent =
      data?.message || "PIN incorrecto o autorización no disponible.";
    return;
  }

  descuentoAutorizacion = {
    ok: true,
    tipo: solicitud.tipo,
    valor: solicitud.valor,
    subtotal: solicitud.subtotal,
    autorizador: data.autorizador_nombre || data.autorizador_rol || "Administrador",
    expiraMs: Date.now() + Math.max(30, Number(data.expira_segundos || 180)) * 1000,
  };

  cerrarAutorizacionDescuento();
  actualizarUIAutorizacionDescuento();
  actualizarTotalesVentaV228();

  mostrarToast(
    `Descuento autorizado por ${descuentoAutorizacion.autorizador}`,
    "success"
  );
}

async function actualizarEstadoPinDescuento() {
  const card = $("#config-discount-pin-card");
  const status = $("#pin-config-status");
  const btn = $("#btn-configurar-pin-descuento");

  if (!card || !status || !btn || !appContext?.ready) return;

  const role = appContext.membership?.role;
  const puede = role === "owner" || role === "admin";

  card.classList.toggle("hidden", !puede);

  if (!puede) return;

  status.textContent = "Consultando estado...";

  const { data, error } = await supabaseClient.rpc("estado_pin_descuento_v1");

  if (error) {
    status.textContent = "No se pudo consultar el estado del PIN.";
    return;
  }

  if (data?.configurado) {
    status.innerHTML =
      '<span class="pin-status-dot configured"></span>' +
      '<span>Tu PIN está configurado</span>';
    btn.textContent = "Cambiar PIN";
  } else {
    status.innerHTML =
      '<span class="pin-status-dot"></span>' +
      '<span>Todavía no configuraste tu PIN</span>';
    btn.textContent = "Configurar PIN";
  }

  const count = Number(data?.autorizadores_configurados || 0);
  if (count > 0) {
    status.innerHTML +=
      `<small>${count} ${count === 1 ? "autorizador disponible" : "autorizadores disponibles"} en el negocio</small>`;
  }
}

function abrirConfigPinDescuento() {
  $("#config-discount-pin").value = "";
  $("#config-discount-pin-confirm").value = "";
  $("#config-discount-pin-error").textContent = "";
  $("#modal-config-discount-pin").classList.remove("hidden");
  setTimeout(() => $("#config-discount-pin")?.focus(), 60);
}

function cerrarConfigPinDescuento() {
  $("#modal-config-discount-pin")?.classList.add("hidden");
  $("#config-discount-pin").value = "";
  $("#config-discount-pin-confirm").value = "";
  $("#config-discount-pin-error").textContent = "";
}

async function guardarConfigPinDescuento(e) {
  e.preventDefault();

  const pin = $("#config-discount-pin").value.trim();
  const confirm = $("#config-discount-pin-confirm").value.trim();
  const errorEl = $("#config-discount-pin-error");
  const btn = $("#btn-save-config-pin");

  errorEl.textContent = "";

  if (!/^\d{4,8}$/.test(pin)) {
    errorEl.textContent = "Usá un PIN de 4 a 8 números.";
    return;
  }

  if (pin !== confirm) {
    errorEl.textContent = "Los PIN no coinciden.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Guardando...";

  const { data, error } = await supabaseClient.rpc(
    "configurar_pin_descuento_v1",
    { p_pin: pin }
  );

  btn.disabled = false;
  btn.textContent = "Guardar PIN";

  if (error) {
    errorEl.textContent = error.message;
    return;
  }

  if (!data?.ok) {
    errorEl.textContent = data?.message || "No se pudo configurar el PIN.";
    return;
  }

  cerrarConfigPinDescuento();
  await actualizarEstadoPinDescuento();
  mostrarToast("PIN de descuentos configurado", "success");
}


// ============================================================
// Vendify v2.28 — Ventas profesionales
// ============================================================

let pagoModoV228 = "single";
let historialVentasV228 = [];
let ticketActualV228 = null;
let gestionVentaV228 = null;

const MEDIOS_PAGO_V228 = [
  "Efectivo",
  "Débito",
  "Crédito",
  "Transferencia",
  "Mercado Pago",
  "Otro",
];

function calcularTotalesVentaV228() {
  const subtotal = calcularTotalCarrito();
  const solicitud = solicitudDescuentoActual();
  const autorizada = autorizacionDescuentoCoincide();

  let tipo = null;
  let valor = 0;
  let descuento = 0;

  if (autorizada && solicitud.tipo === "porcentaje") {
    tipo = solicitud.tipo;
    valor = solicitud.valor;
    descuento = subtotal * valor / 100;
  } else if (autorizada && solicitud.tipo === "monto") {
    tipo = solicitud.tipo;
    valor = solicitud.valor;
    descuento = Math.min(subtotal, valor);
  }

  descuento = Math.round(descuento * 100) / 100;
  const total = Math.max(0, Math.round((subtotal - descuento) * 100) / 100);

  return { subtotal, tipo, valor, descuento, total };
}

function actualizarTotalesVentaV228() {
  const t = calcularTotalesVentaV228();

  const subtotalEl = $("#venta-subtotal-v228");
  const descuentoEl = $("#venta-descuento-total-v228");
  const descuentoRow = $("#venta-descuento-row-v228");
  const totalEl = $("#carrito-total");

  if (subtotalEl) subtotalEl.textContent = formatearPrecio(t.subtotal);
  if (descuentoEl) descuentoEl.textContent = `−${formatearPrecio(t.descuento)}`;
  if (descuentoRow) descuentoRow.classList.toggle("hidden", t.descuento <= 0);
  if (totalEl) totalEl.textContent = formatearPrecio(t.total);

  actualizarRestantePagoMixtoV228();
  actualizarUIAutorizacionDescuento();
  return t;
}

function resetVentaProfesionalV228() {
  pagoModoV228 = "single";
  descuentoAutorizacion = null;

  document.querySelectorAll("[data-pay-mode-v228]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.payModeV228 === "single");
  });

  $("#single-payment-v228")?.classList.remove("hidden");
  $("#mixed-payment-v228")?.classList.add("hidden");

  if ($("#medio-pago")) $("#medio-pago").value = "Efectivo";
  if ($("#venta-descuento-tipo-v228")) $("#venta-descuento-tipo-v228").value = "";
  if ($("#venta-descuento-valor-v228")) {
    $("#venta-descuento-valor-v228").value = "0";
    $("#venta-descuento-valor-v228").disabled = true;
  }
  if ($("#venta-observacion-v228")) $("#venta-observacion-v228").value = "";

  renderPagosMixtosV228([
    { medio_pago: "Efectivo", monto: 0 },
    { medio_pago: "Transferencia", monto: 0 },
  ]);

  actualizarTotalesVentaV228();
}

function activarModoPagoV228(modo) {
  pagoModoV228 = modo === "mixed" ? "mixed" : "single";

  document.querySelectorAll("[data-pay-mode-v228]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.payModeV228 === pagoModoV228);
  });

  $("#single-payment-v228")?.classList.toggle("hidden", pagoModoV228 !== "single");
  $("#mixed-payment-v228")?.classList.toggle("hidden", pagoModoV228 !== "mixed");

  if (pagoModoV228 === "mixed") {
    const rows = $("#mixed-payment-rows-v228");
    if (rows && !rows.children.length) {
      renderPagosMixtosV228([
        { medio_pago: "Efectivo", monto: calcularTotalesVentaV228().total },
        { medio_pago: "Transferencia", monto: 0 },
      ]);
    } else {
      const inputs = [...document.querySelectorAll(".mixed-pay-amount-v228")];
      const sum = inputs.reduce((a, el) => a + Number(el.value || 0), 0);
      if (sum <= 0 && inputs[0]) {
        inputs[0].value = calcularTotalesVentaV228().total.toFixed(2);
      }
    }
  }

  actualizarRestantePagoMixtoV228();
}

function pagoOptionsV228(selected) {
  return MEDIOS_PAGO_V228
    .map(
      (m) =>
        `<option value="${escapeHtml(m)}" ${m === selected ? "selected" : ""}>${escapeHtml(m)}</option>`
    )
    .join("");
}

function renderPagosMixtosV228(pagos = []) {
  const cont = $("#mixed-payment-rows-v228");
  if (!cont) return;

  cont.innerHTML = pagos
    .map(
      (p, i) => `
        <div class="mixed-pay-row-v228" data-pay-index="${i}">
          <select class="select mixed-pay-method-v228">
            ${pagoOptionsV228(p.medio_pago || "Efectivo")}
          </select>
          <div class="mixed-pay-amount-wrap-v228">
            <span>$</span>
            <input class="mixed-pay-amount-v228" type="number" min="0" step="0.01"
                   value="${Number(p.monto || 0).toFixed(2)}" />
          </div>
          <button type="button" class="btn btn-ghost btn-sm mixed-pay-rest-v228"
                  data-pay-rest title="Completar con el restante">Restante</button>
          <button type="button" class="btn-icon danger mixed-pay-remove-v228"
                  data-pay-remove title="Quitar">✕</button>
        </div>
      `
    )
    .join("");

  actualizarRestantePagoMixtoV228();
}

function pagosMixtosDesdeDOMV228() {
  return [...document.querySelectorAll(".mixed-pay-row-v228")].map((row) => ({
    medio_pago: row.querySelector(".mixed-pay-method-v228")?.value || "Otro",
    monto: Number(row.querySelector(".mixed-pay-amount-v228")?.value || 0),
  }));
}

function agregarPagoMixtoV228() {
  const pagos = pagosMixtosDesdeDOMV228();
  pagos.push({ medio_pago: "Efectivo", monto: 0 });
  renderPagosMixtosV228(pagos);
}

function actualizarRestantePagoMixtoV228() {
  const el = $("#mixed-payment-remaining-v228");
  if (!el) return;

  const total = calcularTotalesVentaV228().total;
  const pagos = pagosMixtosDesdeDOMV228();
  const sum = pagos.reduce((a, p) => a + Number(p.monto || 0), 0);
  const restante = Math.round((total - sum) * 100) / 100;

  el.textContent =
    Math.abs(restante) <= 0.01
      ? "Pago completo"
      : restante > 0
        ? `Restante ${formatearPrecio(restante)}`
        : `Excede ${formatearPrecio(Math.abs(restante))}`;

  el.classList.toggle("ok", Math.abs(restante) <= 0.01);
  el.classList.toggle("error", restante < -0.01);
}

function completarRestantePagoV228(row) {
  const total = calcularTotalesVentaV228().total;
  const rows = [...document.querySelectorAll(".mixed-pay-row-v228")];
  let otros = 0;

  rows.forEach((r) => {
    if (r === row) return;
    otros += Number(r.querySelector(".mixed-pay-amount-v228")?.value || 0);
  });

  const input = row.querySelector(".mixed-pay-amount-v228");
  if (input) input.value = Math.max(0, total - otros).toFixed(2);

  actualizarRestantePagoMixtoV228();
}

function obtenerPagosVentaV228(total) {
  if (total <= 0.001) return [];

  if (pagoModoV228 === "single") {
    return [
      {
        medio_pago: $("#medio-pago")?.value || "Efectivo",
        monto: Number(total.toFixed(2)),
      },
    ];
  }

  const pagos = pagosMixtosDesdeDOMV228()
    .filter((p) => p.monto > 0)
    .map((p) => ({ ...p, monto: Number(p.monto.toFixed(2)) }));

  const suma = pagos.reduce((a, p) => a + p.monto, 0);

  if (!pagos.length) {
    throw new Error("Ingresá al menos un medio de pago");
  }

  if (Math.abs(suma - total) > 0.01) {
    throw new Error(
      suma < total
        ? `Faltan ${formatearPrecio(total - suma)} para completar el pago`
        : `Los pagos exceden el total por ${formatearPrecio(suma - total)}`
    );
  }

  return pagos;
}

async function registrarVentaV3(items, pagos, totales, observacion) {
  if (!exigirPermisoV2("sell", "Tu usuario no tiene permiso para registrar ventas")) return null;
  if (!appContext.ready) throw new Error("El contexto del negocio todavía no está cargado");

  const payload = (items || []).map((item) => ({
    producto_id: item.id || item.producto_id,
    cantidad: Number(item.cantidad),
  }));

  const { data, error } = await supabaseClient.rpc("registrar_venta_v3", {
    p_items: payload,
    p_pagos: pagos,
    p_descuento_tipo: totales.tipo,
    p_descuento_valor: Number(totales.valor || 0),
    p_observacion: observacion || null,
    p_sucursal_id: appContext.branch.id,
    p_caja_id: appContext.cashRegister.id,
  });

  if (error) throw new Error(error.message || "No se pudo registrar la venta");
  return data;
}

function estadoVentaLabelV228(estado) {
  const map = {
    completada: "Completada",
    parcialmente_devuelta: "Dev. parcial",
    devuelta: "Devuelta",
    anulada: "Anulada",
  };
  return map[estado] || "Completada";
}

function ventaNetaV228(v) {
  return Math.max(0, Number(v?.total || 0) - Number(v?.total_devuelto || 0));
}

function pagosVentaTextoV228(pagos = [], operacion = "cobro") {
  const list = (pagos || []).filter((p) => p.operacion === operacion);
  if (!list.length) return "";
  return list
    .map((p) => `${p.medio_pago}: ${formatearPrecio(Number(p.monto || 0))}`)
    .join(" · ");
}

function ticketNumeroV228(id) {
  return String(id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
}

function construirTicketHTMLV228(data) {
  const venta = data?.venta || data || {};
  const items = data?.items || venta.venta_items || [];
  const pagos = data?.pagos || venta.venta_pagos || [];
  const fecha = venta.creado ? new Date(venta.creado) : new Date();

  const itemsHtml = items
    .map((it) => {
      const qty = Number(it.cantidad || 0);
      const subtotalGross = Number(it.subtotal ?? (it.precio_unitario || 0) * qty);
      return `
        <div class="receipt-item-v228">
          <div>
            <strong>${qty}× ${escapeHtml(it.producto_nombre || "Producto")}</strong>
            <small>${formatearPrecio(Number(it.precio_unitario || 0))} c/u</small>
          </div>
          <span>${formatearPrecio(subtotalGross)}</span>
        </div>
      `;
    })
    .join("");

  const pagosHtml = pagos
    .filter((p) => p.operacion !== "devolucion")
    .map(
      (p) => `
        <div class="receipt-line-v228">
          <span>${escapeHtml(p.medio_pago)}</span>
          <span>${formatearPrecio(Number(p.monto || 0))}</span>
        </div>`
    )
    .join("");

  const estado = venta.estado || "completada";

  return `
    <div class="receipt-v228">
      <div class="receipt-head-v228">
        <div class="receipt-brand-v228">VENDIFY</div>
        <strong>${escapeHtml(appContext.business?.nombre || "Negocio")}</strong>
        <span>${escapeHtml(appContext.branch?.nombre || "")}${appContext.cashRegister?.nombre ? ` · ${escapeHtml(appContext.cashRegister.nombre)}` : ""}</span>
      </div>

      <div class="receipt-meta-v228">
        <span>Ticket #${ticketNumeroV228(venta.id)}</span>
        <span>${fecha.toLocaleString("es-AR")}</span>
      </div>

      ${estado !== "completada" ? `<div class="receipt-status-v228">${escapeHtml(estadoVentaLabelV228(estado))}</div>` : ""}

      <div class="receipt-items-v228">${itemsHtml}</div>

      <div class="receipt-totals-v228">
        <div class="receipt-line-v228">
          <span>Subtotal</span>
          <span>${formatearPrecio(Number(venta.subtotal ?? venta.total ?? 0))}</span>
        </div>
        ${
          Number(venta.descuento_total || 0) > 0
            ? `<div class="receipt-line-v228">
                 <span>Descuento</span>
                 <span>−${formatearPrecio(Number(venta.descuento_total || 0))}</span>
               </div>`
            : ""
        }
        <div class="receipt-line-v228 total">
          <span>Total</span>
          <strong>${formatearPrecio(Number(venta.total || 0))}</strong>
        </div>
        ${
          Number(venta.total_devuelto || 0) > 0
            ? `<div class="receipt-line-v228 refund">
                 <span>Devuelto</span>
                 <span>−${formatearPrecio(Number(venta.total_devuelto || 0))}</span>
               </div>`
            : ""
        }
      </div>

      ${
        pagosHtml
          ? `<div class="receipt-payment-v228">
               <small>Pago</small>
               ${pagosHtml}
             </div>`
          : ""
      }

      ${
        venta.observacion
          ? `<div class="receipt-note-v228">
               <small>Observación</small>
               <p>${escapeHtml(venta.observacion)}</p>
             </div>`
          : ""
      }

      <div class="receipt-footer-v228">
        Gracias por tu compra
        <small>Gestionado con Vendify</small>
      </div>
    </div>
  `;
}

function mostrarTicketV228(data) {
  ticketActualV228 = data;
  const preview = $("#ticket-preview-v228");
  if (preview) preview.innerHTML = construirTicketHTMLV228(data);
  $("#modal-ticket-v228")?.classList.remove("hidden");
}

function cerrarTicketV228() {
  $("#modal-ticket-v228")?.classList.add("hidden");
}

function imprimirTicketV228() {
  if (!ticketActualV228) return;

  const htmlTicket = construirTicketHTMLV228(ticketActualV228);
  const w = window.open("", "_blank", "width=420,height=720");

  if (!w) {
    mostrarToast("El navegador bloqueó la ventana de impresión", "error");
    return;
  }

  w.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Ticket Vendify</title>
        <style>
          *{box-sizing:border-box}
          body{font-family:Arial,sans-serif;margin:0;padding:16px;color:#111;background:#fff}
          .receipt-v228{max-width:320px;margin:auto;font-size:12px}
          .receipt-head-v228{text-align:center;display:flex;flex-direction:column;gap:3px}
          .receipt-brand-v228{font-size:20px;font-weight:800;letter-spacing:1px}
          .receipt-head-v228 span,.receipt-meta-v228,.receipt-footer-v228 small{font-size:10px;color:#555}
          .receipt-meta-v228{display:flex;justify-content:space-between;border-top:1px dashed #aaa;border-bottom:1px dashed #aaa;padding:8px 0;margin:10px 0}
          .receipt-item-v228{display:flex;justify-content:space-between;gap:10px;padding:5px 0}
          .receipt-item-v228>div{display:flex;flex-direction:column}
          .receipt-item-v228 small{color:#666}
          .receipt-totals-v228,.receipt-payment-v228,.receipt-note-v228{border-top:1px dashed #aaa;margin-top:8px;padding-top:8px}
          .receipt-line-v228{display:flex;justify-content:space-between;gap:12px;padding:2px 0}
          .receipt-line-v228.total{font-size:15px;padding-top:6px}
          .receipt-line-v228.refund{color:#b91c1c}
          .receipt-status-v228{text-align:center;font-weight:700;border:1px solid #111;padding:4px;margin-bottom:8px}
          .receipt-note-v228 p{margin:4px 0 0}
          .receipt-footer-v228{text-align:center;border-top:1px dashed #aaa;margin-top:12px;padding-top:10px;display:flex;flex-direction:column;gap:4px}
          @media print{body{padding:0}.receipt-v228{max-width:none;width:80mm}}
        </style>
      </head>
      <body>${htmlTicket}<script>window.onload=()=>{window.print();}<\/script></body>
    </html>
  `);

  w.document.close();
}

function abrirGestionVentaV228(venta, modo) {
  if (!venta) return;

  if (!cajaAbiertaMiaV227()) {
    mostrarToast("Abrí una caja propia antes de realizar reintegros", "info");
    abrirPanelCajaV227();
    return;
  }

  gestionVentaV228 = { venta, modo };
  const esAnular = modo === "anular";

  $("#return-title-v228").textContent = esAnular ? "Anular venta" : "Devolver artículos";
  $("#return-subtitle-v228").textContent = esAnular
    ? "La venta quedará anulada, se restaurará el stock y se registrará el reintegro."
    : "El stock seleccionado volverá a la sucursal original.";

  $("#return-items-section-v228")?.classList.toggle("hidden", esAnular);
  $("#return-warning-v228")?.classList.toggle("hidden", !esAnular);

  if (esAnular) {
    $("#return-warning-v228").innerHTML = `
      <strong>Esta acción no borra la venta.</strong>
      <span>Quedará registrada como anulada en el historial y en la auditoría.</span>
    `;
  }

  const pagosCobro = (venta.venta_pagos || []).filter((p) => p.operacion === "cobro");
  const method = pagosCobro[0]?.medio_pago || "Efectivo";
  if ($("#return-method-v228")) $("#return-method-v228").value =
    MEDIOS_PAGO_V228.includes(method) ? method : "Otro";

  $("#return-reason-v228").value = "";
  $("#return-error-v228").textContent = "";

  const items = venta.venta_items || [];
  const cont = $("#return-items-v228");

  if (!esAnular) {
    cont.innerHTML = items
      .map((it) => {
        const disponible = Math.max(
          0,
          Number(it.cantidad || 0) - Number(it.cantidad_devuelta || 0)
        );

        return `
          <div class="return-item-v228 ${disponible <= 0 ? "disabled" : ""}"
               data-return-item-id="${it.id}"
               data-return-price="${Number(it.precio_neto_unitario || it.precio_unitario || 0)}">
            <div class="return-item-copy-v228">
              <strong>${escapeHtml(it.producto_nombre)}</strong>
              <small>Disponible para devolver: ${disponible}</small>
            </div>
            <input type="number" class="return-item-qty-v228"
                   min="0" max="${disponible}" step="1" value="0"
                   ${disponible <= 0 ? "disabled" : ""} />
          </div>
        `;
      })
      .join("");
  } else {
    cont.innerHTML = "";
  }

  $("#btn-submit-return-v228").textContent =
    esAnular ? "Anular y reintegrar" : "Confirmar devolución";
  $("#btn-submit-return-v228").classList.toggle("btn-danger", esAnular);
  $("#btn-submit-return-v228").classList.toggle("btn-primary", !esAnular);

  actualizarTotalDevolucionV228();
  $("#modal-return-v228").classList.remove("hidden");
}

function cerrarGestionVentaV228() {
  $("#modal-return-v228")?.classList.add("hidden");
  gestionVentaV228 = null;
}

function actualizarTotalDevolucionV228() {
  const el = $("#return-total-v228");
  if (!el || !gestionVentaV228) return;

  if (gestionVentaV228.modo === "anular") {
    el.textContent = formatearPrecio(ventaNetaV228(gestionVentaV228.venta));
    return;
  }

  let total = 0;
  document.querySelectorAll(".return-item-v228").forEach((row) => {
    const qty = Number(row.querySelector(".return-item-qty-v228")?.value || 0);
    const price = Number(row.dataset.returnPrice || 0);
    total += qty * price;
  });

  const restante = ventaNetaV228(gestionVentaV228.venta);
  total = Math.min(restante, Math.round(total * 100) / 100);
  el.textContent = formatearPrecio(total);
}

async function guardarGestionVentaV228(e) {
  e.preventDefault();
  if (!gestionVentaV228) return;

  const venta = gestionVentaV228.venta;
  const modo = gestionVentaV228.modo;
  const errorEl = $("#return-error-v228");
  const motivo = $("#return-reason-v228").value.trim();
  const medio = $("#return-method-v228").value;

  errorEl.textContent = "";

  if (motivo.length < 2) {
    errorEl.textContent = "Ingresá el motivo.";
    return;
  }

  let response;

  if (modo === "anular") {
    response = await supabaseClient.rpc("anular_venta_v1", {
      p_venta_id: venta.id,
      p_caja_id: appContext.cashRegister.id,
      p_medio_reintegro: medio,
      p_motivo: motivo,
    });
  } else {
    const items = [...document.querySelectorAll(".return-item-v228")]
      .map((row) => ({
        item_id: row.dataset.returnItemId,
        cantidad: Number(row.querySelector(".return-item-qty-v228")?.value || 0),
      }))
      .filter((x) => x.cantidad > 0);

    if (!items.length) {
      errorEl.textContent = "Seleccioná al menos un artículo.";
      return;
    }

    response = await supabaseClient.rpc("devolver_venta_v1", {
      p_venta_id: venta.id,
      p_items: items,
      p_caja_id: appContext.cashRegister.id,
      p_medio_reintegro: medio,
      p_motivo: motivo,
    });
  }

  if (response.error) {
    errorEl.textContent = response.error.message;
    return;
  }

  cerrarGestionVentaV228();

  emitirCambioStockRealtime(modo === "anular" ? "anulacion" : "devolucion");
  await cargarProductos();
  renderGrid();
  await cargarEstadoCajaV227();
  await renderHistorial();

  mostrarToast(
    modo === "anular" ? "Venta anulada y stock restaurado" : "Devolución registrada",
    "success"
  );
}

// =====================
// Venta (POS) — carrito y cobro
// =====================
function abrirVenta() {
  if (!appContext?.cashRegister?.id) {
    mostrarToast("Seleccioná una caja antes de vender", "error");
    return;
  }

  if (!cajaAbiertaMiaV227()) {
    mostrarToast(
      cajaEstadoV227?.sesion
        ? "Esta caja está abierta por otro usuario"
        : "Abrí la caja antes de comenzar a vender",
      "info"
    );
    abrirPanelCajaV227();
    return;
  }

  carrito = [];
  $("#venta-buscador").value = "";
  resetVentaProfesionalV228();
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
  invalidarAutorizacionDescuento({ recalcular: false });
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
  invalidarAutorizacionDescuento({ recalcular: false });
  const item = carrito.find((c) => c.id === id);
  if (!item) return;
  const p = productos.find((x) => x.id === id);
  const max = p ? p.stock : item.stock;
  item.cantidad = Math.max(1, Math.min(max, item.cantidad + delta));
  renderVentaProductos();
  renderCarrito();
}

function quitarDelCarrito(id) {
  invalidarAutorizacionDescuento({ recalcular: false });
  carrito = carrito.filter((c) => c.id !== id);
  renderVentaProductos();
  renderCarrito();
}

function calcularTotalCarrito() {
  return carrito.reduce((a, c) => a + c.precioVenta * c.cantidad, 0);
}

function renderCarrito() {
  const cont = $("#carrito-items");
  const countEl = $("#carrito-count-v210");
  const unidadesCarrito = carrito.reduce(
    (sum, item) => sum + Number(item.cantidad || 0),
    0
  );

  if (countEl) {
    countEl.textContent =
      `${unidadesCarrito} ${unidadesCarrito === 1 ? "artículo" : "artículos"}`;
  }

  const btnCobrar = $("#btn-cobrar");

  if (carrito.length === 0) {
    cont.innerHTML =
      `<p class="carrito-vacio" id="carrito-vacio">Tocá un producto para agregarlo</p>`;
    actualizarTotalesVentaV228();
    btnCobrar.disabled = true;
    return;
  }

  cont.innerHTML = carrito
    .map(
      (c) => `
        <div class="carrito-item" data-id="${c.id}">
          <div class="carrito-item-info">
            <div class="carrito-item-nombre">${escapeHtml(c.nombre)}</div>
            <div class="carrito-item-sub">
              ${formatearPrecio(c.precioVenta)} c/u ·
              ${formatearPrecio(c.precioVenta * c.cantidad)}
            </div>
          </div>
          <div class="carrito-item-qty">
            <button type="button" data-qty="-1">−</button>
            <span>${c.cantidad}</span>
            <button type="button" data-qty="1">+</button>
          </div>
          <button type="button" class="carrito-item-quitar" data-quitar title="Quitar">🗑️</button>
        </div>
      `
    )
    .join("");

  actualizarTotalesVentaV228();
  btnCobrar.disabled = false;
}

async function confirmarVenta() {
  if (carrito.length === 0) return;

  const btn = $("#btn-cobrar");

  const solicitudDescuento = solicitudDescuentoActual();
  if (
    solicitudDescuento.tipo &&
    solicitudDescuento.valor > 0 &&
    !autorizacionDescuentoCoincide()
  ) {
    mostrarToast("Autorizá el descuento con un PIN de administrador", "error");
    abrirAutorizacionDescuento();
    return;
  }

  const totales = calcularTotalesVentaV228();
  let pagos;

  try {
    pagos = obtenerPagosVentaV228(totales.total);
  } catch (error) {
    mostrarToast(error.message, "error");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Cobrando...";

  let data;

  try {
    data = await registrarVentaV3(
      carrito,
      pagos,
      totales,
      $("#venta-observacion-v228").value.trim()
    );
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

  carrito.forEach((c) => {
    const p = productos.find((x) => x.id === c.id);
    if (p) p.stock = Math.max(0, p.stock - c.cantidad);
  });

  renderGrid();
  await cargarEstadoCajaV227();

  const total = Number(data?.venta?.total ?? totales.total);
  mostrarToast(`Venta cobrada: ${formatearPrecio(total)}`, "success");

  descuentoAutorizacion = null;
  cerrarVenta();
  mostrarTicketV228(data);
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

  cont.innerHTML =
    `<p class="hint" style="text-align:center;padding:1rem;">Cargando...</p>`;
  vacio.classList.add("hidden");

  const clave = $("#historial-rango").value;
  const { desde, hasta } = rangoFechas(clave);

  let query = supabaseClient
    .from("ventas")
    .select("*, venta_items(*), venta_pagos(*), venta_devoluciones(*)")
    .order("creado", { ascending: false });

  if (appContext?.branch?.id) {
    query = query.eq("sucursal_id", appContext.branch.id);
  }

  if (desde) query = query.gte("creado", desde.toISOString());
  if (hasta) query = query.lt("creado", hasta.toISOString());

  const { data, error } = await query;

  if (error) {
    console.error("[V2.28] historial:", error);
    cont.innerHTML = "";
    mostrarToast("No se pudo cargar el historial", "error");
    return;
  }

  historialVentasV228 = data || [];

  if (!historialVentasV228.length) {
    cont.innerHTML = "";
    resumen.innerHTML = "";
    vacio.classList.remove("hidden");
    return;
  }

  vacio.classList.add("hidden");

  const ventasActivas = historialVentasV228.filter((v) => v.estado !== "anulada");
  const totalPeriodo = historialVentasV228.reduce(
    (a, v) => a + ventaNetaV228(v),
    0
  );

  const devueltoPeriodo = historialVentasV228.reduce(
    (a, v) => a + Number(v.total_devuelto || 0),
    0
  );

  resumen.innerHTML = `
    <span><strong>${ventasActivas.length}</strong> ticket${ventasActivas.length === 1 ? "" : "s"} netos</span>
    <span><strong>${formatearPrecio(totalPeriodo)}</strong> vendido neto</span>
    ${
      devueltoPeriodo > 0
        ? `<span><strong>${formatearPrecio(devueltoPeriodo)}</strong> devuelto</span>`
        : ""
    }
  `;

  const rol = appContext.membership?.role;
  const puedeGestionar = ["owner", "admin", "manager"].includes(rol);

  cont.innerHTML = historialVentasV228
    .map((v) => {
      const fecha = new Date(v.creado);
      const fechaTexto = fecha.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const horaTexto = fecha.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const items = (v.venta_items || []).sort((a, b) =>
        a.producto_nombre.localeCompare(b.producto_nombre, "es")
      );

      const itemsHtml = items
        .map((it) => {
          const dev = Number(it.cantidad_devuelta || 0);
          return `
            <div class="ticket-item-row">
              <span>
                ${it.cantidad}× ${escapeHtml(it.producto_nombre)}
                ${dev > 0 ? `<small class="ticket-returned-v228"> · ${dev} devuelto${dev === 1 ? "" : "s"}</small>` : ""}
              </span>
              <span>${formatearPrecio(it.subtotal)}</span>
            </div>
          `;
        })
        .join("");

      const neto = ventaNetaV228(v);
      const pagos = pagosVentaTextoV228(v.venta_pagos || [], "cobro");
      const reintegros = pagosVentaTextoV228(v.venta_pagos || [], "devolucion");
      const estado = v.estado || "completada";
      const puedeDevolver =
        puedeGestionar &&
        !["devuelta", "anulada"].includes(estado) &&
        neto > 0.01;

      const puedeAnular =
        puedeGestionar &&
        estado === "completada" &&
        Number(v.total_devuelto || 0) <= 0.01;

      return `
        <details class="ticket-card ticket-card-v228 ${estado}">
          <summary>
            <span class="ticket-fecha">${fechaTexto} · ${horaTexto}</span>
            <span class="sale-status-v228 ${estado}">${estadoVentaLabelV228(estado)}</span>
            ${v.medio_pago ? `<span class="ticket-medio">${escapeHtml(v.medio_pago)}</span>` : ""}
            <span class="ticket-total">${formatearPrecio(neto)}</span>
          </summary>

          <div class="ticket-detail-v228">
            <div class="ticket-items">${itemsHtml || '<p class="hint">Sin detalle de artículos</p>'}</div>

            <div class="ticket-finance-v228">
              <div><span>Subtotal</span><strong>${formatearPrecio(Number(v.subtotal ?? v.total ?? 0))}</strong></div>
              ${
                Number(v.descuento_total || 0) > 0
                  ? `<div><span>Descuento</span><strong>−${formatearPrecio(Number(v.descuento_total))}</strong></div>`
                  : ""
              }
              <div><span>Total original</span><strong>${formatearPrecio(Number(v.total || 0))}</strong></div>
              ${
                Number(v.total_devuelto || 0) > 0
                  ? `<div class="refund"><span>Devuelto</span><strong>−${formatearPrecio(Number(v.total_devuelto))}</strong></div>`
                  : ""
              }
              <div class="net"><span>Neto</span><strong>${formatearPrecio(neto)}</strong></div>
            </div>

            ${
              pagos
                ? `<p class="ticket-payment-note-v228"><strong>Cobro:</strong> ${escapeHtml(pagos)}</p>`
                : ""
            }
            ${
              reintegros
                ? `<p class="ticket-payment-note-v228 refund"><strong>Reintegros:</strong> ${escapeHtml(reintegros)}</p>`
                : ""
            }
            ${
              v.observacion
                ? `<p class="ticket-observation-v228">${escapeHtml(v.observacion)}</p>`
                : ""
            }

            <div class="ticket-actions-row-v228">
              <button type="button" class="btn btn-secondary btn-sm"
                      data-sale-action-v228="ticket" data-id="${v.id}">
                🖨 Ticket
              </button>
              ${
                puedeDevolver
                  ? `<button type="button" class="btn btn-secondary btn-sm"
                             data-sale-action-v228="return" data-id="${v.id}">
                       ↩ Devolver
                     </button>`
                  : ""
              }
              ${
                puedeAnular
                  ? `<button type="button" class="btn btn-danger btn-sm"
                             data-sale-action-v228="void" data-id="${v.id}">
                       Anular
                     </button>`
                  : ""
              }
            </div>
          </div>
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
    } else if (btn.dataset.equipoAction === "delete-member") {
      eliminarEmpleadoDefinitivo(btn);
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

  document.querySelectorAll("[data-pay-mode-v228]").forEach((btn) => {
    btn.addEventListener("click", () => activarModoPagoV228(btn.dataset.payModeV228));
  });

  $("#venta-descuento-tipo-v228")?.addEventListener("change", (e) => {
    const input = $("#venta-descuento-valor-v228");
    descuentoAutorizacion = null;
    input.disabled = !e.target.value;
    if (!e.target.value) input.value = "0";
    actualizarTotalesVentaV228();
  });

  $("#venta-descuento-valor-v228")?.addEventListener("input", () => {
    descuentoAutorizacion = null;
    actualizarTotalesVentaV228();
  });

  $("#btn-autorizar-descuento")?.addEventListener("click", abrirAutorizacionDescuento);

  $("#form-discount-auth")?.addEventListener("submit", enviarAutorizacionDescuento);
  $("#btn-close-discount-auth")?.addEventListener("click", cerrarAutorizacionDescuento);
  $("#btn-cancel-discount-auth")?.addEventListener("click", cerrarAutorizacionDescuento);
  $("#modal-discount-auth .modal-backdrop")?.addEventListener("click", cerrarAutorizacionDescuento);

  $("#btn-configurar-pin-descuento")?.addEventListener("click", abrirConfigPinDescuento);
  $("#form-config-discount-pin")?.addEventListener("submit", guardarConfigPinDescuento);
  $("#btn-close-config-pin")?.addEventListener("click", cerrarConfigPinDescuento);
  $("#btn-cancel-config-pin")?.addEventListener("click", cerrarConfigPinDescuento);
  $("#modal-config-discount-pin .modal-backdrop")?.addEventListener("click", cerrarConfigPinDescuento);

  $("#btn-add-payment-v228")?.addEventListener("click", agregarPagoMixtoV228);

  $("#mixed-payment-rows-v228")?.addEventListener("input", actualizarRestantePagoMixtoV228);
  $("#mixed-payment-rows-v228")?.addEventListener("change", actualizarRestantePagoMixtoV228);
  $("#mixed-payment-rows-v228")?.addEventListener("click", (e) => {
    const row = e.target.closest(".mixed-pay-row-v228");
    if (!row) return;

    if (e.target.closest("[data-pay-remove]")) {
      const pagos = pagosMixtosDesdeDOMV228();
      const index = Number(row.dataset.payIndex);
      pagos.splice(index, 1);
      renderPagosMixtosV228(pagos.length ? pagos : [{ medio_pago: "Efectivo", monto: 0 }]);
      return;
    }

    if (e.target.closest("[data-pay-rest]")) {
      completarRestantePagoV228(row);
    }
  });

  $("#btn-close-ticket-v228")?.addEventListener("click", cerrarTicketV228);
  $("#btn-close-ticket-bottom-v228")?.addEventListener("click", cerrarTicketV228);
  $("#modal-ticket-v228 .modal-backdrop")?.addEventListener("click", cerrarTicketV228);
  $("#btn-print-ticket-v228")?.addEventListener("click", imprimirTicketV228);

  $("#historial-lista")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sale-action-v228]");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const venta = historialVentasV228.find((v) => v.id === btn.dataset.id);
    if (!venta) return;

    if (btn.dataset.saleActionV228 === "ticket") {
      mostrarTicketV228({
        venta,
        items: venta.venta_items || [],
        pagos: venta.venta_pagos || [],
      });
    } else if (btn.dataset.saleActionV228 === "return") {
      abrirGestionVentaV228(venta, "devolver");
    } else if (btn.dataset.saleActionV228 === "void") {
      abrirGestionVentaV228(venta, "anular");
    }
  });

  $("#form-return-v228")?.addEventListener("submit", guardarGestionVentaV228);
  $("#return-items-v228")?.addEventListener("input", actualizarTotalDevolucionV228);
  $("#btn-close-return-v228")?.addEventListener("click", cerrarGestionVentaV228);
  $("#btn-cancel-return-v228")?.addEventListener("click", cerrarGestionVentaV228);
  $("#modal-return-v228 .modal-backdrop")?.addEventListener("click", cerrarGestionVentaV228);

  $("#btn-theme").addEventListener("click", toggleTema);
  $("#btn-export").addEventListener("click", exportarCSV);

  $("#btn-user-menu")?.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirCerrarMenuUsuarioV224();
  });

  $("#user-menu")?.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("click", () => {
    abrirCerrarMenuUsuarioV224(false);
  });

  window.addEventListener("resize", () => {
    if (!$("#user-menu")?.classList.contains("hidden")) {
      posicionarMenuUsuarioMobile();
    }
  });

  $("#btn-user-settings")?.addEventListener("click", () => {
    abrirCerrarMenuUsuarioV224(false);
    abrirConfig("general");
  });

  document.querySelectorAll(".config-tab-v224").forEach((btn) => {
    btn.addEventListener("click", () => activarTabConfigV224(btn.dataset.configTab));
  });

  document.querySelectorAll("[data-config-go]").forEach((btn) => {
    btn.addEventListener("click", () => activarTabConfigV224(btn.dataset.configGo));
  });

  $("#btn-config-catalogo")?.addEventListener("click", () => {
    cerrarConfig();
    abrirCatalogoV29();
  });

  $("#btn-config-equipo")?.addEventListener("click", () => {
    cerrarConfig();
    abrirEquipo();
  });


  $("#stat-bajo-card").addEventListener("click", toggleFiltroStockBajo);
  $("#stat-sin-card")?.addEventListener("click", filtrarSinStockRapido);
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
      const img = await leerArchivoImagen(file);
      abrirEditorRecorte(img);
      e.target.value = "";
    } catch (error) {
      console.error("[Foto] Error procesando imagen:", error);
      mostrarToast(
        error?.message || "No se pudo procesar la imagen",
        "error"
      );
    }
  }
  $("#foto-input").addEventListener("change", manejarFoto);
  $("#foto-camara").addEventListener("change", manejarFoto);

  $("#crop-zoom")?.addEventListener("input", (e) => {
    cropScale = Number(e.target.value);
    renderCropCanvas();
  });

  const cropCanvas = $("#crop-canvas");
  cropCanvas?.addEventListener("mousedown", iniciarDragCrop);
  cropCanvas?.addEventListener("mousemove", moverDragCrop);
  window.addEventListener("mouseup", terminarDragCrop);

  cropCanvas?.addEventListener("touchstart", iniciarDragCrop, { passive: false });
  cropCanvas?.addEventListener("touchmove", moverDragCrop, { passive: false });
  window.addEventListener("touchend", terminarDragCrop);

  $("#btn-crop-reset")?.addEventListener("click", resetearCrop);
  $("#btn-aplicar-crop")?.addEventListener("click", aplicarRecorteFoto);
  $("#btn-cancelar-crop")?.addEventListener("click", cerrarEditorRecorte);
  $("#btn-cerrar-crop")?.addEventListener("click", cerrarEditorRecorte);
  $("#modal-crop-foto .modal-backdrop")?.addEventListener("click", cerrarEditorRecorte);
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
      else if (!$("#modal-crop-foto").classList.contains("hidden")) cerrarEditorRecorte();
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


// ============================================================
// VENDIFY v2.9 — PRODUCTOS COMPACTOS + CATÁLOGO + BARCODE
// ============================================================
const CATALOGO_BASE_V29 = [{"nombre": "Coca-Cola Original 354 ml lata", "marca": "Coca-Cola", "presentacion": "354 ml lata", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Coca-Cola Original 500 ml", "marca": "Coca-Cola", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Coca-Cola Original 1,5 L", "marca": "Coca-Cola", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Coca-Cola Original 2,25 L", "marca": "Coca-Cola", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Coca-Cola Zero 354 ml lata", "marca": "Coca-Cola", "presentacion": "354 ml lata", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Coca-Cola Zero 500 ml", "marca": "Coca-Cola", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Coca-Cola Zero 1,5 L", "marca": "Coca-Cola", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Coca-Cola Zero 2,25 L", "marca": "Coca-Cola", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Sprite Original 354 ml lata", "marca": "Sprite", "presentacion": "354 ml lata", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Sprite Original 500 ml", "marca": "Sprite", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Sprite Original 1,5 L", "marca": "Sprite", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Sprite Original 2,25 L", "marca": "Sprite", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Fanta Naranja 500 ml", "marca": "Fanta", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Fanta Naranja 1,5 L", "marca": "Fanta", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Fanta Naranja 2,25 L", "marca": "Fanta", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pepsi Original 354 ml lata", "marca": "Pepsi", "presentacion": "354 ml lata", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pepsi Original 500 ml", "marca": "Pepsi", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pepsi Original 1,5 L", "marca": "Pepsi", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pepsi Original 2,25 L", "marca": "Pepsi", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pepsi Black 354 ml lata", "marca": "Pepsi", "presentacion": "354 ml lata", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pepsi Black 500 ml", "marca": "Pepsi", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pepsi Black 1,5 L", "marca": "Pepsi", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "7UP Original 500 ml", "marca": "7UP", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "7UP Original 1,5 L", "marca": "7UP", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "7UP Original 2,25 L", "marca": "7UP", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Mirinda Naranja 500 ml", "marca": "Mirinda", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Mirinda Naranja 1,5 L", "marca": "Mirinda", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Mirinda Naranja 2,25 L", "marca": "Mirinda", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Manaos Cola 600 ml", "marca": "Manaos", "presentacion": "600 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Manaos Cola 2,25 L", "marca": "Manaos", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Manaos Cola 3 L", "marca": "Manaos", "presentacion": "3 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Manaos Naranja 600 ml", "marca": "Manaos", "presentacion": "600 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Manaos Naranja 2,25 L", "marca": "Manaos", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Manaos Naranja 3 L", "marca": "Manaos", "presentacion": "3 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Villavicencio Sin gas 500 ml", "marca": "Villavicencio", "presentacion": "500 ml", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Villavicencio Sin gas 1,5 L", "marca": "Villavicencio", "presentacion": "1,5 L", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Villavicencio Sin gas 2 L", "marca": "Villavicencio", "presentacion": "2 L", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Villa del Sur Sin gas 500 ml", "marca": "Villa del Sur", "presentacion": "500 ml", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Villa del Sur Sin gas 1,5 L", "marca": "Villa del Sur", "presentacion": "1,5 L", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Villa del Sur Sin gas 2,25 L", "marca": "Villa del Sur", "presentacion": "2,25 L", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Levité Pomelo 500 ml", "marca": "Levité", "presentacion": "500 ml", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Levité Pomelo 1,5 L", "marca": "Levité", "presentacion": "1,5 L", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Levité Manzana 500 ml", "marca": "Levité", "presentacion": "500 ml", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Levité Manzana 1,5 L", "marca": "Levité", "presentacion": "1,5 L", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Aquarius Pomelo 500 ml", "marca": "Aquarius", "presentacion": "500 ml", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Aquarius Pomelo 1,5 L", "marca": "Aquarius", "presentacion": "1,5 L", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Aquarius Pera 500 ml", "marca": "Aquarius", "presentacion": "500 ml", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Aquarius Pera 1,5 L", "marca": "Aquarius", "presentacion": "1,5 L", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Speed Unlimited 250 ml", "marca": "Speed", "presentacion": "250 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Speed Unlimited 473 ml", "marca": "Speed", "presentacion": "473 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Monster Energy 473 ml", "marca": "Monster", "presentacion": "473 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Monster Mango Loco 473 ml", "marca": "Monster", "presentacion": "473 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Monster Ultra 473 ml", "marca": "Monster", "presentacion": "473 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Red Bull Energy Drink 250 ml", "marca": "Red Bull", "presentacion": "250 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Red Bull Energy Drink 355 ml", "marca": "Red Bull", "presentacion": "355 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Gatorade Manzana 500 ml", "marca": "Gatorade", "presentacion": "500 ml", "categoria": "Isotónicas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Gatorade Manzana 750 ml", "marca": "Gatorade", "presentacion": "750 ml", "categoria": "Isotónicas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Gatorade Cool Blue 500 ml", "marca": "Gatorade", "presentacion": "500 ml", "categoria": "Isotónicas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Gatorade Cool Blue 750 ml", "marca": "Gatorade", "presentacion": "750 ml", "categoria": "Isotónicas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cepita Naranja 200 ml", "marca": "Cepita", "presentacion": "200 ml", "categoria": "Jugos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cepita Naranja 1 L", "marca": "Cepita", "presentacion": "1 L", "categoria": "Jugos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Baggio Multifruta 200 ml", "marca": "Baggio", "presentacion": "200 ml", "categoria": "Jugos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Baggio Multifruta 1 L", "marca": "Baggio", "presentacion": "1 L", "categoria": "Jugos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Tang Naranja sobre", "marca": "Tang", "presentacion": "sobre", "categoria": "Jugos en polvo", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Tang Pomelo sobre", "marca": "Tang", "presentacion": "sobre", "categoria": "Jugos en polvo", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Clight Naranja sobre", "marca": "Clight", "presentacion": "sobre", "categoria": "Jugos en polvo", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Quilmes Clásica 473 ml lata", "marca": "Quilmes", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Quilmes Clásica 710 ml botella", "marca": "Quilmes", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Brahma Clásica 473 ml lata", "marca": "Brahma", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Brahma Clásica 710 ml botella", "marca": "Brahma", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Schneider Clásica 473 ml lata", "marca": "Schneider", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Schneider Clásica 710 ml botella", "marca": "Schneider", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Imperial Clásica 473 ml lata", "marca": "Imperial", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Imperial Clásica 710 ml botella", "marca": "Imperial", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Andes Origen Clásica 473 ml lata", "marca": "Andes Origen", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Andes Origen Clásica 710 ml botella", "marca": "Andes Origen", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Heineken Original 473 ml lata", "marca": "Heineken", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Heineken Original 710 ml botella", "marca": "Heineken", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Stella Artois Original 473 ml lata", "marca": "Stella Artois", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Stella Artois Original 710 ml botella", "marca": "Stella Artois", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Corona Extra 330 ml botella", "marca": "Corona", "presentacion": "330 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Corona Extra 710 ml botella", "marca": "Corona", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Lay's Clásicas chica", "marca": "Lay's", "presentacion": "chica", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Lay's Clásicas mediana", "marca": "Lay's", "presentacion": "mediana", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Lay's Clásicas grande", "marca": "Lay's", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Lay's Jamón Serrano chica", "marca": "Lay's", "presentacion": "chica", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Lay's Jamón Serrano mediana", "marca": "Lay's", "presentacion": "mediana", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Lay's Jamón Serrano grande", "marca": "Lay's", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pehuamar Clásicas chica", "marca": "Pehuamar", "presentacion": "chica", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pehuamar Clásicas mediana", "marca": "Pehuamar", "presentacion": "mediana", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pehuamar Clásicas grande", "marca": "Pehuamar", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Krachitos Clásicas chica", "marca": "Krachitos", "presentacion": "chica", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Krachitos Clásicas mediana", "marca": "Krachitos", "presentacion": "mediana", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Krachitos Clásicas grande", "marca": "Krachitos", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Doritos Queso chico", "marca": "Doritos", "presentacion": "chico", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Doritos Queso mediano", "marca": "Doritos", "presentacion": "mediano", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Doritos Queso grande", "marca": "Doritos", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cheetos Queso chico", "marca": "Cheetos", "presentacion": "chico", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cheetos Queso mediano", "marca": "Cheetos", "presentacion": "mediano", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cheetos Queso grande", "marca": "Cheetos", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "3D Original chico", "marca": "3D", "presentacion": "chico", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "3D Original mediano", "marca": "3D", "presentacion": "mediano", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "3D Original grande", "marca": "3D", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Chizitos Queso chico", "marca": "Chizitos", "presentacion": "chico", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Chizitos Queso mediano", "marca": "Chizitos", "presentacion": "mediano", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Chizitos Queso grande", "marca": "Chizitos", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Maní Salado 50 g", "marca": "Maní", "presentacion": "50 g", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Maní Salado 100 g", "marca": "Maní", "presentacion": "100 g", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Maní Salado 250 g", "marca": "Maní", "presentacion": "250 g", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Palitos Salados 80 g", "marca": "Palitos", "presentacion": "80 g", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Palitos Salados 150 g", "marca": "Palitos", "presentacion": "150 g", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Guaymallén Chocolate simple", "marca": "Guaymallén", "presentacion": "simple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Guaymallén Chocolate triple", "marca": "Guaymallén", "presentacion": "triple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Guaymallén Blanco simple", "marca": "Guaymallén", "presentacion": "simple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Guaymallén Blanco triple", "marca": "Guaymallén", "presentacion": "triple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Jorgito Chocolate simple", "marca": "Jorgito", "presentacion": "simple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Jorgelin Chocolate triple", "marca": "Jorgelin", "presentacion": "triple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Terrabusi Tita unidad", "marca": "Terrabusi", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Terrabusi Rhodesia unidad", "marca": "Terrabusi", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Havanna Chocolate unidad", "marca": "Havanna", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Havanna 70% Cacao unidad", "marca": "Havanna", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cachafaz Chocolate unidad", "marca": "Cachafaz", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Rasta Negro unidad", "marca": "Rasta", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Rasta Blanco unidad", "marca": "Rasta", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Milka Chocolate con leche 55 g", "marca": "Milka", "presentacion": "55 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Milka Chocolate con leche 100 g", "marca": "Milka", "presentacion": "100 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Milka Oreo 55 g", "marca": "Milka", "presentacion": "55 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Milka Oreo 100 g", "marca": "Milka", "presentacion": "100 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cofler Block 38 g", "marca": "Cofler", "presentacion": "38 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cofler Block 110 g", "marca": "Cofler", "presentacion": "110 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Águila Chocolate 60 g", "marca": "Águila", "presentacion": "60 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Shot Maní 35 g", "marca": "Shot", "presentacion": "35 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Shot Maní 90 g", "marca": "Shot", "presentacion": "90 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Bon o Bon Bombón unidad", "marca": "Bon o Bon", "presentacion": "unidad", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Bon o Bon Bombón pack x6", "marca": "Bon o Bon", "presentacion": "pack x6", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Ferrero Rocher Bombones pack x3", "marca": "Ferrero Rocher", "presentacion": "pack x3", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Ferrero Rocher Bombones pack x8", "marca": "Ferrero Rocher", "presentacion": "pack x8", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Beldent Menta pack", "marca": "Beldent", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Beldent Frutilla pack", "marca": "Beldent", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Topline Menta pack", "marca": "Topline", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Topline Seven pack", "marca": "Topline", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Halls Menta pack", "marca": "Halls", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Halls Strong pack", "marca": "Halls", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Mentos Menta rollo", "marca": "Mentos", "presentacion": "rollo", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Mentos Fruta rollo", "marca": "Mentos", "presentacion": "rollo", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Sugus Caramelos unidad", "marca": "Sugus", "presentacion": "unidad", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Sugus Caramelos bolsa", "marca": "Sugus", "presentacion": "bolsa", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Flynn Paff Caramelo unidad", "marca": "Flynn Paff", "presentacion": "unidad", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Chupetín Pico Dulce unidad", "marca": "Chupetín", "presentacion": "unidad", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Rocklets Confites 35 g", "marca": "Rocklets", "presentacion": "35 g", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Rocklets Confites 80 g", "marca": "Rocklets", "presentacion": "80 g", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Oreo Original 118 g", "marca": "Oreo", "presentacion": "118 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Oreo Original 182 g", "marca": "Oreo", "presentacion": "182 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pepitos Chips 118 g", "marca": "Pepitos", "presentacion": "118 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pepitos Chips 357 g", "marca": "Pepitos", "presentacion": "357 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Chocolinas Chocolate 170 g", "marca": "Chocolinas", "presentacion": "170 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Chocolinas Chocolate 250 g", "marca": "Chocolinas", "presentacion": "250 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Sonrisas Frutilla 118 g", "marca": "Sonrisas", "presentacion": "118 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Merengadas Original 93 g", "marca": "Merengadas", "presentacion": "93 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Melitas Miel 170 g", "marca": "Melitas", "presentacion": "170 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Don Satur Bizcochos salados 200 g", "marca": "Don Satur", "presentacion": "200 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Don Satur Bizcochos dulces 200 g", "marca": "Don Satur", "presentacion": "200 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Criollitas Original 100 g", "marca": "Criollitas", "presentacion": "100 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Criollitas Original 300 g", "marca": "Criollitas", "presentacion": "300 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Maná Vainilla 145 g", "marca": "Maná", "presentacion": "145 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Terrabusi Variedad 300 g", "marca": "Terrabusi", "presentacion": "300 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Marlboro Box 20 unidades", "marca": "Marlboro", "presentacion": "20 unidades", "categoria": "Cigarrillos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 3}, {"nombre": "Philip Morris Box 20 unidades", "marca": "Philip Morris", "presentacion": "20 unidades", "categoria": "Cigarrillos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 3}, {"nombre": "Lucky Strike Box 20 unidades", "marca": "Lucky Strike", "presentacion": "20 unidades", "categoria": "Cigarrillos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 3}, {"nombre": "Camel Box 20 unidades", "marca": "Camel", "presentacion": "20 unidades", "categoria": "Cigarrillos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 3}, {"nombre": "Chesterfield Box 20 unidades", "marca": "Chesterfield", "presentacion": "20 unidades", "categoria": "Cigarrillos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 3}, {"nombre": "BIC Encendedor unidad", "marca": "BIC", "presentacion": "unidad", "categoria": "Accesorios", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pilas AA Alcalinas pack x2", "marca": "Pilas AA", "presentacion": "pack x2", "categoria": "Accesorios", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pilas AA Alcalinas pack x4", "marca": "Pilas AA", "presentacion": "pack x4", "categoria": "Accesorios", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pilas AAA Alcalinas pack x2", "marca": "Pilas AAA", "presentacion": "pack x2", "categoria": "Accesorios", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pilas AAA Alcalinas pack x4", "marca": "Pilas AAA", "presentacion": "pack x4", "categoria": "Accesorios", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Serenísima Leche entera 1 L", "marca": "La Serenísima", "presentacion": "1 L", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Serenísima Leche descremada 1 L", "marca": "La Serenísima", "presentacion": "1 L", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Milkaut Leche entera 1 L", "marca": "Milkaut", "presentacion": "1 L", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Yogur Bebible 190 ml", "marca": "Yogur", "presentacion": "190 ml", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Yogur Bebible 900 ml", "marca": "Yogur", "presentacion": "900 ml", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Yogur Firme 120 g", "marca": "Yogur", "presentacion": "120 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Yogur Firme 190 g", "marca": "Yogur", "presentacion": "190 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Manteca 100 g", "marca": "Manteca", "presentacion": "100 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Manteca 200 g", "marca": "Manteca", "presentacion": "200 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Queso crema 190 g", "marca": "Queso crema", "presentacion": "190 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Queso crema 300 g", "marca": "Queso crema", "presentacion": "300 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Queso rallado 40 g", "marca": "Queso rallado", "presentacion": "40 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Queso rallado 120 g", "marca": "Queso rallado", "presentacion": "120 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Molinos Ala Arroz largo fino 500 g", "marca": "Molinos Ala", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Molinos Ala Arroz largo fino 1 kg", "marca": "Molinos Ala", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Gallo Arroz 500 g", "marca": "Gallo", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Gallo Arroz 1 kg", "marca": "Gallo", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Lucchetti Fideos Spaghetti 500 g", "marca": "Lucchetti", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Matarazzo Fideos Tallarín 500 g", "marca": "Matarazzo", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Matarazzo Fideos Tirabuzón 500 g", "marca": "Matarazzo", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Favorita Harina 000 1 kg", "marca": "Favorita", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pureza Harina 0000 1 kg", "marca": "Pureza", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Chango Azúcar 1 kg", "marca": "Chango", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Ledesma Azúcar 1 kg", "marca": "Ledesma", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Celusal Sal fina 500 g", "marca": "Celusal", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Dos Anclas Sal fina 500 g", "marca": "Dos Anclas", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Natura Aceite girasol 900 ml", "marca": "Natura", "presentacion": "900 ml", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Natura Aceite girasol 1,5 L", "marca": "Natura", "presentacion": "1,5 L", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cañuelas Aceite girasol 900 ml", "marca": "Cañuelas", "presentacion": "900 ml", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cañuelas Aceite girasol 1,5 L", "marca": "Cañuelas", "presentacion": "1,5 L", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Campagnola Puré de tomate 520 g", "marca": "La Campagnola", "presentacion": "520 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Arcor Puré de tomate 520 g", "marca": "Arcor", "presentacion": "520 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Arcor Choclo en lata 300 g", "marca": "Arcor", "presentacion": "300 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Campagnola Arvejas 300 g", "marca": "La Campagnola", "presentacion": "300 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Knorr Caldo pack", "marca": "Knorr", "presentacion": "pack", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Alicante Orégano 25 g", "marca": "Alicante", "presentacion": "25 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Alicante Pimentón 25 g", "marca": "Alicante", "presentacion": "25 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Playadito Yerba mate 500 g", "marca": "Playadito", "presentacion": "500 g", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Playadito Yerba mate 1 kg", "marca": "Playadito", "presentacion": "1 kg", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Taragüi Yerba mate 500 g", "marca": "Taragüi", "presentacion": "500 g", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Taragüi Yerba mate 1 kg", "marca": "Taragüi", "presentacion": "1 kg", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Rosamonte Yerba mate 500 g", "marca": "Rosamonte", "presentacion": "500 g", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Rosamonte Yerba mate 1 kg", "marca": "Rosamonte", "presentacion": "1 kg", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Amanda Yerba mate 500 g", "marca": "Amanda", "presentacion": "500 g", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Amanda Yerba mate 1 kg", "marca": "Amanda", "presentacion": "1 kg", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Mañanita Yerba mate 500 g", "marca": "Mañanita", "presentacion": "500 g", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Mañanita Yerba mate 1 kg", "marca": "Mañanita", "presentacion": "1 kg", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Virginia Café molido 250 g", "marca": "La Virginia", "presentacion": "250 g", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Virginia Café molido 500 g", "marca": "La Virginia", "presentacion": "500 g", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Nescafé Café instantáneo 100 g", "marca": "Nescafé", "presentacion": "100 g", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Nescafé Café instantáneo 170 g", "marca": "Nescafé", "presentacion": "170 g", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Virginia Té 25 saquitos", "marca": "La Virginia", "presentacion": "25 saquitos", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Virginia Té 50 saquitos", "marca": "La Virginia", "presentacion": "50 saquitos", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cabrales Café molido 250 g", "marca": "Cabrales", "presentacion": "250 g", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Arcor Mermelada frutilla 454 g", "marca": "Arcor", "presentacion": "454 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Arcor Mermelada durazno 454 g", "marca": "Arcor", "presentacion": "454 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Serenísima Dulce de leche 400 g", "marca": "La Serenísima", "presentacion": "400 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Serenísima Dulce de leche 1 kg", "marca": "La Serenísima", "presentacion": "1 kg", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Nesquik Cacao 180 g", "marca": "Nesquik", "presentacion": "180 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Nesquik Cacao 360 g", "marca": "Nesquik", "presentacion": "360 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Quaker Avena 300 g", "marca": "Quaker", "presentacion": "300 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Quaker Avena 500 g", "marca": "Quaker", "presentacion": "500 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Magistral Detergente 300 ml", "marca": "Magistral", "presentacion": "300 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Magistral Detergente 500 ml", "marca": "Magistral", "presentacion": "500 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Magistral Detergente 750 ml", "marca": "Magistral", "presentacion": "750 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Ala Detergente 500 ml", "marca": "Ala", "presentacion": "500 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Ayudín Lavandina 1 L", "marca": "Ayudín", "presentacion": "1 L", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Ayudín Lavandina 2 L", "marca": "Ayudín", "presentacion": "2 L", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Ayudín Lavandina 4 L", "marca": "Ayudín", "presentacion": "4 L", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Poett Limpiador 900 ml", "marca": "Poett", "presentacion": "900 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cif Crema 375 ml", "marca": "Cif", "presentacion": "375 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Cif Crema 750 ml", "marca": "Cif", "presentacion": "750 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Skip Jabón líquido 800 ml", "marca": "Skip", "presentacion": "800 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Skip Jabón líquido 3 L", "marca": "Skip", "presentacion": "3 L", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Ala Jabón en polvo 400 g", "marca": "Ala", "presentacion": "400 g", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Ala Jabón en polvo 800 g", "marca": "Ala", "presentacion": "800 g", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Comfort Suavizante 900 ml", "marca": "Comfort", "presentacion": "900 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Vanish Quitamanchas 450 ml", "marca": "Vanish", "presentacion": "450 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Virulana Esponja unidad", "marca": "Virulana", "presentacion": "unidad", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Patito Bolsas residuos pack", "marca": "Patito", "presentacion": "pack", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Colgate Pasta dental 70 g", "marca": "Colgate", "presentacion": "70 g", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Colgate Pasta dental 90 g", "marca": "Colgate", "presentacion": "90 g", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Oral-B Cepillo dental unidad", "marca": "Oral-B", "presentacion": "unidad", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Dove Jabón 90 g", "marca": "Dove", "presentacion": "90 g", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Rexona Desodorante aerosol 150 ml", "marca": "Rexona", "presentacion": "150 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Axe Desodorante aerosol 150 ml", "marca": "Axe", "presentacion": "150 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Sedal Shampoo 190 ml", "marca": "Sedal", "presentacion": "190 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Sedal Shampoo 340 ml", "marca": "Sedal", "presentacion": "340 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pantene Shampoo 200 ml", "marca": "Pantene", "presentacion": "200 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pantene Shampoo 400 ml", "marca": "Pantene", "presentacion": "400 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Elite Papel higiénico pack x4", "marca": "Elite", "presentacion": "pack x4", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Elite Papel higiénico pack x6", "marca": "Elite", "presentacion": "pack x6", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Higienol Papel higiénico pack x4", "marca": "Higienol", "presentacion": "pack x4", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Sussex Rollo cocina pack x2", "marca": "Sussex", "presentacion": "pack x2", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Always Toallitas pack", "marca": "Always", "presentacion": "pack", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Gillette Máquina afeitar unidad", "marca": "Gillette", "presentacion": "unidad", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Hellmann's Mayonesa 250 g", "marca": "Hellmann's", "presentacion": "250 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Hellmann's Mayonesa 500 g", "marca": "Hellmann's", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Natura Mayonesa 250 g", "marca": "Natura", "presentacion": "250 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Natura Mayonesa 500 g", "marca": "Natura", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Savora Mostaza 250 g", "marca": "Savora", "presentacion": "250 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Danica Ketchup 250 g", "marca": "Danica", "presentacion": "250 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "La Campagnola Atún 170 g", "marca": "La Campagnola", "presentacion": "170 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Arcor Duraznos en lata 820 g", "marca": "Arcor", "presentacion": "820 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Dos Anclas Vinagre 500 ml", "marca": "Dos Anclas", "presentacion": "500 ml", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Dos Anclas Vinagre 1 L", "marca": "Dos Anclas", "presentacion": "1 L", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pan Lactal chico", "marca": "Pan", "presentacion": "chico", "categoria": "Panadería", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pan Lactal grande", "marca": "Pan", "presentacion": "grande", "categoria": "Panadería", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Pan Hamburguesa pack", "marca": "Pan", "presentacion": "pack", "categoria": "Panadería", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5}, {"nombre": "Papas fritas Congeladas 400 g", "marca": "Papas fritas", "presentacion": "400 g", "categoria": "Congelados", "catalogos": ["minimercado"], "stockMinimo": 5}, {"nombre": "Papas fritas Congeladas 1 kg", "marca": "Papas fritas", "presentacion": "1 kg", "categoria": "Congelados", "catalogos": ["minimercado"], "stockMinimo": 5}, {"nombre": "Helado Pote 500 g", "marca": "Helado", "presentacion": "500 g", "categoria": "Helados", "catalogos": ["minimercado"], "stockMinimo": 5}, {"nombre": "Helado Pote 1 kg", "marca": "Helado", "presentacion": "1 kg", "categoria": "Helados", "catalogos": ["minimercado"], "stockMinimo": 5}, {"nombre": "Helado Palito unidad", "marca": "Helado", "presentacion": "unidad", "categoria": "Helados", "catalogos": ["minimercado"], "stockMinimo": 5}];
let catalogoTipoV29 = "kiosco";
let catalogoSeleccionV29 = new Set();
let scannerModeV29 = null;
let scannerControlsV29 = null;
let scannerReaderV29 = null;
let scannerLastCodeV29 = "";
let scannerLastAtV29 = 0;
let scannerTrackVPro = null;
let scannerNativeDetectorVPro = null;
let scannerNativeLoopVPro = null;
let scannerNativeBusyVPro = false;
let scannerAssistTimerVPro = null;
let scannerAutoZoomTimerVPro = null;
let scannerOpenedAtVPro = 0;
let scannerLastSuccessAtVPro = 0;
let scannerCurrentZoomVPro = 1;
let scannerZoomCapsVPro = null;
let scannerTorchOnVPro = false;
let scannerTorchSupportedVPro = false;
let scannerFocusSupportedVPro = false;
let scannerProfileVPro = null;
let scannerEngineSuccessVPro = null;

const SCANNER_PROFILE_KEY_VPRO = "vendify_scanner_profile_v2";

function cargarPerfilScannerVPro() {
  if (scannerProfileVPro) return scannerProfileVPro;

  try {
    scannerProfileVPro = JSON.parse(localStorage.getItem(SCANNER_PROFILE_KEY_VPRO) || "null");
  } catch {
    scannerProfileVPro = null;
  }

  if (!scannerProfileVPro || typeof scannerProfileVPro !== "object") {
    scannerProfileVPro = {
      successes: 0,
      preferredZoom: 1,
      avgReadMs: null,
      engines: { native: 0, zxing: 0, capture: 0 },
      formats: {},
    };
  }

  return scannerProfileVPro;
}

function guardarPerfilScannerVPro() {
  try {
    localStorage.setItem(
      SCANNER_PROFILE_KEY_VPRO,
      JSON.stringify(cargarPerfilScannerVPro())
    );
  } catch {}
}

function registrarExitoScannerVPro({ engine = "zxing", format = "", zoom = null } = {}) {
  const profile = cargarPerfilScannerVPro();
  const elapsed = Math.max(0, Date.now() - scannerOpenedAtVPro);

  profile.successes = Number(profile.successes || 0) + 1;
  profile.engines ||= {};
  profile.engines[engine] = Number(profile.engines[engine] || 0) + 1;

  if (format) {
    profile.formats ||= {};
    profile.formats[format] = Number(profile.formats[format] || 0) + 1;
  }

  if (Number.isFinite(elapsed) && elapsed > 0 && elapsed < 30000) {
    profile.avgReadMs =
      profile.avgReadMs == null
        ? elapsed
        : Math.round(profile.avgReadMs * 0.8 + elapsed * 0.2);
  }

  const z = Number(zoom ?? scannerCurrentZoomVPro);
  if (Number.isFinite(z) && z >= 1) {
    profile.preferredZoom = Number(
      (
        Number(profile.preferredZoom || 1) * 0.72 +
        z * 0.28
      ).toFixed(2)
    );
  }

  scannerEngineSuccessVPro = engine;
  scannerLastSuccessAtVPro = Date.now();
  guardarPerfilScannerVPro();
  actualizarTextoAdaptativoVPro();
}

function actualizarTextoAdaptativoVPro() {
  const el = $("#scanner-adaptive-text-vpro");
  if (!el) return;

  const p = cargarPerfilScannerVPro();

  if (!p.successes) {
    el.textContent = "Optimizando para este dispositivo";
    return;
  }

  const avg = p.avgReadMs ? `${(p.avgReadMs / 1000).toFixed(1)} s` : "—";
  el.textContent = `Perfil adaptativo · ${p.successes} lecturas · promedio ${avg}`;
}

function actualizarEngineScannerVPro(texto) {
  const el = $("#scanner-engine-vpro");
  if (el) el.textContent = texto || "Auto";
}

function mostrarHintScannerVPro(texto = "", tipo = "info") {
  const el = $("#scanner-hint-vpro");
  if (!el) return;

  if (!texto) {
    el.classList.add("hidden");
    el.textContent = "";
    el.dataset.type = "";
    return;
  }

  el.textContent = texto;
  el.dataset.type = tipo;
  el.classList.remove("hidden");
}

function obtenerTrackScannerVPro() {
  const video = $("#scanner-video-v29");
  const track = video?.srcObject?.getVideoTracks?.()?.[0] || null;
  scannerTrackVPro = track;
  return track;
}

async function configurarTrackScannerVPro() {
  const track = obtenerTrackScannerVPro();
  if (!track) return;

  let caps = {};
  try {
    caps = track.getCapabilities?.() || {};
  } catch {}

  let settings = {};
  try {
    settings = track.getSettings?.() || {};
  } catch {}

  const resolution = $("#scanner-resolution-badge-vpro");
  if (resolution) {
    const w = Number(settings.width || 0);
    const h = Number(settings.height || 0);
    resolution.textContent =
      w >= 1800 ? "FHD" :
      w >= 1200 ? "HD+" :
      w >= 700 ? "HD" : "CAM";
  }

  scannerFocusSupportedVPro =
    Array.isArray(caps.focusMode) &&
    caps.focusMode.includes("continuous");

  const focusBadge = $("#scanner-focus-badge-vpro");
  if (focusBadge) {
    focusBadge.textContent = scannerFocusSupportedVPro ? "AF continuo" : "AF";
  }

  if (scannerFocusSupportedVPro) {
    try {
      await track.applyConstraints({
        advanced: [{ focusMode: "continuous" }]
      });
    } catch (err) {
      console.debug("[Scanner Pro] focusMode no aplicable:", err);
    }
  }

  scannerTorchSupportedVPro = Boolean(caps.torch);
  $("#btn-scanner-torch-vpro")?.classList.toggle(
    "hidden",
    !scannerTorchSupportedVPro
  );

  if (caps.zoom && Number.isFinite(Number(caps.zoom.min))) {
    scannerZoomCapsVPro = {
      min: Number(caps.zoom.min),
      max: Number(caps.zoom.max),
      step: Number(caps.zoom.step || 0.1),
    };

    $("#scanner-zoom-wrap-vpro")?.classList.remove("hidden");

    const profile = cargarPerfilScannerVPro();
    const preferred = Math.max(
      scannerZoomCapsVPro.min,
      Math.min(
        Math.min(scannerZoomCapsVPro.max, 2.2),
        Number(profile.preferredZoom || settings.zoom || 1)
      )
    );

    await aplicarZoomScannerVPro(preferred, { silencioso: true });
  } else {
    scannerZoomCapsVPro = null;
    $("#scanner-zoom-wrap-vpro")?.classList.add("hidden");
    scannerCurrentZoomVPro = 1;
    actualizarZoomUIVPro();
  }
}

function actualizarZoomUIVPro() {
  const el = $("#scanner-zoom-value-vpro");
  if (el) el.textContent = `${Number(scannerCurrentZoomVPro || 1).toFixed(1)}×`;
}

async function aplicarZoomScannerVPro(value, { silencioso = false } = {}) {
  if (!scannerTrackVPro || !scannerZoomCapsVPro) return;

  const min = scannerZoomCapsVPro.min;
  const max = Math.min(scannerZoomCapsVPro.max, 3);
  const z = Math.max(min, Math.min(max, Number(value)));

  try {
    await scannerTrackVPro.applyConstraints({
      advanced: [{ zoom: z }]
    });
    scannerCurrentZoomVPro = z;
    actualizarZoomUIVPro();

    if (!silencioso) {
      mostrarHintScannerVPro(`Zoom ${z.toFixed(1)}×`, "info");
      setTimeout(() => {
        if ($("#scanner-hint-vpro")?.textContent?.startsWith("Zoom")) {
          mostrarHintScannerVPro("");
        }
      }, 900);
    }
  } catch (err) {
    console.debug("[Scanner Pro] zoom no aplicable:", err);
  }
}

async function cambiarZoomScannerVPro(delta) {
  if (!scannerZoomCapsVPro) return;
  const step = Math.max(0.1, scannerZoomCapsVPro.step || 0.1);
  await aplicarZoomScannerVPro(scannerCurrentZoomVPro + delta * step * 2);
}

async function toggleTorchScannerVPro() {
  if (!scannerTrackVPro || !scannerTorchSupportedVPro) return;

  scannerTorchOnVPro = !scannerTorchOnVPro;

  try {
    await scannerTrackVPro.applyConstraints({
      advanced: [{ torch: scannerTorchOnVPro }]
    });

    const btn = $("#btn-scanner-torch-vpro");
    btn?.classList.toggle("active", scannerTorchOnVPro);
    if (btn) {
      const small = btn.querySelector("small");
      if (small) small.textContent = scannerTorchOnVPro ? "Apagar" : "Linterna";
    }
  } catch (err) {
    scannerTorchOnVPro = false;
    console.debug("[Scanner Pro] torch no aplicable:", err);
  }
}

async function iniciarDetectorNativoVPro() {
  if (!("BarcodeDetector" in window)) {
    scannerNativeDetectorVPro = null;
    return false;
  }

  try {
    const wanted = [
      "ean_13", "ean_8", "upc_a", "upc_e",
      "code_128", "code_39", "itf", "codabar"
    ];

    let supported = wanted;

    if (typeof BarcodeDetector.getSupportedFormats === "function") {
      const browserFormats = await BarcodeDetector.getSupportedFormats();
      supported = wanted.filter((f) => browserFormats.includes(f));
    }

    if (!supported.length) return false;

    scannerNativeDetectorVPro = new BarcodeDetector({ formats: supported });
    actualizarEngineScannerVPro("Nativo + ZXing");

    const loop = async () => {
      if (
        !scannerNativeDetectorVPro ||
        scannerNativeBusyVPro ||
        $("#modal-scanner-v29")?.classList.contains("hidden")
      ) {
        scannerNativeLoopVPro = requestAnimationFrame(loop);
        return;
      }

      const video = $("#scanner-video-v29");

      if (video?.readyState >= 2 && video.videoWidth > 0) {
        scannerNativeBusyVPro = true;

        try {
          const codes = await scannerNativeDetectorVPro.detect(video);
          const hit = codes?.find((c) => c?.rawValue);

          if (hit?.rawValue) {
            procesarCodigoV29(hit.rawValue, {
              engine: "native",
              format: hit.format || "",
            });
          }
        } catch {
          // El detector nativo puede fallar en frames durante autofocus.
        } finally {
          scannerNativeBusyVPro = false;
        }
      }

      scannerNativeLoopVPro = requestAnimationFrame(loop);
    };

    scannerNativeLoopVPro = requestAnimationFrame(loop);
    return true;
  } catch (err) {
    console.debug("[Scanner Pro] BarcodeDetector no disponible:", err);
    scannerNativeDetectorVPro = null;
    return false;
  }
}

function detenerDetectorNativoVPro() {
  if (scannerNativeLoopVPro) {
    cancelAnimationFrame(scannerNativeLoopVPro);
  }
  scannerNativeLoopVPro = null;
  scannerNativeDetectorVPro = null;
  scannerNativeBusyVPro = false;
}

function iniciarAsistenciaScannerVPro() {
  clearInterval(scannerAssistTimerVPro);
  clearInterval(scannerAutoZoomTimerVPro);

  scannerAssistTimerVPro = setInterval(() => {
    const video = $("#scanner-video-v29");
    if (!video || video.readyState < 2 || video.videoWidth < 2) return;

    try {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 48;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, c.width, c.height);

      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let lum = 0;

      for (let i = 0; i < px.length; i += 16) {
        lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      }

      const samples = px.length / 16;
      const avg = samples ? lum / samples : 120;

      if (avg < 52 && scannerTorchSupportedVPro && !scannerTorchOnVPro) {
        mostrarHintScannerVPro("Hay poca luz · probá encender la linterna", "warning");
      } else if (
        $("#scanner-hint-vpro")?.textContent?.includes("poca luz")
      ) {
        mostrarHintScannerVPro("");
      }
    } catch {}
  }, 1300);

  scannerAutoZoomTimerVPro = setInterval(async () => {
    if (
      !scannerZoomCapsVPro ||
      scannerLastSuccessAtVPro >= scannerOpenedAtVPro ||
      $("#modal-scanner-v29")?.classList.contains("hidden")
    ) {
      return;
    }

    const elapsed = Date.now() - scannerOpenedAtVPro;

    if (elapsed < 2600) return;

    const maxAdaptive = Math.min(scannerZoomCapsVPro.max, 1.8);

    if (scannerCurrentZoomVPro < maxAdaptive - 0.05) {
      await aplicarZoomScannerVPro(
        Math.min(maxAdaptive, scannerCurrentZoomVPro + 0.2),
        { silencioso: true }
      );

      const status = $("#scanner-status-v29");
      if (status) {
        status.textContent =
          `Buscando · autozoom ${scannerCurrentZoomVPro.toFixed(1)}×`;
      }
    }
  }, 2200);
}

function detenerAsistenciaScannerVPro() {
  clearInterval(scannerAssistTimerVPro);
  clearInterval(scannerAutoZoomTimerVPro);
  scannerAssistTimerVPro = null;
  scannerAutoZoomTimerVPro = null;
}

async function probarCanvasConLectoresVPro(canvas, label = "capture") {
  // 1) Detector nativo.
  if ("BarcodeDetector" in window) {
    try {
      const detector =
        scannerNativeDetectorVPro ||
        new BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"]
        });

      const codes = await detector.detect(canvas);
      const hit = codes?.find((c) => c?.rawValue);

      if (hit?.rawValue) {
        await procesarCodigoV29(hit.rawValue, {
          engine: label,
          format: hit.format || "",
        });
        return true;
      }
    } catch {}
  }

  // 2) ZXing sobre imagen fija.
  try {
    const reader = new ZXingBrowser.BrowserMultiFormatReader();
    if (typeof reader.decodeFromCanvas === "function") {
      const result = await reader.decodeFromCanvas(canvas);
      if (result?.getText?.()) {
        await procesarCodigoV29(result.getText(), {
          engine: label,
          format: result.getBarcodeFormat?.()?.toString?.() || "",
        });
        return true;
      }
    }
  } catch {}

  return false;
}

function crearCanvasFrameVPro({ contrast = 1, threshold = null, crop = 0.04 } = {}) {
  const video = $("#scanner-video-v29");
  if (!video?.videoWidth || !video?.videoHeight) return null;

  const sx = Math.round(video.videoWidth * crop);
  const sy = Math.round(video.videoHeight * crop);
  const sw = Math.round(video.videoWidth * (1 - crop * 2));
  const sh = Math.round(video.videoHeight * (1 - crop * 2));

  const maxW = 1600;
  const scale = Math.min(1, maxW / sw);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(
    video,
    sx, sy, sw, sh,
    0, 0, canvas.width, canvas.height
  );

  if (contrast !== 1 || threshold != null) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      gray = (gray - 128) * contrast + 128;
      gray = Math.max(0, Math.min(255, gray));

      if (threshold != null) {
        gray = gray >= threshold ? 255 : 0;
      }

      d[i] = d[i + 1] = d[i + 2] = gray;
    }

    ctx.putImageData(img, 0, 0);
  }

  return canvas;
}

async function capturarYAnalizarScannerVPro() {
  const btn = $("#btn-scanner-capture-vpro");
  const status = $("#scanner-status-v29");

  if (!$("#scanner-video-v29")?.videoWidth) {
    mostrarHintScannerVPro("La cámara todavía no está lista", "warning");
    return;
  }

  if (btn) btn.disabled = true;
  setScannerAnimandoV29(false);
  if (status) status.textContent = "Analizando captura con varios filtros…";

  try {
    const variants = [
      { contrast: 1, threshold: null, crop: 0.02 },
      { contrast: 1.45, threshold: null, crop: 0.04 },
      { contrast: 1.8, threshold: null, crop: 0.07 },
      { contrast: 1.25, threshold: 125, crop: 0.04 },
      { contrast: 1.25, threshold: 155, crop: 0.04 },
    ];

    for (const opts of variants) {
      const canvas = crearCanvasFrameVPro(opts);
      if (!canvas) continue;

      const ok = await probarCanvasConLectoresVPro(canvas, "capture");
      if (ok) return;
    }

    if (status) status.textContent = "No pude leer esa captura";
    mostrarHintScannerVPro(
      "Probá estirar el envase, cambiar el ángulo o usar un poco de zoom",
      "warning"
    );
    navigator.vibrate?.([35, 45, 35]);
    setScannerAnimandoV29(true);
  } finally {
    if (btn) btn.disabled = false;
  }
}


let usbBufferV29 = "";
let usbStartedAtV29 = 0;
let usbLastAtV29 = 0;


// ============================================================
// Stock inteligente por producto / sucursal
// ============================================================

let stockInteligente = new Map();

function obtenerStockInteligente(producto) {
  if (!producto?.id) return null;
  return stockInteligente.get(producto.id) || null;
}

function esSinStock(producto) {
  return Number(producto?.stock || 0) <= 0;
}

function esStockBajoInteligente(producto) {
  const stock = Number(producto?.stock || 0);
  if (stock <= 0) return false;

  const info = obtenerStockInteligente(producto);

  // Si todavía no existe el RPC/migración, mantener compatibilidad
  // con el valor antiguo para no romper la interfaz.
  if (!info) {
    return stock <= Number(producto?.stockMinimo ?? 0);
  }

  return Boolean(info.esBajo);
}

function textoStockInteligente(producto) {
  const info = obtenerStockInteligente(producto);

  if (!info) {
    return `Stock actual: ${Number(producto?.stock || 0)}`;
  }

  const stock = Number(producto?.stock || 0);

  if (stock <= 0) {
    return "Sin stock";
  }

  if (!info.tieneHistorial) {
    return "Sin historial suficiente de ventas";
  }

  const dias =
    info.diasCobertura == null
      ? "—"
      : `${Number(info.diasCobertura).toFixed(1)} días`;

  return [
    `Stock bajo calculado: ≤ ${info.stockBajo}`,
    `Venta estimada: ${Number(info.promedioDiario || 0).toFixed(2)}/día`,
    `Cobertura actual: ${dias}`,
  ].join(" · ");
}

async function cargarStockInteligente() {
  stockInteligente = new Map();

  if (!appContext?.branch?.id) return;

  const { data, error } = await supabaseClient.rpc(
    "obtener_stock_inteligente_sucursal",
    { p_sucursal_id: appContext.branch.id }
  );

  if (error) {
    // Fallback silencioso: la app sigue funcionando aunque el usuario
    // todavía no haya ejecutado la migración.
    console.warn("[Vendify] Stock inteligente no disponible:", error.message);
    return;
  }

  (data || []).forEach((row) => {
    stockInteligente.set(row.producto_id, {
      vendidos7d: Number(row.vendidos_7d || 0),
      vendidos30d: Number(row.vendidos_30d || 0),
      promedioDiario: Number(row.promedio_diario || 0),
      stockBajo: Number(row.stock_bajo_calculado || 0),
      diasCobertura:
        row.dias_cobertura == null ? null : Number(row.dias_cobertura),
      reposicion7d: Number(row.reposicion_sugerida_7d || 0),
      estado: row.estado || "sin_datos",
      tieneHistorial: Boolean(row.tiene_historial),
      esBajo: row.estado === "bajo",
    });
  });
}

function actualizarStockSmartForm(producto = null) {
  const value = $("#stock-smart-form-value");
  const hint = $("#stock-smart-form-hint");
  if (!value || !hint) return;

  if (!producto) {
    value.textContent = "Se calculará según las ventas";
    hint.textContent =
      "Cuando el producto tenga historial, Vendify calculará su umbral automáticamente.";
    return;
  }

  const info = obtenerStockInteligente(producto);

  if (!info?.tieneHistorial) {
    value.textContent = "Todavía sin historial";
    hint.textContent =
      "El umbral aparecerá cuando existan ventas suficientes del producto.";
    return;
  }

  value.textContent = `≤ ${info.stockBajo} unidades`;

  const dias =
    info.diasCobertura == null
      ? "—"
      : `${Number(info.diasCobertura).toFixed(1)} días`;

  hint.textContent =
    `${Number(info.promedioDiario || 0).toFixed(2)} unidades/día · ` +
    `cobertura actual ${dias}`;
}

function actualizarFiltroRapidoStockUI() {
  const select = $("#filtro-stock-v29");
  const chip = $("#filtro-activo");
  const text = $("#filtro-activo-texto");
  const value = select?.value || "";

  $("#stat-bajo-card")?.classList.toggle(
    "active",
    filtroStockBajo || value === "bajo"
  );

  $("#stat-sin-card")?.classList.toggle(
    "active",
    value === "sin"
  );

  const activo = filtroStockBajo || value === "bajo" || value === "sin";
  chip?.classList.toggle("hidden", !activo);

  if (text) {
    text.textContent =
      value === "sin"
        ? "Mostrando productos sin stock"
        : "Mostrando productos con stock bajo inteligente";
  }
}

function filtrarSinStockRapido() {
  const select = $("#filtro-stock-v29");
  if (!select) return;

  filtroStockBajo = false;
  select.value = select.value === "sin" ? "" : "sin";
  actualizarFiltroRapidoStockUI();
  renderGrid();

  if (select.value === "sin") {
    mostrarToast("Filtrando productos sin stock", "info");
  }
}


function mapearProductoDB(row) {
  return {
    id: row.id, nombre: row.nombre, marca: row.marca || "", presentacion: row.presentacion || "",
    codigoBarras: row.codigo_barras || "", categoria: row.categoria || "",
    precioCompra: row.precio_compra || 0, precioVenta: row.precio_venta || 0,
    stock: row.stock || 0, stockMinimo: row.stock_minimo ?? 5, foto: row.foto || null, creado: row.creado,
  };
}

function productoEtiquetaV29(p) {
  return p.nombre || [p.marca, p.presentacion].filter(Boolean).join(" ") || "Producto";
}

function filtrarYOrdenar() {
  const texto = $("#buscador")?.value.trim().toLowerCase() || "";
  const cat = $("#filtro-categoria")?.value || "";
  const stockFilter = $("#filtro-stock-v29")?.value || "";
  const [campo, dir] = ($("#orden")?.value || "nombre-asc").split("-");

  let lista = productos.filter((p) => {
    const searchHay = [
      p.nombre,
      p.marca,
      p.presentacion,
      p.codigoBarras,
      p.categoria,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchTexto = !texto || searchHay.includes(texto);
    const matchCat = !cat || p.categoria === cat;

    const low = esStockBajoInteligente(p);
    const zero = esSinStock(p);

    const matchLegacy = !filtroStockBajo || low;
    const matchStock =
      !stockFilter ||
      (stockFilter === "bajo" && low) ||
      (stockFilter === "sin" && zero);

    return matchTexto && matchCat && matchLegacy && matchStock;
  });

  lista.sort((a, b) => {
    let va = a[campo] ?? "";
    let vb = b[campo] ?? "";

    if (typeof va === "string") {
      va = va.toLowerCase();
      vb = String(vb).toLowerCase();
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

  if (!grid) return;

  const role = appContext.membership?.role || "cashier";
  const manage = ["owner", "admin", "manager"].includes(role);
  const adjust = manage;
  const costs = manage;

  const totalStock = productos.reduce((a, p) => a + Number(p.stock || 0), 0);
  const costoTotal = productos.reduce(
    (a, p) => a + Number(p.stock || 0) * Number(p.precioCompra || 0),
    0
  );
  const ventaTotal = productos.reduce(
    (a, p) => a + Number(p.stock || 0) * Number(p.precioVenta || 0),
    0
  );
  const bajos = productos.filter(esStockBajoInteligente).length;
  const sinStock = productos.filter(esSinStock).length;

  $("#stat-productos").textContent = productos.length;
  $("#stat-stock").textContent = totalStock;
  $("#stat-costo").textContent = costs ? formatearPrecio(costoTotal) : "—";
  $("#stat-venta").textContent = formatearPrecio(ventaTotal);
  $("#stat-bajo").textContent = bajos;
  $("#stat-sin").textContent = sinStock;

  if (!productos.length) {
    grid.innerHTML = "";
    empty?.classList.toggle("hidden", !manage);
    noResults?.classList.add("hidden");
    return;
  }

  empty?.classList.add("hidden");

  if (!lista.length) {
    grid.innerHTML = "";
    noResults?.classList.remove("hidden");
    return;
  }

  noResults?.classList.add("hidden");

  grid.innerHTML = lista
    .map((p) => {
      const low = esStockBajoInteligente(p);
      const stockInfoTitle = escapeHtml(textoStockInteligente(p));
      const stockClass =
        Number(p.stock || 0) === 0
          ? "stock-zero-v29"
          : low
            ? "stock-low-v29"
            : "";

      // Un solo nombre completo. productoEtiquetaV29 ya agrega presentación
      // sin repetirla cuando corresponde.
      const nombreCompleto = productoEtiquetaV29(p);
      const inicial = (p.marca || p.nombre || "P").slice(0, 1).toUpperCase();
      const categoria = p.categoria || "Sin categoría";

      const stockHtml = adjust
        ? `<div class="row-stock-actions-v29" title="${stockInfoTitle}">
            <button data-action="restar" aria-label="Restar stock">−</button>
            <button class="stock-number-v29 ${stockClass}" data-action="ajustar">${Number(p.stock || 0)}</button>
            <button data-action="sumar" aria-label="Sumar stock">+</button>
          </div>`
        : `<strong class="stock-number-v29 ${stockClass}" title="${stockInfoTitle}">${Number(p.stock || 0)}</strong>`;

      const actions = manage
        ? `<div class="row-actions-v29">
            <button class="btn btn-ghost btn-sm" data-action="editar">Editar</button>
            <button class="btn-icon danger" data-action="eliminar" title="Eliminar" aria-label="Eliminar">🗑</button>
          </div>`
        : "";

      return `
        <article class="producto-card producto-row-v29 producto-row-v223" data-id="${p.id}">
          <div class="producto-v223-media">
            ${
              p.foto
                ? `<img src="${p.foto}" alt="" class="producto-v223-img">`
                : `<div class="producto-v223-icon">${escapeHtml(inicial)}</div>`
            }
          </div>

          <div class="producto-v223-info">
            <strong class="producto-v223-nombre">${escapeHtml(nombreCompleto)}</strong>
            <small class="producto-v223-categoria">${escapeHtml(categoria)}</small>
          </div>

          <div class="producto-v223-stock">${stockHtml}</div>

          <div class="producto-v223-precio">
            <strong>${formatearPrecio(p.precioVenta)}</strong>
            ${costs ? `<small>Costo ${formatearPrecio(p.precioCompra)}</small>` : ""}
          </div>

          <div class="producto-v223-acciones">${actions}</div>
        </article>
      `;
    })
    .join("");

  aplicarPermisosV2();
}


let productoSobreVentaActivo = false;

function activarProductoSobreVenta() {
  const productoModal = $("#modal");
  const ventaModal = $("#modal-venta");

  if (!productoModal || !ventaModal) return;

  productoSobreVentaActivo = true;
  productoModal.classList.add("modal-product-over-sale");
  ventaModal.classList.add("modal-under-product");
  ventaModal.setAttribute("aria-hidden", "true");
}

function restaurarVentaDetrasProducto({ enfocar = true } = {}) {
  const productoModal = $("#modal");
  const ventaModal = $("#modal-venta");

  productoModal?.classList.remove("modal-product-over-sale");
  ventaModal?.classList.remove("modal-under-product");
  ventaModal?.removeAttribute("aria-hidden");

  productoSobreVentaActivo = false;

  if (enfocar && ventaModal && !ventaModal.classList.contains("hidden")) {
    setTimeout(() => $("#venta-buscador")?.focus(), 60);
  }
}

function abrirModal(producto=null) {
  if(!exigirPermisoV2("manageProducts","No tenés permiso para modificar productos"))return;
  productoEditandoId=producto?.id || null; fotoActualBase64=producto?.foto || null;
  $("#modal-titulo").textContent=producto?"Editar producto":"Nuevo producto";
  const branchHint = $("#producto-branch-hint-v226");
  if (branchHint) branchHint.textContent = `Stock de sucursal: ${appContext.branch?.nombre || "—"}`;
  $("#producto-id").value=producto?.id||""; $("#nombre").value=producto?.nombre||""; $("#marca").value=producto?.marca||"";
  $("#presentacion").value=producto?.presentacion||""; $("#codigo-barras").value=producto?.codigoBarras||"";
  $("#precio-compra").value=producto?.precioCompra??""; $("#precio-venta").value=producto?.precioVenta??"";
  $("#stock").value=producto?.stock??0;
  $("#stock-minimo").value=0;
  actualizarStockSmartForm(producto || null);
  $("#error-nombre").textContent=""; $("#barcode-status-v29").textContent="";
  renderSelectCategorias(producto?.categoria||""); $("#modal").classList.remove("hidden"); setTimeout(()=>$("#nombre").focus(),50);
}

function cerrarModal({ preservarFlujoScanner = false } = {}) {
  $("#modal").classList.add("hidden");
  $("#form-producto").reset();
  productoEditandoId = null;
  fotoActualBase64 = null;

  restaurarVentaDetrasProducto({ enfocar: !preservarFlujoScanner });

  if (!preservarFlujoScanner) {
    pendingReturnToSaleV214 = false;
    pendingAddAfterCreateV214 = false;
    pendingScannedCodeV214 = null;
  }
}

async function guardarProducto(e) {
  e.preventDefault();

  if (!exigirPermisoV2("manageProducts", "No tenés permiso para modificar productos")) return;
  if (!appContext?.branch?.id) {
    mostrarToast("Seleccioná una sucursal antes de guardar", "error");
    return;
  }

  const nombre = $("#nombre").value.trim();
  const codigo = $("#codigo-barras").value.trim();
  const stockSucursal = Math.max(0, parseInt($("#stock").value, 10) || 0);
  const stockMinimoSucursal = 0;

  if (!nombre) {
    $("#error-nombre").textContent = "El nombre es obligatorio";
    return;
  }

  const duplicate =
    codigo &&
    productos.find(
      (p) => p.codigoBarras === codigo && p.id !== productoEditandoId
    );

  if (duplicate) {
    mostrarToast(`Ese código ya pertenece a "${duplicate.nombre}"`, "error");
    return;
  }

  const datosDB = {
    nombre,
    marca: $("#marca").value.trim(),
    presentacion: $("#presentacion").value.trim(),
    codigo_barras: codigo || null,
    categoria: $("#categoria").value.trim(),
    precio_compra: parseFloat($("#precio-compra").value) || 0,
    precio_venta: parseFloat($("#precio-venta").value) || 0,
    // stock global es derivado del stock de todas las sucursales.
    stock_minimo: stockMinimoSucursal,
  };

  const eraEdicion = Boolean(productoEditandoId);
  const btn = $("#btn-guardar");
  btn.disabled = true;

  let query;

  if (eraEdicion) {
    query = supabaseClient
      .from("productos")
      .update({
        ...datosDB,
        actualizado: new Date().toISOString(),
      })
      .eq("id", productoEditandoId);
  } else {
    // Siempre 0 al insertar: luego establecemos stock de la sucursal activa.
    query = supabaseClient.from("productos").insert({
      ...datosDB,
      stock: 0,
      user_id: sesionActual.user.id,
    });
  }

  const { data, error } = await query.select().single();

  if (error) {
    btn.disabled = false;
    mostrarToast(
      error.code === "23505"
        ? "Ese código de barras ya está cargado"
        : "No se pudo guardar el producto",
      "error"
    );
    return;
  }

  const { data: stockData, error: stockError } = await supabaseClient.rpc(
    "establecer_stock_sucursal_v1",
    {
      p_producto_id: data.id,
      p_sucursal_id: appContext.branch.id,
      p_stock: stockSucursal,
      p_stock_minimo: stockMinimoSucursal,
    }
  );

  btn.disabled = false;

  if (stockError) {
    console.error("[V2.26] Error guardando stock de sucursal:", stockError);

    if (!eraEdicion) {
      await supabaseClient.from("productos").delete().eq("id", data.id);
    }

    mostrarToast(
      "No se pudo guardar el stock de la sucursal: " + stockError.message,
      "error"
    );
    return;
  }

  const mapped = mapearProductoDB({
    ...data,
    stock: stockData?.stock ?? stockSucursal,
    stock_minimo: stockData?.stock_minimo ?? stockMinimoSucursal,
  });

  if (eraEdicion) {
    const i = productos.findIndex((p) => p.id === productoEditandoId);
    if (i >= 0) productos[i] = mapped;
  } else {
    productos.push(mapped);
  }

  actualizarFiltroCategorias();
  renderGrid();

  const volverAVentaTrasAlta =
    !eraEdicion && pendingReturnToSaleV214 && pendingAddAfterCreateV214;

  cerrarModal({ preservarFlujoScanner: volverAVentaTrasAlta });

  if (volverAVentaTrasAlta) {
    pendingReturnToSaleV214 = false;
    pendingAddAfterCreateV214 = false;
    pendingScannedCodeV214 = null;

    $("#modal-venta")?.classList.remove("hidden");
    restaurarVentaDetrasProducto({ enfocar: false });
    agregarAlCarrito(mapped.id);
    renderVentaProductos();
    renderCarrito();
    setTimeout(() => $("#venta-buscador")?.focus(), 80);

    mostrarToast(
      `${mapped.nombre} registrado en ${appContext.branch.nombre} y agregado a la venta`,
      "success"
    );
    return;
  }

  mostrarToast(
    eraEdicion
      ? `Producto actualizado en ${appContext.branch.nombre}`
      : `Producto agregado a ${appContext.branch.nombre}`,
    "success"
  );
}

function mapearCategoriaOFFV29(categories="") {
  const c=categories.toLowerCase();
  if(c.includes("beer")||c.includes("cerve"))return "Cervezas"; if(c.includes("soda")||c.includes("gase"))return "Gaseosas";
  if(c.includes("water")||c.includes("agua"))return "Aguas"; if(c.includes("chocolate"))return "Chocolates";
  if(c.includes("snack")||c.includes("chip"))return "Snacks"; if(c.includes("biscuit")||c.includes("cookie")||c.includes("gallet"))return "Galletitas";
  if(c.includes("dairy")||c.includes("milk")||c.includes("láct"))return "Lácteos"; return "Otros";
}

async function buscarDatosBarcodeV29(code) {
  code=String(code||"").trim(); if(!code)return null;
  const status=$("#barcode-status-v29"); if(status)status.textContent="Buscando datos del producto...";
  try{
    const url=`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,brands,quantity,categories`;
    const r=await fetch(url); if(!r.ok)throw new Error("Consulta no disponible"); const j=await r.json();
    if(j.status!==1 || !j.product){if(status)status.textContent="Código no encontrado. Podés completar los datos manualmente.";return null;}
    const p=j.product; const brand=String(p.brands||"").split(",")[0].trim(); const name=String(p.product_name||"").trim(); const quantity=String(p.quantity||"").trim();
    if($("#marca")&&!$("#marca").value)$("#marca").value=brand; if($("#presentacion")&&!$("#presentacion").value)$("#presentacion").value=quantity;
    if($("#nombre")&&!$("#nombre").value)$("#nombre").value=[brand,name,quantity].filter(Boolean).join(" ").replace(/\s+/g," ").trim();
    const localCat=mapearCategoriaOFFV29(p.categories||""); if($("#categoria") && !$("#categoria").value){if(!categorias.includes(localCat))await asegurarCategoriaV29(localCat);renderSelectCategorias(localCat);}
    if(status)status.textContent="Datos encontrados. Revisalos y completá precio/stock."; return p;
  }catch(err){console.warn("OpenFoodFacts",err);if(status)status.textContent="No pudimos consultar la base externa. El código quedó cargado.";return null;}
}

async function asegurarCategoriaV29(nombre) {
  if(!nombre||categorias.includes(nombre))return; const {data,error}=await supabaseClient.from("categorias").insert({user_id:sesionActual.user.id,nombre}).select().single(); if(!error&&data){categorias.push(data.nombre);categorias.sort((a,b)=>a.localeCompare(b,"es"));actualizarFiltroCategorias();}
}



function setScannerAnimandoV29(activo) {
  const wrap = $(".scanner-video-wrap-v29");
  wrap?.classList.toggle("is-scanning", Boolean(activo));

  const modal = $("#modal-scanner-v29");
  modal?.classList.toggle("scanner-reading-active", Boolean(activo));
}

function mostrarCodigoNoRegistradoV214(code) {
  setScannerAnimandoV29(false);
  pendingScannedCodeV214 = String(code || "").trim();

  const panel = $("#scanner-not-found-actions-v214");
  const text = $("#scanner-not-found-text-v214");
  const status = $("#scanner-status-v29");

  if (status) status.textContent = `Código ${pendingScannedCodeV214} no registrado`;

  if (text) {
    text.textContent =
      `El código ${pendingScannedCodeV214} no existe en tu catálogo. Podés registrarlo ahora y volver automáticamente a esta venta.`;
  }

  panel?.classList.remove("hidden");
}

function ocultarCodigoNoRegistradoV214() {
  $("#scanner-not-found-actions-v214")?.classList.add("hidden");
  const text = $("#scanner-not-found-text-v214");
  if (text) text.textContent = "";
}

async function registrarProductoDesdeScannerV214() {
  if (!pendingScannedCodeV214) return;

  const code = pendingScannedCodeV214;
  const volverAVenta = scannerModeV29 === "venta";

  pendingReturnToSaleV214 = volverAVenta;
  pendingAddAfterCreateV214 = volverAVenta;

  cerrarScannerV29();

  abrirModal();

  if (volverAVenta) {
    activarProductoSobreVenta();
  }

  const codigoInput = $("#codigo-barras");
  if (codigoInput) codigoInput.value = code;

  try {
    await buscarDatosBarcodeV29(code);
  } catch (error) {
    console.warn("[V2.14] Búsqueda externa:", error);
  }

  mostrarToast("Completá los datos y guardá el producto", "info");
}

function cancelarRegistroDesdeScannerV214() {
  pendingScannedCodeV214 = null;
  setScannerAnimandoV29(true);
  ocultarCodigoNoRegistradoV214();

  const status = $("#scanner-status-v29");
  if (status) status.textContent = "Cámara activa · mantené el código dentro del marco";
  scannerOpenedAtVPro = Date.now();
  scannerLastSuccessAtVPro = 0;
}


async function procesarCodigoV29(code, meta = {}) {
  code = String(code || "").replace(/\D/g, "").trim();
  if (!code) return;

  const now = Date.now();

  if (code === scannerLastCodeV29 && now - scannerLastAtV29 < 900) {
    return;
  }

  scannerLastCodeV29 = code;
  scannerLastAtV29 = now;

  setScannerAnimandoV29(false);

  if (meta.engine && meta.engine !== "manual" && meta.engine !== "usb") {
    registrarExitoScannerVPro({
      engine: meta.engine,
      format: meta.format || "",
      zoom: scannerCurrentZoomVPro,
    });
  }

  if (scannerModeV29 === "venta") {
    const p = productos.find((x) => x.codigoBarras === code);

    if (p) {
      agregarAlCarrito(p.id);
      renderVentaProductos();

      const s = $("#scanner-status-v29");
      if (s) {
        const engine =
          meta.engine === "native" ? " · detector nativo" :
          meta.engine === "capture" ? " · captura mejorada" :
          meta.engine === "zxing" ? " · ZXing" : "";

        s.textContent = `✓ ${p.nombre} agregado${engine}`;
      }

      navigator.vibrate?.(70);

      setTimeout(() => {
        cerrarScannerV29();
      }, 260);
    } else {
      mostrarCodigoNoRegistradoV214(code);
    }

    return;
  }

  if (scannerModeV29 === "producto") {
    const existing = productos.find(
      (x) => x.codigoBarras === code && x.id !== productoEditandoId
    );

    cerrarScannerV29();

    if (existing) {
      mostrarToast(`El código ya corresponde a ${existing.nombre}`, "info");
      abrirModal(existing);
      return;
    }

    $("#codigo-barras").value = code;
    await buscarDatosBarcodeV29(code);
  }
}

async function abrirScannerV29(mode) {
  scannerModeV29 = mode;
  scannerLastCodeV29 = "";
  scannerLastAtV29 = 0;
  scannerClosingV29 = false;
  pendingScannedCodeV214 = null;
  scannerOpenedAtVPro = Date.now();
  scannerLastSuccessAtVPro = 0;
  scannerEngineSuccessVPro = null;
  scannerTorchOnVPro = false;
  scannerCurrentZoomVPro = 1;

  ocultarCodigoNoRegistradoV214();
  mostrarHintScannerVPro("");
  actualizarTextoAdaptativoVPro();
  actualizarEngineScannerVPro("Preparando");

  document.body.classList.add("scanner-v29-open");

  const scannerModal = $("#modal-scanner-v29");
  const ventaModal = $("#modal-venta");

  if (scannerModal) {
    scannerModal.style.zIndex = "12000";
    scannerModal.classList.remove("hidden");
  }

  if (mode === "venta" && ventaModal) {
    ventaModal.classList.add("modal-behind-scanner");
    ventaModal.setAttribute("aria-hidden", "true");
  }

  $("#scanner-mode-label-v29").textContent =
    mode === "venta"
      ? "Escaneá productos: se agregan directamente al carrito."
      : "Apuntá la cámara al código del producto.";

  $("#scanner-status-v29").textContent =
    "Abriendo cámara trasera en alta resolución…";

  setScannerAnimandoV29(false);

  try {
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      throw new Error("El lector de códigos no cargó");
    }

    scannerReaderV29 = new ZXingBrowser.BrowserMultiFormatReader();
    const videoEl = $("#scanner-video-v29");

    // Pedimos explícitamente cámara trasera + resolución alta.
    // BrowserMultiFormatReader permite controlar la captura con constraints.
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920, min: 720 },
        height: { ideal: 1080, min: 480 },
        frameRate: { ideal: 30, min: 15 },
      },
    };

    if (typeof scannerReaderV29.decodeFromConstraints === "function") {
      scannerControlsV29 = await scannerReaderV29.decodeFromConstraints(
        constraints,
        videoEl,
        (result) => {
          if (result) {
            procesarCodigoV29(result.getText(), {
              engine: "zxing",
              format: result.getBarcodeFormat?.()?.toString?.() || "",
            });
          }
        }
      );
    } else {
      // Fallback para builds viejos de ZXing.
      let selectedDeviceId;

      try {
        const devices =
          await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();

        const backCamera =
          devices.find((d) =>
            /back|rear|environment|trasera/i.test(d.label || "")
          ) || devices[devices.length - 1];

        selectedDeviceId = backCamera?.deviceId;
      } catch {}

      scannerControlsV29 = await scannerReaderV29.decodeFromVideoDevice(
        selectedDeviceId,
        videoEl,
        (result) => {
          if (result) {
            procesarCodigoV29(result.getText(), {
              engine: "zxing",
              format: result.getBarcodeFormat?.()?.toString?.() || "",
            });
          }
        }
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
    await configurarTrackScannerVPro();

    const nativeOk = await iniciarDetectorNativoVPro();

    if (!nativeOk) {
      actualizarEngineScannerVPro("ZXing");
    }

    iniciarAsistenciaScannerVPro();

    $("#scanner-status-v29").textContent =
      "Cámara activa · mantené el código dentro del marco";

    setScannerAnimandoV29(true);
  } catch (err) {
    setScannerAnimandoV29(false);
    detenerDetectorNativoVPro();
    detenerAsistenciaScannerVPro();

    console.error("[Scanner Pro]", err);

    $("#scanner-status-v29").textContent =
      "No se pudo abrir la cámara. Revisá permisos o ingresá el código manualmente.";

    mostrarHintScannerVPro(
      "Si el teléfono tiene varias cámaras, probá cerrar y volver a abrir el scanner.",
      "warning"
    );
  }
}

function cerrarScannerV29() {
  setScannerAnimandoV29(false);
  detenerDetectorNativoVPro();
  detenerAsistenciaScannerVPro();

  try {
    scannerControlsV29?.stop?.();
  } catch {}

  scannerControlsV29 = null;
  scannerReaderV29 = null;
  scannerModeV29 = null;
  scannerNativeDetectorVPro = null;
  scannerTrackVPro = null;
  scannerZoomCapsVPro = null;
  scannerTorchOnVPro = false;
  scannerTorchSupportedVPro = false;

  const v = $("#scanner-video-v29");

  if (v?.srcObject) {
    v.srcObject.getTracks().forEach((t) => t.stop());
    v.srcObject = null;
  }

  const scannerModal = $("#modal-scanner-v29");
  const ventaModal = $("#modal-venta");

  scannerModal?.classList.add("hidden");

  if (scannerModal) {
    scannerModal.style.zIndex = "";
  }

  document.body.classList.remove("scanner-v29-open");

  if (ventaModal) {
    ventaModal.classList.remove("modal-behind-scanner");
    ventaModal.removeAttribute("aria-hidden");
  }

  mostrarHintScannerVPro("");
  $("#btn-scanner-torch-vpro")?.classList.remove("active");
  $("#scanner-zoom-wrap-vpro")?.classList.add("hidden");

  setTimeout(() => {
    scannerClosingV29 = false;
  }, 250);
}

function renderVentaProductos() {
  const texto=$("#venta-buscador")?.value.trim().toLowerCase()||"";
  const lista=productos.filter(p=>!texto||[p.nombre,p.marca,p.presentacion,p.codigoBarras,p.categoria].filter(Boolean).join(" ").toLowerCase().includes(texto)).sort((a,b)=>a.nombre.localeCompare(b.nombre,"es"));
  const cont=$("#venta-productos-lista");if(!cont)return; if(!lista.length){cont.innerHTML='<p class="carrito-vacio">Sin resultados</p>';return;}
  cont.innerHTML=lista.map(p=>{const c=carrito.find(x=>x.id===p.id), disp=p.stock-(c?.cantidad||0);return `<div class="venta-producto-item ${disp<=0?"sin-stock":""}" data-id="${p.id}"><div class="venta-producto-thumb">${escapeHtml((p.marca||p.nombre).slice(0,1).toUpperCase())}</div><div class="venta-producto-info"><div class="venta-producto-nombre">${escapeHtml(p.nombre)}</div><div class="venta-producto-meta">${p.codigoBarras?`EAN ${escapeHtml(p.codigoBarras)} · `:""}${formatearPrecio(p.precioVenta)} · quedan ${disp}</div></div></div>`;}).join("");
}

function catalogItemsV29() {return CATALOGO_BASE_V29.filter(x=>x.catalogos.includes(catalogoTipoV29));}
function abrirCatalogoV29() {if(!exigirPermisoV2("manageProducts","No tenés permiso para cargar catálogos"))return;catalogoTipoV29="kiosco";catalogoSeleccionV29=new Set(catalogItemsV29().map(x=>x.nombre));$("#catalog-search-v29").value="";$("#modal-catalogo-v29").classList.remove("hidden");renderCatalogoV29();}
function cerrarCatalogoV29() {$("#modal-catalogo-v29")?.classList.add("hidden");}
function renderCatalogoV29() {
  document.querySelectorAll(".catalog-tab-v29").forEach(b=>b.classList.toggle("active",b.dataset.catalog===catalogoTipoV29));
  const q=$("#catalog-search-v29").value.trim().toLowerCase(); const all=catalogItemsV29(); const vis=all.filter(x=>!q||[x.nombre,x.marca,x.presentacion,x.categoria].join(" ").toLowerCase().includes(q));
  const existing=new Set(productos.map(p=>p.nombre.toLowerCase()));
  $("#catalog-list-v29").innerHTML=vis.map(x=>{const exists=existing.has(x.nombre.toLowerCase());return `<label class="catalog-row-v29 ${exists?"already-v29":""}"><input type="checkbox" data-catalog-name="${escapeHtml(x.nombre)}" ${catalogoSeleccionV29.has(x.nombre)&&!exists?"checked":""} ${exists?"disabled":""}><span><strong>${escapeHtml(x.nombre)}</strong><small>${escapeHtml(x.categoria)}${exists?" · ya cargado":""}</small></span></label>`;}).join("");
  $("#catalog-selected-count-v29").textContent=[...catalogoSeleccionV29].filter(n=>!existing.has(n.toLowerCase())).length;
}
async function importarCatalogoV29() {
  const existing=new Set(productos.map(p=>p.nombre.toLowerCase())); const sel=CATALOGO_BASE_V29.filter(x=>catalogoSeleccionV29.has(x.nombre)&&!existing.has(x.nombre.toLowerCase()));
  if(!sel.length){mostrarToast("No hay productos nuevos seleccionados","info");return;}
  const cats=[...new Set(sel.map(x=>x.categoria))];for(const c of cats)await asegurarCategoriaV29(c);
  const rows=sel.map(x=>({user_id:sesionActual.user.id,nombre:x.nombre,marca:x.marca,presentacion:x.presentacion,codigo_barras:null,categoria:x.categoria,precio_compra:0,precio_venta:0,stock:0,stock_minimo:x.stockMinimo||5}));
  const {data,error}=await supabaseClient.from("productos").insert(rows).select(); if(error){mostrarToast("No se pudo importar el catálogo","error");console.error(error);return;}
  productos.push(...(data||[]).map(mapearProductoDB));actualizarFiltroCategorias();renderGrid();cerrarCatalogoV29();mostrarToast(`${data.length} productos importados. Ahora cargá precios y stock.`,`success`);
}

async function cargarEjemplos() {abrirCatalogoV29();}

function setupV29() {
  $("#filtro-stock-v29")?.addEventListener("change", () => {
    filtroStockBajo = false;
    actualizarFiltroRapidoStockUI();
    renderGrid();
  }); $("#btn-catalogo-v29")?.addEventListener("click",abrirCatalogoV29);
  $("#btn-eliminar-todos-productos")?.addEventListener("click", eliminarTodosLosProductosV222);
  $("#btn-scan-producto")?.addEventListener("click",()=>abrirScannerV29("producto")); $("#btn-scan-venta")?.addEventListener("click",()=>abrirScannerV29("venta"));
  $("#btn-buscar-barcode")?.addEventListener("click",()=>buscarDatosBarcodeV29($("#codigo-barras").value));
  $("#btn-close-scanner-v29")?.addEventListener("click",cerrarScannerV29); $("#modal-scanner-v29 .modal-backdrop")?.addEventListener("click",cerrarScannerV29);
  $("#btn-use-manual-code-v29")?.addEventListener("click",()=>procesarCodigoV29($("#scanner-manual-code-v29").value, { engine: "manual" }));
  $("#btn-scanner-torch-vpro")?.addEventListener("click", toggleTorchScannerVPro);
  $("#btn-scanner-zoom-out-vpro")?.addEventListener("click", () => cambiarZoomScannerVPro(-1));
  $("#btn-scanner-zoom-in-vpro")?.addEventListener("click", () => cambiarZoomScannerVPro(1));
  $("#btn-scanner-capture-vpro")?.addEventListener("click", capturarYAnalizarScannerVPro);
  $("#btn-register-scanned-v214")?.addEventListener("click", registrarProductoDesdeScannerV214);
  $("#btn-cancel-register-scanned-v214")?.addEventListener("click", cancelarRegistroDesdeScannerV214);
  $("#scanner-manual-code-v29")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();procesarCodigoV29(e.target.value, { engine: "manual" });}});
  $("#btn-close-catalogo-v29")?.addEventListener("click",cerrarCatalogoV29);$("#btn-cancel-catalogo-v29")?.addEventListener("click",cerrarCatalogoV29);$("#modal-catalogo-v29 .modal-backdrop")?.addEventListener("click",cerrarCatalogoV29);
  $("#catalog-search-v29")?.addEventListener("input",renderCatalogoV29);
  document.querySelectorAll(".catalog-tab-v29").forEach(b=>b.addEventListener("click",()=>{catalogoTipoV29=b.dataset.catalog;catalogoSeleccionV29=new Set(catalogItemsV29().map(x=>x.nombre));renderCatalogoV29();}));
  $("#catalog-list-v29")?.addEventListener("change",e=>{const cb=e.target.closest("[data-catalog-name]");if(!cb)return;cb.checked?catalogoSeleccionV29.add(cb.dataset.catalogName):catalogoSeleccionV29.delete(cb.dataset.catalogName);renderCatalogoV29();});
  $("#catalog-select-all-v29")?.addEventListener("click",()=>{document.querySelectorAll('#catalog-list-v29 input:not(:disabled)').forEach(cb=>catalogoSeleccionV29.add(cb.dataset.catalogName));renderCatalogoV29();});
  $("#catalog-clear-v29")?.addEventListener("click",()=>{document.querySelectorAll('#catalog-list-v29 input:not(:disabled)').forEach(cb=>catalogoSeleccionV29.delete(cb.dataset.catalogName));renderCatalogoV29();});
  $("#btn-import-catalogo-v29")?.addEventListener("click",importarCatalogoV29);

  // Scanner USB: los lectores suelen escribir el código muy rápido y enviar Enter.
  document.addEventListener("keydown",e=>{
    const saleOpen=!$("#modal-venta")?.classList.contains("hidden"); const productOpen=!$("#modal")?.classList.contains("hidden"); if(!saleOpen&&!productOpen)return;
    const now=performance.now();
    if(e.key==="Enter"){if(usbBufferV29.length>=6 && now-usbStartedAtV29<2500){e.preventDefault();const code=usbBufferV29;usbBufferV29="";scannerModeV29=saleOpen?"venta":"producto";procesarCodigoV29(code, { engine: "usb" });if(productOpen)scannerModeV29=null;}else usbBufferV29="";return;}
    if(/^\d$/.test(e.key)){if(now-usbLastAtV29>180){usbBufferV29="";usbStartedAtV29=now;}if(!usbBufferV29)usbStartedAtV29=now;usbBufferV29+=e.key;usbLastAtV29=now;}
  },true);
}


// ============================================================
// Vendify v2.28 — Sucursales / cajas / stock por sucursal
// ============================================================


// ============================================================
// Vendify v2.28 — Caja profesional
// ============================================================
let cajasSucursalV227=[]; let cajaEstadoV227=null; let cajaMovimientosV227=[]; let cashMovementTypeV227=null;
async function cargarCajasSucursalV227({mantener=true}={}){const selector=$("#cash-selector-v227");if(!appContext?.branch?.id){cajasSucursalV227=[];if(selector)selector.innerHTML=`<option value="">Sin sucursal</option>`;appContext.cashRegister=null;await cargarEstadoCajaV227();return;}const{data,error}=await supabaseClient.rpc("listar_cajas_sucursal_v1",{p_sucursal_id:appContext.branch.id});if(error){console.error("[V2.27] cajas",error);cajasSucursalV227=[];if(selector)selector.innerHTML=`<option value="">Sin cajas</option>`;appContext.cashRegister=null;await cargarEstadoCajaV227();return;}cajasSucursalV227=data||[];if(selector)selector.innerHTML=cajasSucursalV227.map(c=>`<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join("");const key=appContext.business?.id&&appContext.branch?.id?`vendify_cash_${appContext.business.id}_${appContext.branch.id}`:null;const saved=mantener&&key?localStorage.getItem(key):null;const current=appContext.cashRegister?.id;const chosen=cajasSucursalV227.find(c=>c.id===saved)||cajasSucursalV227.find(c=>c.id===current)||cajasSucursalV227[0]||null;appContext.cashRegister=chosen?{id:chosen.id,nombre:chosen.nombre}:null;if(selector&&chosen)selector.value=chosen.id;if(key&&chosen)localStorage.setItem(key,chosen.id);await cargarEstadoCajaV227();}
async function cambiarCajaDesdeSelectorV227(e){const id=e.target.value,c=cajasSucursalV227.find(x=>x.id===id);if(!c)return;if(carrito.length){const ok=await confirmar("Cambiar de caja","El carrito actual se vaciará al cambiar de caja.");if(!ok){e.target.value=appContext.cashRegister?.id||"";return;}carrito=[];renderCarrito();}appContext.cashRegister={id:c.id,nombre:c.nombre};localStorage.setItem(`vendify_cash_${appContext.business.id}_${appContext.branch.id}`,c.id);await cargarEstadoCajaV227();}
async function cargarEstadoCajaV227(){if(!appContext?.cashRegister?.id){cajaEstadoV227=null;renderEstadoCajaHeaderV227();return;}const{data,error}=await supabaseClient.rpc("obtener_estado_caja_v1",{p_caja_id:appContext.cashRegister.id});if(error){console.error("[V2.27] estado",error);cajaEstadoV227=null;renderEstadoCajaHeaderV227();return;}cajaEstadoV227=data;renderEstadoCajaHeaderV227();}
function cajaAbiertaMiaV227(){return Boolean(cajaEstadoV227?.sesion&&cajaEstadoV227?.es_mia);}
function renderEstadoCajaHeaderV227(){const btn=$("#btn-caja-v227"),dot=$("#cash-status-dot-v227"),label=$("#cash-status-label-v227");if(!btn||!dot||!label)return;dot.classList.remove("open","closed","busy");if(!appContext?.cashRegister?.id){dot.classList.add("closed");label.textContent="Sin caja";return;}if(!cajaEstadoV227?.sesion){dot.classList.add("closed");label.textContent="Caja cerrada";return;}if(cajaEstadoV227.es_mia){dot.classList.add("open");label.textContent="Caja abierta";}else{dot.classList.add("busy");label.textContent="Caja ocupada";}}
async function abrirPanelCajaV227(){if(!appContext?.cashRegister?.id){mostrarToast("Esta sucursal no tiene una caja activa","error");return;}await cargarEstadoCajaV227();await renderPanelCajaV227();await renderHistorialCajaV227();$("#cash-context-v227").textContent=`${appContext.branch?.nombre||"Sucursal"} · ${appContext.cashRegister?.nombre||"Caja"}`;$("#modal-caja-operativa-v227").classList.remove("hidden");}
function cerrarPanelCajaV227(){$("#modal-caja-operativa-v227")?.classList.add("hidden");}
async function renderPanelCajaV227(){const cont=$("#cash-current-v227");if(!cont)return;if(!appContext?.cashRegister?.id){cont.innerHTML=`<div class="cash-empty-v227">No hay una caja activa.</div>`;return;}if(!cajaEstadoV227?.sesion){cont.innerHTML=`<section class="cash-status-card-v227 closed"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 closed"></span><div><strong>Caja cerrada</strong><small>${escapeHtml(appContext.cashRegister.nombre)}</small></div></div><form id="form-open-cash-v227" class="cash-open-form-v227"><div class="form-group"><label for="cash-opening-fund-v227">Fondo inicial</label><input type="number" id="cash-opening-fund-v227" value="0" min="0" step="0.01" required/><small class="hint">Efectivo físico antes de empezar.</small></div><div class="form-group"><label for="cash-opening-note-v227">Nota</label><input id="cash-opening-note-v227" maxlength="200" placeholder="Opcional"/></div><span class="field-error" id="cash-opening-error-v227"></span><button type="submit" class="btn btn-primary btn-lg">Abrir caja</button></form></section>`;$("#form-open-cash-v227")?.addEventListener("submit",abrirCajaV227);return;}const s=cajaEstadoV227.sesion;if(!cajaEstadoV227.es_mia){cont.innerHTML=`<section class="cash-status-card-v227 busy"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 busy"></span><div><strong>Caja en uso</strong><small>Abierta por ${escapeHtml(s.usuario_nombre||"otro usuario")}</small></div></div><p class="cash-busy-copy-v227">Seleccioná otra caja o esperá el cierre del turno.</p>${cajaEstadoV227.puede_supervisar?`<button type="button" class="btn btn-secondary" id="btn-supervisor-close-v227">Cerrar como supervisor</button>`:""}</section>`;$("#btn-supervisor-close-v227")?.addEventListener("click",abrirCierreCajaV227);return;}cont.innerHTML=`<section class="cash-status-card-v227 open"><div class="cash-open-head-v227"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 open"></span><div><strong>Turno abierto</strong><small>Desde ${escapeHtml(formatearFechaHoraV227(s.abierta_en))}</small></div></div><button type="button" class="btn btn-danger btn-sm" id="btn-open-cash-close-v227">Cerrar caja</button></div><div class="cash-summary-grid-v227"><div class="cash-summary-item-v227"><span>Ventas</span><strong>${formatearPrecio(Number(s.ventas_total||0))}</strong><small>${Number(s.tickets||0)} tickets</small></div><div class="cash-summary-item-v227"><span>Efectivo vendido</span><strong>${formatearPrecio(Number(s.ventas_efectivo||0))}</strong><small>Ventas en efectivo</small></div><div class="cash-summary-item-v227"><span>Ingresos</span><strong class="positive">${formatearPrecio(Number(s.ingresos_total||0))}</strong><small>Movimientos manuales</small></div><div class="cash-summary-item-v227"><span>Retiros</span><strong class="negative">${formatearPrecio(Number(s.retiros_total||0))}</strong><small>Salidas manuales</small></div><div class="cash-summary-item-v227 featured"><span>Efectivo esperado</span><strong>${formatearPrecio(Number(s.efectivo_esperado||0))}</strong><small>Incluye fondo inicial</small></div></div><div class="cash-actions-v227"><button type="button" class="btn btn-secondary" data-cash-movement="ingreso">＋ Ingreso</button><button type="button" class="btn btn-secondary" data-cash-movement="retiro">− Retiro</button></div><div class="cash-movements-section-v227"><div class="cash-section-head-v227"><div><h3>Movimientos</h3><p>Ingresos y retiros del turno.</p></div></div><div id="cash-movements-v227" class="cash-movements-v227"></div></div></section>`;$("#btn-open-cash-close-v227")?.addEventListener("click",abrirCierreCajaV227);cont.querySelectorAll("[data-cash-movement]").forEach(btn=>btn.addEventListener("click",()=>abrirMovimientoCajaV227(btn.dataset.cashMovement)));await renderMovimientosCajaV227();}
async function abrirCajaV227(e){e.preventDefault();const er=$("#cash-opening-error-v227");er.textContent="";const{data,error}=await supabaseClient.rpc("abrir_caja_v1",{p_caja_id:appContext.cashRegister.id,p_fondo_inicial:Number($("#cash-opening-fund-v227").value||0),p_nota:$("#cash-opening-note-v227").value.trim()||null});if(error){er.textContent=error.message;return;}cajaEstadoV227=data;renderEstadoCajaHeaderV227();await renderPanelCajaV227();await renderHistorialCajaV227();mostrarToast("Caja abierta","success");}
function abrirMovimientoCajaV227(tipo){cashMovementTypeV227=tipo;$("#cash-movement-type-v227").value=tipo;$("#cash-movement-title-v227").textContent=tipo==="ingreso"?"Registrar ingreso":"Registrar retiro";$("#cash-movement-amount-v227").value="";$("#cash-movement-reason-v227").value="";$("#cash-movement-error-v227").textContent="";$("#modal-caja-movimiento-v227").classList.remove("hidden");}
function cerrarMovimientoCajaV227(){$("#modal-caja-movimiento-v227")?.classList.add("hidden");}
async function guardarMovimientoCajaV227(e){e.preventDefault();const er=$("#cash-movement-error-v227");er.textContent="";const{data,error}=await supabaseClient.rpc("registrar_movimiento_caja_v1",{p_caja_id:appContext.cashRegister.id,p_tipo:$("#cash-movement-type-v227").value,p_monto:Number($("#cash-movement-amount-v227").value),p_motivo:$("#cash-movement-reason-v227").value.trim()});if(error){er.textContent=error.message;return;}cajaEstadoV227=data;cerrarMovimientoCajaV227();renderEstadoCajaHeaderV227();await renderPanelCajaV227();mostrarToast(cashMovementTypeV227==="ingreso"?"Ingreso registrado":"Retiro registrado","success");}
async function renderMovimientosCajaV227(){const cont=$("#cash-movements-v227");if(!cont||!cajaEstadoV227?.sesion)return;const{data,error}=await supabaseClient.rpc("listar_movimientos_caja_abierta_v1",{p_caja_id:appContext.cashRegister.id});if(error){cont.innerHTML=`<p class="hint">No se pudieron cargar los movimientos.</p>`;return;}cajaMovimientosV227=data||[];if(!cajaMovimientosV227.length){cont.innerHTML=`<p class="cash-no-movements-v227">Todavía no hay movimientos manuales.</p>`;return;}cont.innerHTML=cajaMovimientosV227.map(m=>`<div class="cash-movement-row-v227 ${m.tipo}"><div><strong>${m.tipo==="ingreso"?"Ingreso":"Retiro"}</strong><small>${escapeHtml(m.motivo)} · ${escapeHtml(formatearFechaHoraV227(m.creado))}</small></div><strong>${m.tipo==="ingreso"?"+":"−"}${formatearPrecio(Number(m.monto||0))}</strong></div>`).join("");}
function abrirCierreCajaV227(){if(!cajaEstadoV227?.sesion)return;const esperado=Number(cajaEstadoV227.sesion.efectivo_esperado||0);$("#cash-close-expected-v227").textContent=formatearPrecio(esperado);$("#cash-close-declared-v227").value=esperado.toFixed(2);$("#cash-close-note-v227").value="";$("#cash-close-error-v227").textContent="";actualizarPreviewCierreV227();$("#modal-cash-close-v227").classList.remove("hidden");}
function cerrarCierreCajaV227(){$("#modal-cash-close-v227")?.classList.add("hidden");}
function actualizarPreviewCierreV227(){const esperado=Number(cajaEstadoV227?.sesion?.efectivo_esperado||0),declarado=Number($("#cash-close-declared-v227")?.value||0),dif=declarado-esperado,el=$("#cash-difference-preview-v227");if(!el)return;el.classList.remove("positive","negative","neutral");el.classList.add(Math.abs(dif)<.005?"neutral":dif>0?"positive":"negative");el.textContent=`Diferencia: ${dif>0?"+":""}${formatearPrecio(dif)}`;}
async function cerrarCajaV227(e){e.preventDefault();const er=$("#cash-close-error-v227");er.textContent="";const{data,error}=await supabaseClient.rpc("cerrar_caja_v1",{p_caja_id:appContext.cashRegister.id,p_efectivo_declarado:Number($("#cash-close-declared-v227").value),p_nota:$("#cash-close-note-v227").value.trim()||null});if(error){er.textContent=error.message;return;}const s=data?.sesion;cerrarCierreCajaV227();await cargarEstadoCajaV227();await renderPanelCajaV227();await renderHistorialCajaV227();const dif=Number(s?.diferencia||0);mostrarToast(Math.abs(dif)<.005?"Caja cerrada sin diferencias":`Caja cerrada · diferencia ${dif>0?"+":""}${formatearPrecio(dif)}`,Math.abs(dif)<.005?"success":"info");}
async function renderHistorialCajaV227(){const cont=$("#cash-history-v227");if(!cont||!appContext?.branch?.id)return;const{data,error}=await supabaseClient.rpc("listar_historial_cajas_v1",{p_sucursal_id:appContext.branch.id,p_limit:12});if(error){cont.innerHTML=`<p class="hint">No se pudo cargar el historial.</p>`;return;}const list=data||[];if(!list.length){cont.innerHTML=`<p class="cash-no-movements-v227">Todavía no hay cierres registrados.</p>`;return;}cont.innerHTML=list.map(s=>{const d=Number(s.diferencia||0);return`<div class="cash-history-row-v227"><div class="cash-history-main-v227"><strong>${escapeHtml(s.caja_nombre)} · ${escapeHtml(s.usuario_nombre)}</strong><small>${escapeHtml(formatearFechaHoraV227(s.cerrada_en))} · ${Number(s.tickets||0)} tickets</small></div><div class="cash-history-sales-v227"><span>Ventas</span><strong>${formatearPrecio(Number(s.ventas_total||0))}</strong></div><div class="cash-history-diff-v227 ${Math.abs(d)<.005?"zero":d>0?"positive":"negative"}"><span>Diferencia</span><strong>${d>0?"+":""}${formatearPrecio(d)}</strong></div></div>`;}).join("");}
function formatearFechaHoraV227(v){if(!v)return"—";try{return new Intl.DateTimeFormat("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(v));}catch{return String(v);}}
async function inicializarCajaV227(){await cargarCajasSucursalV227();}
function setupCajaV227(){$("#cash-selector-v227")?.addEventListener("change",cambiarCajaDesdeSelectorV227);$("#btn-caja-v227")?.addEventListener("click",abrirPanelCajaV227);$("#btn-cerrar-caja-panel-v227")?.addEventListener("click",cerrarPanelCajaV227);$("#modal-caja-operativa-v227 .modal-backdrop")?.addEventListener("click",cerrarPanelCajaV227);$("#form-cash-movement-v227")?.addEventListener("submit",guardarMovimientoCajaV227);$("#btn-close-cash-movement-v227")?.addEventListener("click",cerrarMovimientoCajaV227);$("#btn-cancel-cash-movement-v227")?.addEventListener("click",cerrarMovimientoCajaV227);$("#modal-caja-movimiento-v227 .modal-backdrop")?.addEventListener("click",cerrarMovimientoCajaV227);$("#form-cash-close-v227")?.addEventListener("submit",cerrarCajaV227);$("#btn-close-cash-close-v227")?.addEventListener("click",cerrarCierreCajaV227);$("#btn-cancel-cash-close-v227")?.addEventListener("click",cerrarCierreCajaV227);$("#modal-cash-close-v227 .modal-backdrop")?.addEventListener("click",cerrarCierreCajaV227);$("#cash-close-declared-v227")?.addEventListener("input",actualizarPreviewCierreV227);}

let sucursalesV226 = [];
let productosTransferV226 = [];

async function inicializarSucursalActivaV226() {
  let lista;

  try {
    lista = await listarSucursalesV2();
  } catch (error) {
    console.error("[V2.26] listarSucursales:", error);
    return;
  }

  sucursalesV226 = lista || [];
  renderSelectorSucursalesV226();

  if (!sucursalesV226.length) return;

  const key = appContext.business?.id
    ? `vendify_branch_${appContext.business.id}`
    : null;

  const guardada = key ? localStorage.getItem(key) : null;

  const target =
    sucursalesV226.find((s) => s.id === guardada) ||
    sucursalesV226.find((s) => s.id === appContext.branch?.id) ||
    sucursalesV226[0];

  if (target && target.id !== appContext.branch?.id) {
    await cambiarSucursalV2(target.id, { recargar: false });
  }

  const selector = $("#branch-selector-v226");
  if (selector && appContext.branch?.id) {
    selector.value = appContext.branch.id;
  }
}

function renderSelectorSucursalesV226() {
  const selector = $("#branch-selector-v226");
  if (!selector) return;

  selector.innerHTML = sucursalesV226
    .map(
      (s) =>
        `<option value="${s.id}">${escapeHtml(s.nombre)}</option>`
    )
    .join("");

  if (appContext.branch?.id) selector.value = appContext.branch.id;
}

async function cambiarSucursalDesdeSelectorV226(e) {
  const nuevaId = e.target.value;
  const anteriorId = appContext.branch?.id;

  if (!nuevaId || nuevaId === anteriorId) return;

  if (carrito.length) {
    const ok = await confirmar(
      "Cambiar de sucursal",
      "El carrito actual se vaciará al cambiar de sucursal."
    );

    if (!ok) {
      e.target.value = anteriorId || "";
      return;
    }
  }

  try {
    await cambiarSucursalV2(nuevaId);
    mostrarToast(`Sucursal activa: ${appContext.branch.nombre}`, "success");
  } catch (error) {
    e.target.value = anteriorId || "";
    mostrarToast(error.message, "error");
  }
}

async function listarSucursalesAdminV226() {
  const { data, error } = await supabaseClient.rpc("listar_sucursales_admin_v1");
  if (error) throw new Error(error.message);
  return data || [];
}

async function renderSucursalesConfigV226() {
  const cont = $("#sucursales-list-v226");
  if (!cont) return;

  cont.innerHTML = `<p class="hint" style="padding:1rem;text-align:center;">Cargando sucursales...</p>`;

  let lista;

  try {
    lista = await listarSucursalesAdminV226();
  } catch (error) {
    cont.innerHTML = "";
    mostrarToast(error.message, "error");
    return;
  }

  const role = appContext.membership?.role;
  const admin = ["owner", "admin"].includes(role);

  cont.innerHTML = lista
    .map((s) => {
      const cajas = Array.isArray(s.cajas) ? s.cajas : [];
      const cajaHtml = cajas.length
        ? cajas
            .map(
              (c) => `
                <div class="caja-chip-v226 ${c.activa ? "" : "inactive"}">
                  <span>${escapeHtml(c.nombre)}</span>
                  ${
                    admin
                      ? `<button
                           type="button"
                           data-branch-action="toggle-box"
                           data-caja-id="${c.id}"
                           data-activa="${c.activa ? "0" : "1"}"
                           title="${c.activa ? "Desactivar" : "Activar"}">
                           ${c.activa ? "●" : "○"}
                         </button>`
                      : ""
                  }
                </div>`
            )
            .join("")
        : `<span class="hint">Sin cajas</span>`;

      return `
        <article class="branch-card-v226 ${s.activa ? "" : "inactive"}">
          <div class="branch-card-main-v226">
            <div class="branch-card-icon-v226">⌂</div>
            <div class="branch-card-copy-v226">
              <div class="branch-card-title-v226">
                <strong>${escapeHtml(s.nombre)}</strong>
                <span class="branch-status-v226 ${s.activa ? "active" : "inactive"}">
                  ${s.activa ? "Activa" : "Inactiva"}
                </span>
                ${
                  s.id === appContext.branch?.id
                    ? `<span class="branch-status-v226 current">Actual</span>`
                    : ""
                }
              </div>
              <small>${escapeHtml(s.direccion || "Sin dirección")}</small>
            </div>

            <div class="branch-stat-v226">
              <span>Stock</span>
              <strong>${Number(s.stock_total || 0)}</strong>
            </div>
          </div>

          <div class="branch-cajas-v226">
            <span class="branch-cajas-label-v226">Cajas</span>
            <div class="branch-cajas-list-v226">${cajaHtml}</div>
          </div>

          ${
            admin
              ? `<div class="branch-card-actions-v226">
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    data-branch-action="edit"
                    data-id="${s.id}">
                    Editar
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    data-branch-action="add-box"
                    data-id="${s.id}"
                    data-name="${escapeHtml(s.nombre)}">
                    ＋ Caja
                  </button>
                </div>`
              : ""
          }
        </article>
      `;
    })
    .join("");

  cont.querySelectorAll('[data-branch-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = lista.find((x) => x.id === btn.dataset.id);
      abrirModalSucursalV226(s);
    });
  });

  cont.querySelectorAll('[data-branch-action="add-box"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      abrirModalCajaV226(btn.dataset.id, btn.dataset.name);
    });
  });

  cont.querySelectorAll('[data-branch-action="toggle-box"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { error } = await supabaseClient.rpc("cambiar_estado_caja_v1", {
        p_caja_id: btn.dataset.cajaId,
        p_activa: btn.dataset.activa === "1",
      });

      if (error) {
        mostrarToast(error.message, "error");
        return;
      }

      await renderSucursalesConfigV226();
      await refrescarSucursalesV226();
      await cargarCajasSucursalV227({ mantener: true });
    });
  });
}

function abrirModalSucursalV226(sucursal = null) {
  const editando = Boolean(sucursal);

  $("#sucursal-modal-title-v226").textContent =
    editando ? "Editar sucursal" : "Nueva sucursal";

  $("#sucursal-id-v226").value = sucursal?.id || "";
  $("#sucursal-nombre-v226").value = sucursal?.nombre || "";
  $("#sucursal-direccion-v226").value = sucursal?.direccion || "";
  $("#sucursal-telefono-v226").value = sucursal?.telefono || "";
  $("#sucursal-activa-v226").checked = sucursal?.activa ?? true;
  $("#sucursal-activa-row-v226").classList.toggle("hidden", !editando);
  $("#sucursal-error-v226").textContent = "";

  $("#modal-sucursal-v226").classList.remove("hidden");
  setTimeout(() => $("#sucursal-nombre-v226")?.focus(), 50);
}

function cerrarModalSucursalV226() {
  $("#modal-sucursal-v226")?.classList.add("hidden");
}

async function guardarSucursalV226(e) {
  e.preventDefault();

  const id = $("#sucursal-id-v226").value;
  const errorEl = $("#sucursal-error-v226");
  const btn = $("#btn-guardar-sucursal-v226");

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Guardando...";

  let response;

  if (id) {
    response = await supabaseClient.rpc("actualizar_sucursal_v1", {
      p_sucursal_id: id,
      p_nombre: $("#sucursal-nombre-v226").value.trim(),
      p_direccion: $("#sucursal-direccion-v226").value.trim() || null,
      p_telefono: $("#sucursal-telefono-v226").value.trim() || null,
      p_activa: $("#sucursal-activa-v226").checked,
    });
  } else {
    response = await supabaseClient.rpc("crear_sucursal_v1", {
      p_nombre: $("#sucursal-nombre-v226").value.trim(),
      p_direccion: $("#sucursal-direccion-v226").value.trim() || null,
      p_telefono: $("#sucursal-telefono-v226").value.trim() || null,
    });
  }

  btn.disabled = false;
  btn.textContent = "Guardar";

  if (response.error) {
    errorEl.textContent = response.error.message;
    return;
  }

  cerrarModalSucursalV226();
  await refrescarSucursalesV226();
  await renderSucursalesConfigV226();
  mostrarToast(id ? "Sucursal actualizada" : "Sucursal creada con Caja 1", "success");
}

function abrirModalCajaV226(sucursalId, nombreSucursal) {
  $("#caja-sucursal-id-v226").value = sucursalId;
  $("#caja-sucursal-label-v226").textContent = nombreSucursal || "";
  $("#caja-nombre-v226").value = "";
  $("#caja-error-v226").textContent = "";
  $("#modal-caja-v226").classList.remove("hidden");
  setTimeout(() => $("#caja-nombre-v226")?.focus(), 50);
}

function cerrarModalCajaV226() {
  $("#modal-caja-v226")?.classList.add("hidden");
}

async function crearCajaV226(e) {
  e.preventDefault();

  const { error } = await supabaseClient.rpc("crear_caja_v1", {
    p_sucursal_id: $("#caja-sucursal-id-v226").value,
    p_nombre: $("#caja-nombre-v226").value.trim(),
  });

  if (error) {
    $("#caja-error-v226").textContent = error.message;
    return;
  }

  cerrarModalCajaV226();
  await renderSucursalesConfigV226();
  await refrescarSucursalesV226();
  await cargarCajasSucursalV227({ mantener: true });
  mostrarToast("Caja creada", "success");
}

async function refrescarSucursalesV226() {
  try {
    sucursalesV226 = await listarSucursalesV2();
    renderSelectorSucursalesV226();

    // Si la sucursal activa fue desactivada, pasar a la primera disponible.
    if (
      appContext.branch?.id &&
      !sucursalesV226.some((s) => s.id === appContext.branch.id) &&
      sucursalesV226[0]
    ) {
      await cambiarSucursalV2(sucursalesV226[0].id);
    }
  } catch (error) {
    console.error("[V2.26] refrescar sucursales:", error);
  }
}

async function abrirTransferenciaV226() {
  if (!["owner", "admin", "manager"].includes(appContext.membership?.role)) {
    mostrarToast("No tenés permiso para transferir stock", "error");
    return;
  }

  const activas = (await listarSucursalesV2()) || [];

  if (activas.length < 2) {
    mostrarToast("Necesitás al menos dos sucursales activas", "info");
    return;
  }

  const origen = $("#transfer-origen-v226");
  const destino = $("#transfer-destino-v226");

  const options = activas
    .map((s) => `<option value="${s.id}">${escapeHtml(s.nombre)}</option>`)
    .join("");

  origen.innerHTML = options;
  destino.innerHTML = options;

  origen.value = appContext.branch?.id || activas[0].id;
  destino.value =
    activas.find((s) => s.id !== origen.value)?.id || activas[0].id;

  $("#transfer-cantidad-v226").value = 1;
  $("#transfer-error-v226").textContent = "";

  await cargarProductosTransferV226();
  $("#modal-transferencia-v226").classList.remove("hidden");
}

function cerrarTransferenciaV226() {
  $("#modal-transferencia-v226")?.classList.add("hidden");
}

async function cargarProductosTransferV226() {
  const origenId = $("#transfer-origen-v226")?.value;
  const productoSel = $("#transfer-producto-v226");
  if (!origenId || !productoSel) return;

  const { data, error } = await supabaseClient.rpc(
    "listar_productos_sucursal_v1",
    { p_sucursal_id: origenId }
  );

  if (error) {
    mostrarToast(error.message, "error");
    return;
  }

  productosTransferV226 = (data || []).map(mapearProductoDB);

  productoSel.innerHTML = productosTransferV226
    .map(
      (p) =>
        `<option value="${p.id}">${escapeHtml(productoEtiquetaV29(p))} · stock ${p.stock}</option>`
    )
    .join("");

  actualizarDisponibleTransferV226();
}

function actualizarDisponibleTransferV226() {
  const id = $("#transfer-producto-v226")?.value;
  const p = productosTransferV226.find((x) => x.id === id);
  const el = $("#transfer-stock-disponible-v226");
  if (el) {
    el.textContent = p ? `Disponible en origen: ${p.stock}` : "";
  }
}

async function transferirStockV226(e) {
  e.preventDefault();

  const origen = $("#transfer-origen-v226").value;
  const destino = $("#transfer-destino-v226").value;
  const producto = $("#transfer-producto-v226").value;
  const cantidad = Number($("#transfer-cantidad-v226").value);
  const errorEl = $("#transfer-error-v226");

  errorEl.textContent = "";

  if (origen === destino) {
    errorEl.textContent = "Origen y destino deben ser distintos.";
    return;
  }

  const { error } = await supabaseClient.rpc("transferir_stock_v1", {
    p_producto_id: producto,
    p_origen_id: origen,
    p_destino_id: destino,
    p_cantidad: cantidad,
  });

  if (error) {
    errorEl.textContent = error.message;
    return;
  }

  cerrarTransferenciaV226();
  emitirCambioStockRealtime("transferencia");

  if ([origen, destino].includes(appContext.branch?.id)) {
    await cargarProductos();
    renderGrid();
  }

  await renderSucursalesConfigV226();
  mostrarToast("Stock transferido", "success");
}

async function abrirConfigSucursalesV226() {
  activarTabConfigV224("sucursales");
  await renderSucursalesConfigV226();
}

function setupSucursalesV226() {
  $("#branch-selector-v226")?.addEventListener(
    "change",
    cambiarSucursalDesdeSelectorV226
  );

  $("#btn-nueva-sucursal-v226")?.addEventListener(
    "click",
    () => abrirModalSucursalV226()
  );

  $("#form-sucursal-v226")?.addEventListener("submit", guardarSucursalV226);
  $("#btn-cerrar-sucursal-v226")?.addEventListener("click", cerrarModalSucursalV226);
  $("#btn-cancelar-sucursal-v226")?.addEventListener("click", cerrarModalSucursalV226);
  $("#modal-sucursal-v226 .modal-backdrop")?.addEventListener(
    "click",
    cerrarModalSucursalV226
  );

  $("#form-caja-v226")?.addEventListener("submit", crearCajaV226);
  $("#btn-cerrar-caja-v226")?.addEventListener("click", cerrarModalCajaV226);
  $("#btn-cancelar-caja-v226")?.addEventListener("click", cerrarModalCajaV226);
  $("#modal-caja-v226 .modal-backdrop")?.addEventListener(
    "click",
    cerrarModalCajaV226
  );

  $("#btn-transferir-stock-v226")?.addEventListener(
    "click",
    abrirTransferenciaV226
  );
  $("#form-transferencia-v226")?.addEventListener("submit", transferirStockV226);
  $("#btn-cerrar-transferencia-v226")?.addEventListener(
    "click",
    cerrarTransferenciaV226
  );
  $("#btn-cancelar-transferencia-v226")?.addEventListener(
    "click",
    cerrarTransferenciaV226
  );
  $("#modal-transferencia-v226 .modal-backdrop")?.addEventListener(
    "click",
    cerrarTransferenciaV226
  );

  $("#transfer-origen-v226")?.addEventListener(
    "change",
    cargarProductosTransferV226
  );
  $("#transfer-producto-v226")?.addEventListener(
    "change",
    actualizarDisponibleTransferV226
  );

  document
    .querySelector('[data-config-tab="sucursales"]')
    ?.addEventListener("click", renderSucursalesConfigV226);

  document
    .querySelector('[data-config-go="sucursales"]')
    ?.addEventListener("click", renderSucursalesConfigV226);
}

function init() {
  registrarServiceWorker();
  cargarTema();
  inicializarSelectorVistaProductos();
  inicializarEventos();
  setupV29();
  setupSucursalesV226();
  setupCajaV227();
  iniciarWatchdogRealtime();
  setupInstallPrompt();
  setupOnboarding();
  initAuth();
}

document.addEventListener("DOMContentLoaded", init);

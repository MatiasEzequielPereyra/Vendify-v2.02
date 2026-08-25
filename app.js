/**
 * Stock Kiosco v6 — Fase 2: multi-dispositivo en vivo
 * - Login por email (magic link) vía Supabase Auth
 * - Datos en Supabase Postgres (antes: localStorage)
 * - Realtime: los cambios se ven al instante en todos los dispositivos
 * - Venta / reposición atómica (sin pisar stock entre dispositivos)
 * - PWA instalable + onboarding (se mantienen igual que antes)
 */

const THEME_KEY = "kiosco_theme";
const ONBOARDING_KEY = "kiosco_onboarding_done";
const INSTALL_DISMISS_KEY = "kiosco_install_dismiss";
const MODO_EMPLEADO_KEY = "kiosco_modo_empleado";
const MAX_IMG_SIZE = 400;

let deferredInstallPrompt = null;
let sesionActual = null;
let realtimeChannel = null;
let pinEmpleado = null;
let pinResolverActual = null;

const CATEGORIAS_DEFAULT = [
  "Bebidas", "Golosinas", "Snacks", "Cigarrillos", "Lácteos",
  "Panadería", "Helados", "Limpieza", "Útiles", "Otros",
];

const PRODUCTOS_EJEMPLO = [
  { nombre: "Coca Cola 500ml", categoria: "Bebidas", precioCompra: 800, precioVenta: 1200, stock: 24, stockMinimo: 6 },
  { nombre: "Sprite 500ml", categoria: "Bebidas", precioCompra: 750, precioVenta: 1100, stock: 18, stockMinimo: 6 },
  { nombre: "Agua Villavicencio 500ml", categoria: "Bebidas", precioCompra: 400, precioVenta: 700, stock: 30, stockMinimo: 8 },
  { nombre: "Cerveza Quilmes 473ml", categoria: "Bebidas", precioCompra: 900, precioVenta: 1400, stock: 12, stockMinimo: 4 },
  { nombre: "Alfajor Havanna", categoria: "Golosinas", precioCompra: 600, precioVenta: 1000, stock: 20, stockMinimo: 5 },
  { nombre: "Chocolate Milka 55g", categoria: "Golosinas", precioCompra: 900, precioVenta: 1400, stock: 15, stockMinimo: 4 },
  { nombre: "Caramelos Sugus x5", categoria: "Golosinas", precioCompra: 200, precioVenta: 400, stock: 40, stockMinimo: 10 },
  { nombre: "Chicles Beldent", categoria: "Golosinas", precioCompra: 350, precioVenta: 600, stock: 25, stockMinimo: 8 },
  { nombre: "Papas Lays Clásicas", categoria: "Snacks", precioCompra: 1100, precioVenta: 1700, stock: 10, stockMinimo: 4 },
  { nombre: "Maní salado 100g", categoria: "Snacks", precioCompra: 500, precioVenta: 900, stock: 14, stockMinimo: 5 },
  { nombre: "Palitos salados", categoria: "Snacks", precioCompra: 400, precioVenta: 700, stock: 3, stockMinimo: 5 },
  { nombre: "Marlboro Box 20", categoria: "Cigarrillos", precioCompra: 2800, precioVenta: 3500, stock: 8, stockMinimo: 3 },
  { nombre: "Philip Morris 20", categoria: "Cigarrillos", precioCompra: 2500, precioVenta: 3200, stock: 2, stockMinimo: 3 },
  { nombre: "Yogur La Serenísima", categoria: "Lácteos", precioCompra: 500, precioVenta: 850, stock: 12, stockMinimo: 4 },
  { nombre: "Leche larga vida 1L", categoria: "Lácteos", precioCompra: 900, precioVenta: 1300, stock: 10, stockMinimo: 4 },
  { nombre: "Facturas x unitario", categoria: "Panadería", precioCompra: 300, precioVenta: 500, stock: 16, stockMinimo: 6 },
  { nombre: "Helado Frigor 1L", categoria: "Helados", precioCompra: 2500, precioVenta: 3800, stock: 6, stockMinimo: 2 },
  { nombre: "Servilletas x50", categoria: "Limpieza", precioCompra: 400, precioVenta: 700, stock: 8, stockMinimo: 3 },
  { nombre: "Fósforos", categoria: "Útiles", precioCompra: 150, precioVenta: 300, stock: 20, stockMinimo: 5 },
  { nombre: "Pilas AA x2", categoria: "Útiles", precioCompra: 800, precioVenta: 1300, stock: 1, stockMinimo: 3 },
];

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

// =====================
// Autenticación (Supabase Auth — magic link por email)
// =====================
async function initAuth() {
  const { data } = await supabaseClient.auth.getSession();
  sesionActual = data.session;

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    sesionActual = session;
    if (session) {
      mostrarApp();
    } else {
      mostrarLogin();
      if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
    }
  });

  if (sesionActual) {
    await mostrarApp();
  } else {
    mostrarLogin();
  }
}

function mostrarLogin() {
  $("#auth-screen")?.classList.remove("hidden");
  $(".app")?.classList.add("hidden");
}

async function mostrarApp() {
  $("#auth-screen")?.classList.add("hidden");
  $(".app")?.classList.remove("hidden");
  const email = sesionActual?.user?.email;
  if (email && $("#sesion-email")) $("#sesion-email").textContent = email;

  await cargarCategorias();
  await cargarProductos();
  await cargarConfiguracion();
  actualizarFiltroCategorias();
  renderGrid();
  suscribirRealtime();

  if (localStorage.getItem(MODO_EMPLEADO_KEY) === "1") {
    activarModoEmpleado(false);
  }
}

// =====================
// Modo empleado (PIN — sin usar el mail del dueño)
// =====================
async function cargarConfiguracion() {
  const { data, error } = await supabaseClient
    .from("configuracion")
    .select("pin_empleado")
    .eq("user_id", sesionActual.user.id)
    .maybeSingle();
  pinEmpleado = error ? null : data?.pin_empleado || null;
  actualizarEstadoPinUI();
}

function actualizarEstadoPinUI() {
  const el = $("#pin-empleado-estado");
  if (!el) return;
  el.textContent = pinEmpleado
    ? "✅ PIN configurado. El botón \"Modo empleado\" ya se puede usar."
    : "Todavía no configuraste un PIN.";
}

async function guardarPinEmpleado() {
  const input = $("#pin-empleado");
  const valor = input.value.trim();
  if (!/^\d{4,6}$/.test(valor)) {
    mostrarToast("El PIN debe tener entre 4 y 6 números", "error");
    return;
  }
  const { error } = await supabaseClient
    .from("configuracion")
    .upsert({ user_id: sesionActual.user.id, pin_empleado: valor, actualizado: new Date().toISOString() });
  if (error) {
    mostrarToast("No se pudo guardar el PIN", "error");
    return;
  }
  pinEmpleado = valor;
  input.value = "";
  actualizarEstadoPinUI();
  mostrarToast("PIN guardado");
}

function pedirPin(titulo) {
  return new Promise((resolve) => {
    $("#pin-input").value = "";
    $("#pin-error").textContent = "";
    $("#modal-pin").querySelector("h2").textContent = titulo || "Ingresá el PIN";
    $("#modal-pin").classList.remove("hidden");
    pinResolverActual = resolve;
    setTimeout(() => $("#pin-input").focus(), 50);
  });
}

function cerrarModalPin(resultado) {
  $("#modal-pin").classList.add("hidden");
  if (pinResolverActual) {
    pinResolverActual(resultado);
    pinResolverActual = null;
  }
}

function activarModoEmpleado(mostrarAviso = true) {
  if (!pinEmpleado) {
    mostrarToast("Primero configurá un PIN en Configuración", "error");
    return;
  }
  document.body.classList.add("modo-empleado");
  localStorage.setItem(MODO_EMPLEADO_KEY, "1");
  $("#empleado-bar")?.classList.remove("hidden");
  abrirVenta();
  if (mostrarAviso) mostrarToast("Modo empleado activado — solo pantalla de venta");
}

async function intentarSalirModoEmpleado() {
  const pin = await pedirPin("Ingresá el PIN para salir del modo empleado");
  if (pin === null) return;
  if (pin !== pinEmpleado) {
    mostrarToast("PIN incorrecto", "error");
    return;
  }
  document.body.classList.remove("modo-empleado");
  localStorage.removeItem(MODO_EMPLEADO_KEY);
  $("#empleado-bar")?.classList.add("hidden");
  cerrarVenta();
  mostrarToast("Modo administrador activado");
}

async function enviarMagicLink(e) {
  e.preventDefault();
  const email = $("#auth-email").value.trim();
  if (!email) return;
  const btn = $("#btn-auth-enviar");
  btn.disabled = true;
  btn.textContent = "Enviando...";
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  btn.disabled = false;
  btn.textContent = "Enviar link de acceso";
  if (error) {
    $("#auth-error").textContent = "No se pudo enviar el link: " + error.message;
  } else {
    $("#auth-error").textContent = "";
    $("#auth-form").classList.add("hidden");
    $("#auth-check-email").classList.remove("hidden");
    $("#auth-check-email-addr").textContent = email;
  }
}

async function cerrarSesion() {
  await supabaseClient.auth.signOut();
}

// =====================
// Realtime: los cambios se reflejan al instante en todos los dispositivos
// =====================
function suscribirRealtime() {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  const uid = sesionActual.user.id;

  realtimeChannel = supabaseClient
    .channel("productos-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "productos", filter: `user_id=eq.${uid}` },
      (payload) => {
        aplicarCambioRemoto(payload);
      }
    )
    .subscribe();
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

  const totalStock = productos.reduce((a, p) => a + (p.stock || 0), 0);
  const costoTotal = productos.reduce((a, p) => a + (p.stock || 0) * (p.precioCompra || 0), 0);
  const ventaTotal = productos.reduce((a, p) => a + (p.stock || 0) * (p.precioVenta || 0), 0);
  const stockBajo = productos.filter((p) => p.stock <= (p.stockMinimo ?? 5)).length;

  $("#stat-productos").textContent = productos.length;
  $("#stat-stock").textContent = totalStock;
  $("#stat-costo").textContent = formatearPrecio(costoTotal);
  $("#stat-venta").textContent = formatearPrecio(ventaTotal);
  $("#stat-bajo").textContent = stockBajo;

  if (productos.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
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
      const stockClass = p.stock === 0 ? "cero" : p.stock <= (p.stockMinimo ?? 5) ? "bajo" : "";
      const cardClass = p.stock === 0 ? "stock-cero-card" : p.stock <= (p.stockMinimo ?? 5) ? "stock-bajo-card" : "";
      const compra = p.precioCompra || 0;
      const venta = p.precioVenta || 0;
      const margen = compra > 0 ? Math.round(((venta - compra) / compra) * 100) : null;
      const imgHtml = p.foto
        ? `<img src="${p.foto}" alt="${escapeHtml(p.nombre)}" loading="lazy" />`
        : `<div class="card-img-placeholder">📦</div>`;

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
              <div class="card-precio-row">
                <span class="card-precio-label">Compra</span>
                <span class="card-precio-valor">${formatearPrecio(compra)}</span>
              </div>
              <div class="card-precio-row">
                <span class="card-precio-label">Venta</span>
                <span class="card-precio-valor venta">${formatearPrecio(venta)}</span>
              </div>
              ${margen !== null ? `<div class="card-margen">Margen ${margen >= 0 ? "+" : ""}${margen}%</div>` : ""}
            </div>
            <div class="card-stock-controls">
              <button type="button" data-action="restar" title="Vender 1 (resta stock)">−</button>
              <span class="card-stock-valor" data-action="ajustar" title="Ajuste manual de stock">${p.stock}</span>
              <button type="button" data-action="sumar" title="Reponer 1 (suma stock)">+</button>
            </div>
            <div class="card-acciones">
              <button type="button" class="btn-icon" data-action="editar" title="Editar">✏️</button>
              <button type="button" class="btn-icon danger" data-action="eliminar" title="Eliminar">🗑️</button>
            </div>
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

  const { data, error } = await supabaseClient.rpc("ajustar_stock", {
    p_producto_id: p.id,
    p_delta: delta,
    p_tipo: "ajuste",
  });

  if (error) {
    mostrarToast("No se pudo ajustar el stock", "error");
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
  const p = productos.find((x) => x.id === id);
  if (!p) return;
  if (delta < 0 && p.stock === 0) return;

  const tipo = delta > 0 ? "ingreso" : "venta";
  const { data, error } = await supabaseClient.rpc("ajustar_stock", {
    p_producto_id: id,
    p_delta: delta,
    p_tipo: tipo,
  });

  if (error) {
    mostrarToast("No se pudo actualizar el stock (revisá tu conexión)", "error");
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
  if (document.body.classList.contains("modo-empleado")) {
    intentarSalirModoEmpleado();
    return;
  }
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

  const items = carrito.map((c) => ({ producto_id: c.id, cantidad: c.cantidad }));
  const medioPago = $("#medio-pago").value;

  const { data, error } = await supabaseClient.rpc("registrar_venta", {
    p_items: items,
    p_medio_pago: medioPago,
  });

  btn.textContent = "Cobrar";

  if (error) {
    mostrarToast(error.message || "No se pudo registrar la venta", "error");
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
  a.download = `stock-kiosco-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarToast("CSV exportado");
}

// =====================
// Eventos
// =====================
function inicializarEventos() {
  $("#auth-form")?.addEventListener("submit", enviarMagicLink);
  $("#btn-cerrar-sesion")?.addEventListener("click", cerrarSesion);

  $("#btn-nuevo").addEventListener("click", () => abrirModal());
  $("#btn-empty-nuevo")?.addEventListener("click", () => abrirModal());
  $("#btn-vender").addEventListener("click", abrirVenta);
  $("#btn-cerrar-venta").addEventListener("click", cerrarVenta);
  $("#modal-venta .modal-backdrop").addEventListener("click", () => {
    if (!document.body.classList.contains("modo-empleado")) cerrarVenta();
  });

  $("#btn-modo-empleado")?.addEventListener("click", () => activarModoEmpleado(true));
  $("#btn-salir-modo-empleado")?.addEventListener("click", intentarSalirModoEmpleado);
  $("#btn-guardar-pin")?.addEventListener("click", guardarPinEmpleado);
  $("#pin-empleado")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); guardarPinEmpleado(); }
  });
  $("#btn-cerrar-pin")?.addEventListener("click", () => cerrarModalPin(null));
  $("#btn-pin-cancelar")?.addEventListener("click", () => cerrarModalPin(null));
  $("#btn-pin-confirmar")?.addEventListener("click", () => cerrarModalPin($("#pin-input").value.trim()));
  $("#pin-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); cerrarModalPin($("#pin-input").value.trim()); }
  });
  $("#modal-pin .modal-backdrop")?.addEventListener("click", () => cerrarModalPin(null));
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
      case "sumar": cambiarStock(id, 1); break;
      case "restar": cambiarStock(id, -1); break;
      case "ajustar": abrirModalStock(id); break;
      case "editar": {
        const p = productos.find((x) => x.id === id);
        if (p) abrirModal(p);
        break;
      }
      case "eliminar": eliminarProducto(id); break;
    }
  });

  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    const escribiendo = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (e.key === "Escape") {
      if (!$("#modal-pin").classList.contains("hidden")) cerrarModalPin(null);
      else if (!$("#modal").classList.contains("hidden")) cerrarModal();
      else if (!$("#modal-venta").classList.contains("hidden")) {
        if (!document.body.classList.contains("modo-empleado")) cerrarVenta();
      }
      else if (!$("#modal-config").classList.contains("hidden")) cerrarConfig();
      else if (!$("#modal-confirm").classList.contains("hidden")) {
        cerrarConfirm();
        if (confirmCallback) confirmCallback(false);
      } else if (!$("#modal-stock").classList.contains("hidden")) cerrarModalStock();
      return;
    }
    if (escribiendo) return;
    if (document.body.classList.contains("modo-empleado")) return;

    if (e.key === "n" || e.key === "N") { e.preventDefault(); abrirModal(); }
    else if (e.key === "v" || e.key === "V") { e.preventDefault(); abrirVenta(); }
    else if (e.key === "/") { e.preventDefault(); $("#buscador").focus(); }
    else if (e.key === "t" || e.key === "T") { e.preventDefault(); toggleTema(); }
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

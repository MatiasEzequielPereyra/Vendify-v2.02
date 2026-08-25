# Stock Kiosco

App de control de stock **y ventas** para kioscos. **PWA instalable**, con **sincronización en vivo entre dispositivos** (celular, tablet, PC) usando Supabase.

## 🚀 Puesta en marcha (una sola vez)

### 1. Crear el backend en Supabase (gratis)
1. Entrá a [supabase.com](https://supabase.com) y creá una cuenta + un proyecto nuevo.
2. En el panel del proyecto, andá a **SQL Editor → New query**, pegá todo el contenido de
   [`supabase/schema.sql`](./supabase/schema.sql) y apretá **Run**.
   Esto crea las tablas (`productos`, `categorias`, `movimientos`), la seguridad por usuario (RLS)
   y la función `ajustar_stock`.
3. Corré también [`supabase/schema_ventas.sql`](./supabase/schema_ventas.sql) en el SQL Editor
   (otra consulta nueva). Esto agrega el sistema de ventas: tablas `ventas` y `venta_items`,
   más la función `registrar_venta` que cobra un carrito completo y descuenta todo el stock
   de una sola vez.
4. Corré también [`supabase/schema_config.sql`](./supabase/schema_config.sql) (otra consulta
   nueva). Esto agrega la tabla `configuracion`, donde se guarda el PIN del modo empleado.
5. Andá a **Authentication → Providers** y confirmá que **Email** esté habilitado (login por magic link,
   sin contraseña).
6. Andá a **Authentication → URL Configuration** y poné tu dominio real (no `localhost`) en
   **Site URL**, y agregalo también en **Redirect URLs** (podés usar un comodín, ej.
   `https://tu-dominio.com/*`). Si esto queda mal configurado, el link del email termina
   llevando a `localhost:3000`.
7. Andá a **Project Settings → API** y copiá:
   - **Project URL**
   - **anon public key**

### 2. Configurar la app
Abrí `supabase-config.js` y pegá ahí esos dos valores:

```js
const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
const SUPABASE_ANON_KEY = "TU-ANON-KEY-ACA";
```

### 3. Publicar
Subí la carpeta a Netlify, Vercel, Cloudflare Pages o GitHub Pages (con HTTPS).

### 4. Usarla
Entrá desde el celular, la tablet y la PC, ingresá con el mismo email en cada uno.
Cualquier venta, reposición o edición que hagas en un dispositivo aparece **al instante**
en los demás (sin recargar la página) — es Supabase Realtime.

---

## Modo Venta (caja registradora)

Botón **🧾 Vender** en el header (o tecla **V**):

1. El empleado busca y toca los productos que va cobrando → se van sumando al carrito.
2. Puede ajustar cantidades con +/− o quitar un producto.
3. Elige el medio de pago y toca **Cobrar**.
4. Se descuenta el stock de **todos** los productos del carrito de una sola vez, se guarda
   el ticket (`ventas` + `venta_items`) y aparece reflejado al instante en cualquier otro
   dispositivo conectado.

Si en el momento de cobrar no queda stock suficiente de algo (por ejemplo, se vendió desde
otro dispositivo segundos antes), la venta completa se cancela y no se cobra nada — así nunca
queda una venta "a medias" ni un stock inconsistente.

## Modo empleado (PIN, sin usar tu mail)

Pensado para que un empleado use el dispositivo del mostrador para vender y consultar stock,
sin poder crear, editar ni borrar productos, ajustar stock a mano, tocar categorías,
configuración ni exportar datos — y sin necesitar el mail del dueño en ningún momento.

**Configurarlo (el dueño, una sola vez):**
1. Iniciá sesión normalmente con tu mail.
2. Abrí **⚙️ Config → Modo empleado** y definí un PIN de 4 a 6 números.

**Usarlo en el mostrador:**
1. Con la sesión del dueño ya abierta en ese dispositivo, tocá **🔒 Modo empleado**.
2. La interfaz queda igual que siempre (stock, búsqueda, historial, botón Vender), pero
   desaparecen los botones de crear/editar/borrar productos, los +/− de stock en cada
   tarjeta, Configuración y Exportar CSV. El empleado sigue pudiendo vender normalmente
   desde **🧾 Vender**.
3. Para volver a modo administrador, el mismo botón ahora dice **🔓 Salir modo empleado**:
   tocalo e ingresá el PIN de administrador que configuraste en el paso anterior.

El bloqueo se guarda en ese dispositivo (persiste aunque se cierre y reabra la app), así que
lo normal es configurarlo una vez en la tablet o compu del mostrador y dejarla siempre así.

> Nota: esto es una traba de uso, no una cuenta de usuario separada. Por debajo, todo sigue
> guardándose con el mismo usuario (el dueño); el PIN solo oculta las acciones de edición
> para que el empleado no las toque, sin querer o queriendo.

## Historial de ventas (tickets)

Botón **📋 Historial** en el header: lista cada venta cobrada, con fecha, hora, total, medio
de pago, y al desplegarla, el detalle de qué productos y cantidades incluyó.

Tiene un filtro rápido por período (Hoy / Ayer / Últimos 7 días / Este mes / Todo) y muestra
arriba el total de tickets y lo vendido en ese rango, para tener un control rápido de cómo
viene el día o la semana.

## Control de stock manual (fuera del modo venta)

- **Botón "−" en la tarjeta** → venta rápida de 1 unidad.
- **Botón "+" en la tarjeta** → ingreso (reponer mercadería).
- **Click en el número de stock** → ajuste manual (corregir un conteo).

Todos estos movimientos (incluidas las ventas del carrito) quedan en la tabla `movimientos`,
para tener un historial completo de qué pasó con cada producto.

---

## Qué tiene hoy

- ✅ Login por email (sin contraseña) — cada kiosco ve solo sus propios datos
- ✅ Stock sincronizado en vivo entre todos los dispositivos (Supabase Realtime)
- ✅ **Modo Venta**: carrito, cobro y descuento de stock atómico para varios productos a la vez
- ✅ **Historial de ventas**: cada ticket con fecha, hora, total, medio de pago y detalle de artículos, filtrable por período
- ✅ **Modo empleado con PIN**: el mostrador vende (y consulta stock) sin poder editar nada
  ni usar el mail del dueño
- ✅ Venta rápida / reposición / ajuste manual con historial de movimientos
- ✅ Fotos, precio de compra/venta y margen
- ✅ Categorías configurables
- ✅ Alertas y filtro de stock bajo
- ✅ Export CSV
- ✅ Tema claro/oscuro
- ✅ PWA instalable + cache offline de la interfaz (los datos requieren conexión)
- ✅ Onboarding de primera vez

## Roadmap para seguir comercializando

### Corto plazo
- Impresión o envío del ticket (PDF / WhatsApp)
- Cola de acciones pendientes cuando no hay internet, para no perder ventas offline
- Código de barras (escaneo con la cámara) para agregar al carrito más rápido
- Reportes más avanzados: producto más vendido, margen del mes, comparar períodos
  (ya está toda la data en `ventas` / `venta_items`; el historial de hoy es la base de esto)

### Mediano plazo
- Roles reales por usuario (hoy el modo empleado es una traba de PIN, no una cuenta
  separada con permisos propios en Supabase)
- Multi-local (un mismo dueño con más de un kiosco)
- Plan free limitado + plan Pro mensual

---

## Estructura

```
kiosco-stock/
├── index.html
├── styles.css
├── app.js
├── supabase-config.js       ← completar con tu URL y anon key
├── supabase/
│   ├── schema.sql            ← correr primero (stock básico)
│   ├── schema_ventas.sql     ← correr después (modo venta / carrito)
│   └── schema_config.sql     ← correr después (PIN de modo empleado)
├── sw.js                     ← service worker (offline de la interfaz)
├── manifest.json             ← PWA
├── icons/
└── README.md
```

## Nota técnica

Los datos viven en Supabase (Postgres), no en el navegador. Cada dispositivo se autentica
con el mismo email y ve/edita los mismos productos en tiempo real gracias a Supabase Realtime,
protegidos por Row Level Security (cada usuario solo accede a sus propias filas). El cobro de
una venta con varios productos se resuelve en una sola transacción de base de datos
(`registrar_venta`), evitando ventas parciales o stock inconsistente entre dispositivos. El
modo empleado es un bloqueo de interfaz (con guarda también en el código, no solo visual):
todas las acciones de edición se siguen ejecutando con el mismo usuario dueño por debajo, el
PIN solo decide si esos botones están disponibles en ese dispositivo en ese momento.


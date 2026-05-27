# 🚀 Guía Rápida de Uso - Xiaomi Cartagena

## ⚡ Inicio Rápido

### Para Comenzar a Vender

1. **Configura PayPal** (Ver `/PAYPAL_CONFIG.md`):
   - Obtén tu Client ID de PayPal
   - Reemplázalo en `/src/app/components/CartDialog.tsx`

2. **Personaliza tu tienda**:
   - Ve a `/admin` 
   - Pestaña "Productos": agrega/edita productos
   - Pestaña "Banners": configura el carrusel

3. **¡Listo para vender!** 🎉

## 👥 Cómo Usar Como Cliente

### Comprar Productos

1. **Navega** por las categorías en el header
2. **Haz clic** en un producto para ver detalles
3. **Agrega al carrito** con el botón naranja
4. **Ve al carrito** haciendo clic en el ícono 🛒
5. **Procede al pago** y paga con PayPal
6. ¡Recibirás confirmación por email!

### Ver el Catálogo

- **Inicio** (`/`): productos destacados y banners
- **Móviles** (`/moviles`): smartphones Xiaomi
- **Smartwatch** (`/smartwatch`): relojes inteligentes
- **Audífonos** (`/audifonos`): audio premium
- **Accesorios** (`/accesorios`): cargadores, fundas, etc.
- **Scooter** (`/scooter`): scooters eléctricos
- **POCO** (`/poco`): línea gaming

## 👨‍💼 Cómo Usar Como Administrador

### Acceder al Panel

1. Haz clic en **"Admin"** en el header (esquina superior derecha)
2. O visita directamente `/admin`

### Gestionar Productos

**Pestaña "Productos"**:

- ✏️ **Editar**: clic en lápiz azul
- 🗑️ **Eliminar**: clic en tacho rojo
- ➕ **Agregar**: clic en botón "Agregar en [Categoría]"

**Al crear/editar**:
1. Completa nombre, precio, stock, descripción
2. Sube una imagen o pega URL
3. Guarda los cambios

### Ver Órdenes de Clientes

**Pestaña "Órdenes"**:

- 📊 **Estadísticas**: total órdenes, pendientes, ingresos
- 🔍 **Buscar**: por número de orden, nombre o email
- 🎨 **Filtrar**: por estado (pendiente, procesando, completada)
- 🔄 **Cambiar estado**: 
  - Pendiente → Procesando → Completada
  - O cancelar si es necesario

**Estados de Orden**:
- 🟡 **Pendiente**: orden recién recibida
- 🔵 **Procesando**: preparando el envío
- 🟢 **Completada**: orden entregada
- 🔴 **Cancelada**: orden cancelada

### Gestionar Banners

**Pestaña "Banners"**:

1. Selecciona un banner existente o crea uno nuevo
2. Edita título, subtítulo, descripción
3. Configura el botón (texto y enlace)
4. Cambia la imagen de fondo
5. Guarda los cambios

### Notificaciones

**Cuando llega una nueva orden**:
- 🔴 Badge rojo en "Admin" en el header
- 🔔 Campanita con contador en el panel admin
- 🎉 Banner verde de bienvenida al entrar a "Órdenes"

**Cómo funcionan**:
1. Cliente completa una compra → se crea notificación
2. Aparece badge en header con número de órdenes nuevas
3. Al entrar a "Órdenes", se marcan como leídas
4. Badge desaparece automáticamente

## 🛠️ Funciones Avanzadas

### Sincronización Automática

Todo lo que cambies en el admin **se refleja inmediatamente** en el landing:
- Productos nuevos aparecen en el catálogo
- Cambios de precio se actualizan en vivo
- Stock se reduce automáticamente al comprar
- Banners se actualizan en la página de inicio

### Conversión de Divisas

Los precios se muestran automáticamente en:
- 💵 **USD**: precio base
- 🇨🇴 **COP**: conversión automática (1 USD = 4200 COP)

Puedes cambiar la tasa en cualquier archivo donde veas:
```typescript
const EXCHANGE_RATE = 4200;
```

### Control de Stock

El sistema controla automáticamente:
- ✅ **Alertas** cuando quedan menos de 10 unidades
- ✅ **Bloqueo** de compras si no hay stock
- ✅ **Reducción** automática al completar una compra
- ✅ **Validación** en el carrito y al pagar

## 📱 Responsive

La tienda funciona perfectamente en:
- 📱 **Móviles**: diseño optimizado táctil
- 💻 **Tablets**: layout adaptativo
- 🖥️ **Desktop**: experiencia completa

## ⚠️ Notas Importantes

### Datos y Persistencia

- Todos los datos se guardan en **localStorage** del navegador
- Los datos persisten al recargar la página
- Los datos NO se comparten entre usuarios/dispositivos
- Para producción real, necesitas una base de datos

### PayPal

- **Sandbox**: usa cuentas de prueba para testing
- **Live**: usa el Client ID de producción para ventas reales
- Ver guía completa en `/PAYPAL_CONFIG.md`

### Seguridad

Esta implementación es para **demostración/desarrollo**:
- ⚠️ No es segura para manejar datos sensibles de clientes
- ⚠️ No tiene autenticación de administrador
- ⚠️ No cifra información personal

Para producción, implementa:
- Backend con base de datos
- Autenticación segura
- HTTPS obligatorio
- Cifrado de datos

## 🆘 Solución de Problemas

### "PayPal no carga"
→ Verifica que hayas configurado el Client ID correcto

### "Las órdenes no aparecen"
→ Asegúrate de que el pago se completó en PayPal

### "El stock no se actualiza"
→ Recarga la página para sincronizar localStorage

### "Perdí mis datos"
→ Los datos están en localStorage, no los borres con "Limpiar cookies"

## 📞 Soporte

Para más información:
- 📧 **Email**: xiaomi.cartagenaventas@gmail.com
- 📱 **Teléfono**: +57 3022875280
- 📍 **Dirección**: Cl. 31 #61-64, Cartagena, Colombia

## 📚 Documentación Adicional

- `/PAYPAL_CONFIG.md`: Configuración detallada de PayPal
- `/SISTEMA_COMPLETO.md`: Documentación técnica completa

---

**¡Tu tienda está lista para vender! 🎉**

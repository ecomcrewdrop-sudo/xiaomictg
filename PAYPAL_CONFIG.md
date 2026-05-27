# Configuración de PayPal para Xiaomi Cartagena

## 🔧 Cómo configurar PayPal en tu tienda

Para que los pagos con PayPal funcionen correctamente, necesitas obtener tu **Client ID** de PayPal y configurarlo en la aplicación.

### Paso 1: Crear una cuenta de PayPal Developer

1. Ve a [PayPal Developer](https://developer.paypal.com/)
2. Inicia sesión con tu cuenta de PayPal (o crea una si no tienes)
3. Acepta los términos de servicio para desarrolladores

### Paso 2: Crear una aplicación

1. En el dashboard de PayPal Developer, ve a **"My Apps & Credentials"**
2. Asegúrate de estar en el modo **"Sandbox"** para pruebas (o "Live" para producción)
3. Haz clic en **"Create App"**
4. Dale un nombre a tu aplicación (ej: "Xiaomi Cartagena Store")
5. Haz clic en **"Create App"**

### Paso 3: Obtener tu Client ID

1. Una vez creada la aplicación, verás tu **Client ID** en la página de detalles
2. Copia el **Client ID**

### Paso 4: Configurar el Client ID en la aplicación

1. Abre el archivo `/src/app/components/CartDialog.tsx`
2. Busca la línea que contiene:
   ```typescript
   const PAYPAL_CLIENT_ID = 'AeN9h8Z7Kx8P5qJR_YOUR_ACTUAL_PAYPAL_CLIENT_ID_HERE';
   ```
3. Reemplaza `'AeN9h8Z7Kx8P5qJR_YOUR_ACTUAL_PAYPAL_CLIENT_ID_HERE'` con tu Client ID real
4. Guarda el archivo

### Paso 5: Probar los pagos

#### Modo Sandbox (Pruebas)
- En modo Sandbox, puedes usar cuentas de prueba de PayPal
- PayPal Developer te proporciona cuentas de prueba automáticamente
- Ve a **"Sandbox" > "Accounts"** para ver las credenciales de prueba
- Usa estas credenciales al hacer checkout para probar sin dinero real

#### Modo Live (Producción)
1. Cuando estés listo para aceptar pagos reales:
   - Ve a tu aplicación en PayPal Developer
   - Cambia de "Sandbox" a "Live"
   - Obtén el nuevo Client ID de producción
   - Actualiza el Client ID en el código

## 📋 Características implementadas

### Para Clientes:
- ✅ Carrito de compras funcional
- ✅ Checkout con PayPal integrado
- ✅ Formulario para nombre y email del cliente
- ✅ Confirmación de pago en tiempo real
- ✅ Reducción automática del stock al comprar

### Para Administradores:
- ✅ Panel de órdenes con todas las compras
- ✅ Notificaciones de nuevas órdenes (badge rojo en el header)
- ✅ Información completa del cliente y productos
- ✅ Gestión de estados de orden: Pendiente → Procesando → Completada
- ✅ Estadísticas de ventas y ingresos
- ✅ Filtrado y búsqueda de órdenes

## 🔔 Sistema de Notificaciones

El sistema de notificaciones funciona así:

1. **Cuando un cliente compra:**
   - La orden se crea automáticamente
   - Aparece un badge rojo en "Admin" en el header
   - El badge muestra el número de órdenes nuevas

2. **Cuando el admin ve las órdenes:**
   - Al entrar a la pestaña "Órdenes", el badge desaparece
   - Las órdenes se marcan como "leídas" automáticamente

## 💾 Almacenamiento de Datos

Actualmente, todos los datos se guardan en **localStorage** del navegador:
- ✅ Productos del catálogo
- ✅ Banners publicitarios  
- ✅ Órdenes de compra
- ✅ Carrito de compras

**Nota:** Para una tienda en producción real, se recomienda usar una base de datos en servidor.

## ⚠️ Importante

- Esta implementación usa localStorage, por lo que los datos solo persisten en el navegador actual
- Para una tienda real, necesitarás:
  - Un backend con base de datos
  - Webhooks de PayPal para confirmar pagos
  - Sistema de emails para confirmaciones
  - Gestión de envíos
  - Política de privacidad y términos de servicio reales

## 🆘 Soporte

Si tienes problemas con la configuración de PayPal:
- Revisa la [documentación oficial de PayPal](https://developer.paypal.com/docs/)
- Verifica que el Client ID sea correcto
- Asegúrate de estar usando el Client ID del modo correcto (Sandbox o Live)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages are required' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key is missing' });
  }

  try {
    const db = await getDb();
    const products = await db.collection('products').find({}).toArray();

    // ─── CONSTRUIR CATÁLOGO PRECISO ────────────────────────────────────────
    // El ID que se usa en la URL /product/:id y en el tag [PRODUCT:ID] es SIEMPRE p.id
    // Nunca usar _id de MongoDB para los tags del frontend.

    const catalogLines: string[] = [];

    for (const p of products as any[]) {
      // El ID que el frontend reconoce — siempre p.id
      const frontendId = p.id || '';
      if (!frontendId) continue; // Productos sin ID ignorados

      const name = p.name || 'Sin nombre';
      const basePrice = p.price || 0;

      // ── Calcular disponibilidad global ──
      let totalStock = p.stock || 0;
      const hasStorage = p.storageVariants && p.storageVariants.length > 0;
      const hasColor   = p.colorVariants   && p.colorVariants.length   > 0;

      if (hasStorage) {
        totalStock = p.storageVariants.reduce((s: number, v: any) => s + (v.stock ?? 0), 0);
      } else if (hasColor) {
        totalStock = p.colorVariants.reduce((s: number, v: any) => s + (v.stock ?? 0), 0);
      }

      const globalStatus = totalStock > 0 ? '✅ DISPONIBLE' : '❌ AGOTADO';

      // ── Cabecera del producto ──
      let line = `\n📦 PRODUCTO: "${name}"`;
      line += `\n   ID (para el tag): ${frontendId}`;
      line += `\n   Precio base: $${basePrice.toLocaleString('es-CO')} COP`;
      line += `\n   Estado global: ${globalStatus} (${totalStock} uds totales)`;

      if (p.description) {
        line += `\n   Descripción: ${p.description.slice(0, 180)}`;
      }

      // ── Variantes de almacenamiento (con precios y stock EXACTOS) ──
      if (hasStorage) {
        line += `\n   VARIACIONES DE ALMACENAMIENTO:`;
        for (const v of p.storageVariants) {
          const st = v.stock ?? 0;
          const statusIcon = st > 0 ? '✅' : '❌';
          line += `\n     • ${v.storage}: $${v.price.toLocaleString('es-CO')} COP | Stock: ${st} | ${statusIcon}`;
          line += `\n       → Para mostrar esta versión: [PRODUCT:${frontendId}:${v.price}]`;
        }
      }

      // ── Variantes de color (con stock por color) ──
      if (hasColor) {
        line += `\n   COLORES DISPONIBLES:`;
        for (const c of p.colorVariants) {
          const st = c.stock ?? 0;
          const statusIcon = st > 0 ? '✅' : '❌';
          line += `\n     • ${c.color}: Stock ${st} | ${statusIcon}`;
        }
        // Para productos solo con colores (sin storage variants), precio es el base
        if (!hasStorage) {
          line += `\n       → Para mostrar este producto: [PRODUCT:${frontendId}:${basePrice}]`;
        }
      }

      // ── Producto sin variantes ──
      if (!hasStorage && !hasColor) {
        line += `\n   → Para mostrar este producto: [PRODUCT:${frontendId}:${basePrice}]`;
      }

      catalogLines.push(line);
    }

    const catalogInfo = catalogLines.join('\n') || 'No hay productos en el catálogo.';

    // ─── SYSTEM PROMPT ─────────────────────────────────────────────────────
    const systemPrompt = `Eres Karol Garcia, asesora de ventas de "Xiaomi Cartagena" en Cartagena, Colombia.
NUNCA digas que eres IA, bot ni asistente virtual. Eres una vendedora humana, cálida y experta.
Personalidad: carismática, amable, persuasiva, con expresiones naturales colombianas.

════════════════════════════════════════════════
🔴 REGLA #1 — TAGS DE PRODUCTO (LEE CON CUIDADO)
════════════════════════════════════════════════
Al mencionar un producto DISPONIBLE (✅), escribe el tag así:
  [PRODUCT:ID_EXACTO:PRECIO_SIN_PUNTOS_NI_SIMBOLOS]

Reglas del tag:
- ID = el valor exacto de "ID (para el tag):" en el catálogo. NUNCA lo inventes.
- PRECIO = solo dígitos, sin puntos, sin $, sin COP. Ej: 470000
- Si el producto/variante es ❌ AGOTADO, NO escribas el tag. Solo menciona el nombre.
- Para variantes de almacenamiento: el catálogo ya te dice exactamente el tag a usar → cópialo literal.

═══════════════════════════════════════
🔴 REGLA #2 — STOCK (MÁXIMA PRIORIDAD)
═══════════════════════════════════════
- Revisa el estado ✅/❌ de CADA variante por separado.
- SOLO recomienda variantes con ✅ y stock > 0.
- Si piden algo ❌, díselo amablemente y ofrece la alternativa disponible más parecida.

═══════════════════════════════════════════════════════════
🔴 REGLA #3 — BOTONES DE CIERRE (ÁRBOL DE DECISIÓN EXACTO)
═══════════════════════════════════════════════════════════

Esta es la regla MÁS IMPORTANTE. Lee el método de pago elegido por el cliente y aplica EXACTAMENTE:

SI el cliente eligió EFECTIVO:
  → Usa: [WHATSAPP_BUTTON:Hola Karol, hice mi pedido y pagaré en efectivo contra entrega]
  → PROHIBIDO usar [BOLD_BUTTON].

SI el cliente eligió NEQUI:
  → Usa: [WHATSAPP_BUTTON:Hola Karol, hice mi pedido y pagaré por Nequi contra entrega]
  → MUY IMPORTANTE: Todo se paga CONTRA ENTREGA (al recibir el producto). NUNCA pidas comprobante de pago por adelantado.

SI el cliente eligió TRANSFERENCIA BANCARIA:
  → Usa: [WHATSAPP_BUTTON:Hola Karol, hice mi pedido y pagaré por transferencia contra entrega]
  → MUY IMPORTANTE: NUNCA pidas comprobante por adelantado, el cliente paga al recibir.

SI el cliente eligió TARJETA (datáfono contra entrega):
  → Usa: [WHATSAPP_BUTTON:Hola Karol, hice mi pedido y pagaré con tarjeta (datáfono) contra entrega]
  → PROHIBIDO usar [BOLD_BUTTON].

SI el cliente eligió BOLD (pago en línea con tarjeta):
  → Usa: [BOLD_BUTTON:TOTAL_SIN_PUNTOS]
  → Este es el ÚNICO caso donde se usa [BOLD_BUTTON].

⚠️ RESUMEN CRÍTICO:
  [BOLD_BUTTON] = EXCLUSIVO para "BOLD" o "pago en línea". NUNCA para efectivo, nequi, transferencia ni tarjeta datáfono.
  [WHATSAPP_BUTTON] = Para TODOS los demás métodos de pago.

══════════════════════════════════
PROTOCOLO DE VENTA — PASO A PASO
══════════════════════════════════
Cuando el cliente quiera comprar, sigue SIEMPRE este orden:

PASO 1 — PIDE DATOS PERSONALES:
  "¡Genial! Para procesar tu pedido necesito: Nombre completo, Número de cédula, Teléfono y Correo electrónico."
  Espera a que el cliente dé TODOS estos datos antes de continuar.

PASO 2 — PREGUNTA ENTREGA:
  "¿Te enviamos el equipo a domicilio ($10.000 COP, llega en ~1 hora) o prefieres venir a recogerlo gratis a nuestra tienda en Los Ángeles?"
  - Si elige domicilio → pide BARRIO y DIRECCIÓN EXACTA.
  - Si elige retiro en tienda → confirma que puede pasar a Cl. 31 #61-64.

PASO 3 — PREGUNTA MÉTODO DE PAGO:
  "¿Cómo prefieres pagar? Tenemos: Efectivo contra entrega, Nequi, Transferencia bancaria, Tarjeta (datáfono contra entrega), o Bold (pago en línea con tarjeta, tiene un 5% de recargo)."
  Espera la respuesta del cliente.

PASO 4 — CALCULA EL TOTAL:
  Total final = precio del producto
              + $10.000 (SOLO si eligió domicilio)
              + 5% del subtotal (SOLO si eligió Bold o pago en línea)
  
  Ejemplos:
  - Producto $470.000 + Domicilio + Efectivo = $480.000
  - Producto $470.000 + Domicilio + Bold = $480.000 + 5% de $480.000 = $504.000
  - Producto $470.000 + Retiro + Efectivo = $470.000

PASO 5 — MUESTRA RESUMEN Y CIERRA (EL PASO FINAL):
  Envía EXACTAMENTE este formato, sin texto adicional entre los tags:
  
  [ORDER_SUMMARY:Nombre|Cédula|Teléfono|Entrega|Direccion|Pago|Total|Producto]
  [BOTÓN_CORRECTO_SEGÚN_REGLA_3]
  
  ⚠️ REGLAS DE ORO PARA EL CIERRE:
  1. El tag [ORDER_SUMMARY] es OBLIGATORIO.
  2. El botón ([WHATSAPP_BUTTON] o [BOLD_BUTTON]) es OBLIGATORIO.
  3. NO escribas el resumen con tus propias palabras, usa el tag.
  4. En el campo "Direccion", pon la dirección completa y barrio si es domicilio. Si es retiro en tienda, pon "Retiro en tienda".
  5. NO escribas mensajes largos después del resumen. Solo una frase de despedida cordial DESPUÉS del botón.

══════════════════
INFORMACIÓN TIENDA
══════════════════
- Domicilio: $10.000 COP, toda Cartagena, ~1 hora de espera.
- Retiro en tienda: Gratis. Cl. 31 #61-64, Los Ángeles, Cartagena. Lun–Vie 9AM–6PM.
- Efectivo / Nequi / Transferencia / Tarjeta: TODO es 100% PAGO CONTRA ENTREGA. NUNCA se paga por adelantado.
- Bold (pago en línea) / Tarjeta: +5% de recargo sobre el subtotal.

════════════════════════════════════
📋 CATÁLOGO COMPLETO EN TIEMPO REAL
════════════════════════════════════
${catalogInfo}

══════════════════════════
INSTRUCCIONES DE RESPUESTA
══════════════════════════
- Responde de forma natural y conversacional. No seas robótica.
- Mantén respuestas cortas, máximo 3-4 párrafos.
- Si ya tienes todos los datos, procede directamente al PASO 5.
- EJEMPLO DE CIERRE CORRECTO:
  "¡Perfecto! Aquí tienes el resumen de tu pedido. Dale clic al botón de abajo para finalizar en WhatsApp y coordinar la entrega ahora mismo:
  [ORDER_SUMMARY:Juan Perez|123456|300123|Domicilio|Calle 123 #45-67 Barrio Centro|Nequi|480000|Redmi Note 13]
  [WHATSAPP_BUTTON:Hola Karol, ya tengo mi resumen y quiero confirmar mi pedido de Nequi]
  ¡Quedo atenta a tu mensaje!"`;

    // ─── LLAMADA A OPENAI ──────────────────────────────────────────────────
    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature: 0.1,   // Temperatura mínima = máxima adherencia a las reglas
        max_tokens: 1000
      })
    });

    if (!openAiResponse.ok) {
      const errorData = await openAiResponse.json();
      throw new Error(errorData.error?.message || 'OpenAI API Error');
    }

    const data = await openAiResponse.json();
    const reply = data.choices[0].message;

    return res.status(200).json({ reply });
  } catch (error: any) {
    console.error('Error in chat API:', error);
    return res.status(500).json({ error: error.message });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';

const BOLD_API_KEY = process.env.BOLD_API_KEY;
const BOLD_SECRET_KEY = process.env.BOLD_SECRET_KEY;

if (!BOLD_API_KEY || !BOLD_SECRET_KEY) {
  console.error('[bold-checkout] Faltan BOLD_API_KEY o BOLD_SECRET_KEY en variables de entorno');
}

async function computeIntegrity(orderId: string, amount: number, currency: string): Promise<string> {
  const message = `${orderId}${amount}${currency}${BOLD_SECRET_KEY}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!BOLD_API_KEY || !BOLD_SECRET_KEY) {
    return res.status(500).send('<h1>Error de configuración: claves de pago no disponibles</h1>');
  }

  const {
    orderId,
    amount,
    currency = 'COP',
    redirectionUrl,
    description,
  } = req.query as Record<string, string>;

  if (!orderId || !amount) {
    return res.status(400).send('<h1>Parámetros faltantes</h1>');
  }

  const amountInt = Math.round(Number(amount));
  const integrity = await computeIntegrity(orderId, amountInt, currency);
  const safeRedirect = redirectionUrl || 'https://xiaomi-cartagena-ivory.vercel.app/?bold_status=success';
  const desc = description || `Pedido Xiaomi Cartagena ${orderId}`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Pago seguro — Xiaomi Cartagena</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;background:#0f0f0f;display:flex;align-items:center;justify-content:center;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff}
    .wrap{text-align:center;padding:2rem;max-width:420px;width:100%}
    .brand{font-size:1.3rem;font-weight:800;letter-spacing:-.04em;color:#ff6900;margin-bottom:2rem}
    .brand span{color:#fff}
    .title{font-size:1.3rem;font-weight:600;margin-bottom:.4rem}
    .sub{font-size:.9rem;color:rgba(255,255,255,.6);margin-bottom:2rem}
    .info{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
          border-radius:12px;padding:1.5rem;margin-bottom:2rem}
    .info .label{font-size:.75rem;color:rgba(255,255,255,.5);text-transform:uppercase;
                  letter-spacing:.08em;margin-bottom:.5rem}
    .info .val{font-size:1.6rem;font-weight:700;color:#ff6900}
    .info .oid{font-size:.85rem;color:rgba(255,255,255,.4);margin-top:.5rem}
    #bold-btn-wrap{margin-top:1rem;display:flex;justify-content:center;min-height:50px}
    .back{display:inline-block;margin-top:2rem;padding:.6rem 1.2rem;background:transparent;
          border:1px solid rgba(255,255,255,.15);border-radius:8px;color:rgba(255,255,255,.6);
          text-decoration:none;font-size:.85rem;cursor:pointer;transition:all .2s}
    .back:hover{border-color:rgba(255,255,255,.4);color:#fff}
    .secure{margin-top:2rem;font-size:.75rem;color:rgba(255,255,255,.3);letter-spacing:.04em}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">XIAOMI <span>Cartagena</span></div>
    
    <p class="title">Resumen de tu pedido</p>
    <p class="sub">Haz clic en el botón de abajo para pagar de forma segura</p>
    
    <div class="info">
      <div class="label">Total a pagar</div>
      <div class="val">$${amountInt.toLocaleString('es-CO')} COP</div>
      <div class="oid">Pedido ${orderId}</div>
    </div>

    <!-- BOLD button rendered here -->
    <div id="bold-btn-wrap">
      <script
        src="https://checkout.bold.co/library/boldPaymentButton.js"
        data-bold-button="dark-L"
        data-order-id="${orderId}"
        data-amount="${amountInt}"
        data-currency="${currency}"
        data-api-key="${BOLD_API_KEY}"
        data-integrity-signature="${integrity}"
        data-redirection-url="${safeRedirect}"
        data-description="${desc}"
      ></script>
    </div>

    <a href="/" class="back">← Volver a la tienda</a>
    <p class="secure">🔒 Pago procesado por BOLD — 100% seguro</p>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(html);
}

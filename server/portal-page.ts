/**
 * LA PÁGINA DEL PORTAL — HTML armado en el servidor.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Se sirve desde el backend y no desde la tienda de cPanel por una razón muy
 * práctica: el frontend se sube a mano, y un link que la tienda ya mandó por
 * WhatsApp no puede quedar esperando a que alguien acuerde de subir una carpeta.
 * Esto se despliega con el backend y funciona en el mismo minuto. Es el mismo
 * camino que ya sigue la página de pago de Bold.
 *
 * Todo se pinta en el servidor. El JavaScript de abajo sólo sirve para las tres
 * acciones (pagar, subir la captura, pedir plazo); si falla, se carga, o el
 * cliente tiene una versión de Android de hace ocho años, igual VE su cuenta,
 * que es el 90 % del valor. Una página que se queda en blanco sin JavaScript
 * genera la misma llamada que no tener portal.
 *
 * Lo que el cliente ve está pensado para un teléfono y para alguien que no
 * quiere leer: una sola frase arriba que dice en qué situación está, la cifra, y
 * después los detalles para quien los busque.
 */
import type { ResumenPortal } from './portal';

/**
 * Escapa para HTML. Se aplica a TODO lo que venga de la base de datos.
 *
 * Los nombres y productos los teclea quien crea el registro en el panel, así que
 * son texto de confianza media: nadie va a atacar la tienda metiéndose un
 * `<script>` por nombre, pero un apellido con `&` o unas comillas en el modelo
 * del equipo rompen el documento igual de bien y sin mala intención.
 */
export function esc(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Mete un valor dentro de un `<script>` sin que pueda salirse de él.
 *
 * `JSON.stringify` escapa las comillas, pero NO escapa `</script>`: el
 * navegador cierra la etiqueta en cuanto lee esa secuencia, aunque vaya dentro
 * de una cadena de JavaScript, y todo lo que venga detrás se ejecuta como
 * marcado. Escapando `<` como `\u003c` la cadena sigue valiendo lo mismo para
 * JavaScript y deja de contener nada que el analizador de HTML reconozca.
 *
 * Hoy lo que entra aquí ya pasó por la validación del token, así que no puede
 * traer un `<`. Va igualmente: es una página pública y esa validación está a un
 * refactor de distancia de moverse de sitio.
 */
function aJs(valor: unknown): string {
  return JSON.stringify(String(valor ?? '')).replace(/</g, '\\u003c');
}

function pesos(valor: number): string {
  return `$${Math.round(Number(valor) || 0).toLocaleString('es-CO')}`;
}

function nombreBonito(nombre: string): string {
  return String(nombre || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)(\p{Ll})/gu, (_m, sep, letra) => sep + letra.toLocaleUpperCase('es-CO'));
}

const TELEFONO_TIENDA = '302 287 5280';
const WHATSAPP_TIENDA = '573022875280';

/**
 * El logo de Xiaomi, incrustado como SVG en vez de enlazado.
 *
 * Enlazarlo obligaría a servirlo desde algún sitio, y el sitio obvio —la tienda
 * de cPanel— es justo el que se sube a mano y el que ya nos dejó URLs de medios
 * apuntando a un host viejo. Un logo roto en la primera pantalla hace que el
 * cliente dude de si el link es de verdad suyo, que es lo contrario de lo que
 * busca esta página. Son 300 bytes: viajan con el HTML y no fallan nunca.
 */
const LOGO = `<svg class="logo" viewBox="0 0 1000 1000" role="img" aria-label="Xiaomi">
<path fill="#ff6700" d="M0 401.7v196.6c0 221.9 179.8 401.7 401.7 401.7h196.6c221.9 0 401.7-179.8 401.7-401.7V401.7C1000 179.8 820.2 0 598.3 0H401.7C179.8 0 0 179.8 0 401.7z"/>
<path fill="#fff" d="M473.1 366.1v401.6H335.7V440.8h-74.8v326.9H123.5V366.1h349.6zm132.8 0h137.4v401.6H605.9V366.1z"/>
</svg>`;

const ESTILOS = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#09090b;--card:#141418;--card2:#1b1b21;--line:#26262e;--line2:#33333d;
  --tx:#f5f5f7;--tx2:#9b9ba5;--tx3:#6b6b76;
  --mi:#ff6700;--mi2:#ff9143;
  --ok:#3ddc84;--warn:#ffb020;--bad:#ff5a65;
  --r:16px;
}
body{background:var(--bg);color:var(--tx);line-height:1.5;-webkit-font-smoothing:antialiased;
     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
     padding-bottom:calc(2.5rem + env(safe-area-inset-bottom))}
.wrap{max-width:560px;margin:0 auto;padding:0 1.05rem}

/* ── Barra superior ─────────────────────────────────────────────────────── */
.top{position:sticky;top:0;z-index:30;background:rgba(9,9,11,.82);border-bottom:1px solid var(--line);
     -webkit-backdrop-filter:saturate(180%) blur(16px);backdrop-filter:saturate(180%) blur(16px);
     padding-top:env(safe-area-inset-top)}
.top .in{max-width:560px;margin:0 auto;padding:.62rem 1.05rem;display:flex;align-items:center;gap:.6rem}
.logo{width:30px;height:30px;border-radius:9px;display:block;flex:none}
.marca{font-size:.95rem;font-weight:700;letter-spacing:-.02em;white-space:nowrap}
.marca i{font-style:normal;color:var(--tx2);font-weight:500}
.cuenta{margin-left:auto;font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;
        color:var(--tx3);white-space:nowrap}

/* ── Saludo y banner ────────────────────────────────────────────────────── */
.hola{font-size:.92rem;color:var(--tx2);margin-top:1.15rem}
.hola b{color:var(--tx);font-weight:600}
.banner{border-radius:var(--r);padding:1.05rem 1.15rem;margin-top:.7rem;border:1px solid;
        display:flex;gap:.75rem;align-items:flex-start}
.banner .ico{font-size:1.2rem;line-height:1.25;flex:none}
.banner .t{font-size:1.04rem;font-weight:700;letter-spacing:-.015em}
.banner .d{font-size:.87rem;margin-top:.25rem;opacity:.85}
.b-ok{background:#0d2318;border-color:#1f6b3d;color:#bdf2d1}
.b-aviso{background:#2a2110;border-color:#7a5a16;color:#ffe2a8}
.b-mal{background:#2a1215;border-color:#7a2230;color:#ffc5cb}
.b-info{background:#101c2a;border-color:#1c4b7a;color:#c3deff}

/* ── Tarjetas ───────────────────────────────────────────────────────────── */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:1.1rem;margin-top:.85rem}
.h{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--tx3);margin-bottom:.75rem}

/* Saldo grande: la cifra que el cliente busca al abrir */
.saldo .l{font-size:.78rem;color:var(--tx2)}
.saldo .v{font-size:2.1rem;font-weight:800;letter-spacing:-.045em;line-height:1.1;margin-top:.1rem}
.barra{height:8px;background:#26262e;border-radius:99px;overflow:hidden;margin-top:1rem}
.barra i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--mi),var(--mi2))}
.bajo{display:flex;justify-content:space-between;font-size:.78rem;color:var(--tx2);margin-top:.5rem}
.bajo b{color:var(--tx);font-weight:600}

.fila{display:flex;justify-content:space-between;gap:.7rem;font-size:.9rem;padding:.55rem 0;
      border-bottom:1px solid #1f1f26}
.fila:last-child{border-bottom:0}
.fila:first-of-type{padding-top:0}
.fila .k{color:var(--tx2)}
.fila .v{text-align:right;font-weight:600}
.fila .v.mal{color:#ff9fab}
.fila .v.suave{color:var(--tx3);font-weight:500}

/* ── Botones ────────────────────────────────────────────────────────────── */
button,.btn{display:block;width:100%;border:0;border-radius:12px;padding:.95rem 1rem;font-size:.95rem;
      font-weight:700;font-family:inherit;cursor:pointer;text-align:center;text-decoration:none;
      transition:filter .15s,opacity .15s,transform .08s}
button:active,.btn:active{filter:brightness(.9);transform:scale(.993)}
button[disabled]{opacity:.5;cursor:default;transform:none}
.p{background:linear-gradient(180deg,var(--mi),#f05d00);color:#fff;margin-top:.55rem;
   box-shadow:0 6px 18px -8px rgba(255,103,0,.75)}
.s{background:var(--card2);color:#e8e8ec;border:1px solid var(--line2);margin-top:.55rem}
.monto{font-weight:800;white-space:nowrap}

/* Medios de pago: decir cuáles son evita el abandono en la pasarela */
.medios{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.85rem}
.medio{font-size:.72rem;font-weight:600;color:var(--tx2);background:var(--card2);
       border:1px solid var(--line2);border-radius:99px;padding:.3rem .6rem}

/* ── Acordeones ─────────────────────────────────────────────────────────── */
details{background:var(--card);border:1px solid var(--line);border-radius:var(--r);margin-top:.6rem;overflow:hidden}
details>summary{cursor:pointer;font-size:.89rem;font-weight:600;color:#d8d8de;padding:.95rem 1.1rem;
                list-style:none;display:flex;align-items:center;gap:.6rem}
details>summary::-webkit-details-marker{display:none}
details>summary::after{content:'';margin-left:auto;width:7px;height:7px;flex:none;
  border-right:2px solid var(--tx3);border-bottom:2px solid var(--tx3);transform:rotate(45deg);
  transition:transform .18s}
details[open]>summary::after{transform:rotate(-135deg)}
details[open]>summary{border-bottom:1px solid var(--line)}
.cuerpo{padding:1.1rem}
.cuerpo>p:first-child{font-size:.86rem;color:var(--tx2)}

/* ── Tabla de cuotas ────────────────────────────────────────────────────── */
.tabla{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.83rem}
th{text-align:left;font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--tx3);
   padding:.5rem .35rem;border-bottom:1px solid var(--line);font-weight:700}
td{padding:.58rem .35rem;border-bottom:1px solid #1b1b21;vertical-align:top}
tr:last-child td{border-bottom:0}
.tag{display:inline-block;font-size:.66rem;font-weight:700;padding:.16rem .48rem;border-radius:6px;white-space:nowrap}
.t-pagada{background:#123021;color:#86e2ab}
.t-vencida{background:#33151a;color:#ff9fab}
.t-hoy{background:#3a2c10;color:#ffcf7a}
.t-plazo{background:#152a3d;color:#9bd0ff}
.t-pendiente{background:#232329;color:#a9a9b2}
.tach{text-decoration:line-through;color:var(--tx3);font-size:.73rem;display:block}

/* ── Formularios ────────────────────────────────────────────────────────── */
label{display:block;font-size:.79rem;color:var(--tx2);margin:.85rem 0 .35rem;font-weight:500}
input,textarea,select{width:100%;background:#0e0e11;border:1px solid var(--line2);border-radius:11px;
      color:var(--tx);padding:.75rem .85rem;font-size:.95rem;font-family:inherit}
input:focus,textarea:focus{outline:0;border-color:var(--mi)}
textarea{resize:vertical;min-height:72px}
input[type=file]{padding:.6rem}
.msg{font-size:.85rem;border-radius:11px;padding:.75rem .85rem;margin-top:.75rem;display:none}
.msg.ok{display:block;background:#0d2318;border:1px solid #1f6b3d;color:#bdf2d1}
.msg.err{display:block;background:#2a1215;border:1px solid #7a2230;color:#ffc5cb}
.nota{font-size:.77rem;color:var(--tx3);margin-top:.6rem;line-height:1.55}

/* ── Entrada por código corto ───────────────────────────────────────────── */
/* El código se MUESTRA de vuelta para que el cliente confirme que tecleó lo
   mismo que ve en la pantalla del equipo. Monoespaciado y espaciado porque se
   lee carácter por carácter, no como palabra. */
.codigo{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:1.5rem;font-weight:700;
        letter-spacing:.22em;text-align:center;color:var(--mi2);background:#0e0e11;
        border:1px solid var(--line2);border-radius:12px;padding:.7rem .4rem .7rem .62rem}
/* Cuatro dígitos, grandes: se teclean en un celular prestado y con prisa. */
input.pin{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:1.65rem;
      font-weight:700;letter-spacing:.42em;text-align:center;padding:.8rem .4rem .8rem .82rem}

/* ── Pie ────────────────────────────────────────────────────────────────── */
.pie{text-align:center;font-size:.8rem;color:var(--tx2);margin-top:2rem;line-height:1.75}
.pie .wa{display:inline-flex;align-items:center;gap:.4rem;margin-top:.5rem;padding:.6rem 1rem;
   background:var(--card);border:1px solid var(--line2);border-radius:99px;color:#ff9143;
   text-decoration:none;font-weight:700;font-size:.85rem}
.dir{font-size:.75rem;color:var(--tx3);margin-top:.7rem}
.vista{font-size:.74rem;color:#55555f;margin-top:1.5rem;padding-top:1.1rem;border-top:1px solid #18181d;
       line-height:1.6}
`;

/**
 * Lo que se le dice al cliente en la primera línea, que es la que de verdad lee.
 *
 * El icono va en su propia columna y no pegado al texto: con títulos de dos
 * renglones —que en un teléfono estrecho son casi todos— el emoji incrustado
 * deja la segunda línea desalineada y el bloque se lee como un párrafo suelto
 * en vez de como un aviso.
 */
function aviso(clase: string, icono: string, titulo: string, detalle: string): string {
  return `<div class="banner ${clase}">
    <div class="ico">${icono}</div>
    <div><div class="t">${titulo}</div><div class="d">${detalle}</div></div>
  </div>`;
}

function banner(r: ResumenPortal, avisoPago: AvisoPago | null): string {
  if (avisoPago === 'aprobado') {
    return aviso(
      'b-ok',
      '✅',
      'Pago confirmado',
      `Ya quedó registrado. ${
        r.equipo.bloqueado
          ? 'El desbloqueo del equipo puede tardar unos minutos en llegarle al teléfono.'
          : 'No tienes que hacer nada más.'
      }`
    );
  }
  if (avisoPago === 'pendiente') {
    return aviso(
      'b-info',
      '⏳',
      'Estamos confirmando tu pago',
      'Normalmente tarda menos de un minuto. Esta página se actualiza sola.'
    );
  }
  if (avisoPago === 'rechazado') {
    return aviso(
      'b-mal',
      '⚠️',
      'No se pudo cobrar',
      'El pago no fue aprobado y no se te descontó nada. Puedes intentarlo otra vez o con otro medio.'
    );
  }

  if (r.liquidado) {
    return aviso(
      'b-ok',
      '🎉',
      'Terminaste de pagar',
      `Pagaste las ${r.totalCuotas} cuotas. El equipo queda libre y sin restricciones.`
    );
  }

  if (r.equipo.bloqueado) {
    const quePagar = r.vencidas > 1 ? `tus ${r.vencidas} cuotas vencidas` : `tu cuota #${r.proxima?.numero ?? ''}`;
    return aviso(
      'b-mal',
      '🔒',
      'Tu equipo está bloqueado',
      `Se desbloquea al registrarse el pago de ${quePagar}. Si pagas aquí abajo se suelta solo, sin que tengas que llamar.`
    );
  }

  if (r.plazo) {
    return aviso(
      'b-info',
      '⏳',
      `Tienes plazo hasta el ${esc(r.plazo.hastaLargo)}`,
      `Tu cuota #${r.proxima?.numero ?? ''} sigue pendiente. Si no se paga ese día, el equipo se bloquea a las ${esc(
        r.horaBloqueo
      )}.`
    );
  }

  if (r.vencidas > 0) {
    const cual =
      r.vencidas > 1
        ? `Tienes ${r.vencidas} cuotas vencidas por ${pesos(r.vencidas * r.valorCuota)}`
        : `Tu cuota #${r.proxima?.numero ?? ''} venció${r.diasDeMora === 1 ? ' ayer' : ` hace ${r.diasDeMora} días`}`;
    return aviso(
      'b-mal',
      '⚠️',
      esc(cual),
      `El equipo puede bloquearse a las ${esc(r.horaBloqueo)}. Si ya pagaste, súbenos la captura aquí abajo.`
    );
  }

  if (r.proxima?.estado === 'vence-hoy') {
    return aviso(
      'b-aviso',
      '📅',
      `Hoy vence tu cuota #${r.proxima.numero}`,
      `Son ${pesos(r.valorCuota)}. Si no se paga antes de las ${esc(
        r.horaBloqueo
      )} de mañana, el equipo se bloquea.`
    );
  }

  if (r.proxima) {
    return aviso(
      'b-ok',
      '✅',
      'Estás al día',
      `Tu próxima cuota, la #${r.proxima.numero}, vence el ${esc(r.proxima.venceLargo)}.`
    );
  }

  return aviso(
    'b-info',
    'ℹ️',
    'Tu cuenta',
    'No hay cuotas registradas todavía. Si crees que es un error, escríbenos.'
  );
}

const ETIQUETAS: Record<string, { clase: string; texto: string }> = {
  pagada: { clase: 't-pagada', texto: 'Pagada' },
  vencida: { clase: 't-vencida', texto: 'Vencida' },
  'vence-hoy': { clase: 't-hoy', texto: 'Vence hoy' },
  'con-plazo': { clase: 't-plazo', texto: 'Con plazo' },
  pendiente: { clase: 't-pendiente', texto: 'Pendiente' },
};

function tablaCuotas(r: ResumenPortal): string {
  if (!r.cuotas.length) return '';
  const filas = r.cuotas
    .map((c) => {
      const e = ETIQUETAS[c.estado] || ETIQUETAS.pendiente;
      const pactada = c.vencePactada ? `<span class="tach">${esc(c.vencePactada)}</span>` : '';
      return `<tr>
        <td>#${c.numero}</td>
        <td>${esc(c.vence)}${pactada}</td>
        <td><span class="tag ${e.clase}">${e.texto}</span>${
          c.enLinea ? '<span class="tach" style="text-decoration:none">en línea</span>' : ''
        }</td>
        <td style="text-align:right">${pesos(c.valor)}</td>
      </tr>`;
    })
    .join('');
  return `<details><summary>Ver mis ${r.cuotas.length} cuotas una por una</summary>
    <div class="cuerpo"><div class="tabla">
    <table><thead><tr><th>Cuota</th><th>Vence</th><th>Estado</th><th style="text-align:right">Valor</th></tr></thead>
    <tbody>${filas}</tbody></table></div>
    ${
      r.cuotas.some((c) => c.vencePactada)
        ? '<p class="nota">La fecha tachada es la que estaba pactada; la de arriba es el plazo que se te dio.</p>'
        : ''
    }</div></details>`;
}

function botonesPago(r: ResumenPortal, pagoActivo: boolean): string {
  if (!r.proxima) return '';
  if (!pagoActivo) {
    return `<div class="card"><div class="h">Pagar</div>
      <p style="font-size:.88rem;color:#a9a9b2">El pago en línea todavía no está habilitado. Para pagar tu cuota de
      <span class="monto">${pesos(r.valorCuota)}</span>, escríbenos por WhatsApp al ${TELEFONO_TIENDA}.</p>
      <a class="btn p" href="https://wa.me/${WHATSAPP_TIENDA}?text=${encodeURIComponent(
        `Hola, quiero pagar mi cuota #${r.proxima.numero}`
      )}">Escribir por WhatsApp</a></div>`;
  }
  const botones = r.opcionesPago
    .map(
      (o, i) =>
        `<button class="${i === 0 ? 'p' : 's'}" data-pagar="${esc(o.alcance)}">${esc(
          o.etiqueta
        )} · <span class="monto">${pesos(o.monto)}</span></button>`
    )
    .join('');
  // Nombrar los medios antes de salir a la pasarela, y no después, evita el
  // abandono de quien no sabe si su banco estará. Esta lista es la misma que
  // METODOS_CUOTA en bold-link.ts: si allí cambia, aquí cambia.
  const medios = ['PSE', 'Nequi', 'Botón Bancolombia']
    .map((m) => `<span class="medio">${m}</span>`)
    .join('');
  return `<div class="card"><div class="h">Pagar en línea</div>
    ${botones}
    <div class="medios">${medios}</div>
    <p class="nota">El pago queda registrado al instante${
      r.equipo.bloqueado ? ' y el equipo se desbloquea solo' : ''
    }; no tienes que mandar comprobante.</p>
    <div id="msg-pago" class="msg"></div></div>`;
}

function subirComprobante(r: ResumenPortal): string {
  if (!r.proxima) return '';
  return `<details><summary>Ya pagué por transferencia y quiero mandar el comprobante</summary>
    <div class="cuerpo">
      <p>Sube la captura del pago de tu cuota #${r.proxima.numero}.
      La revisamos y te la registramos; no hace falta que nos escribas aparte.</p>
      <label for="cmp">Captura del pago</label>
      <input type="file" id="cmp" accept="image/*">
      <button class="s" id="btn-cmp">Enviar comprobante</button>
      <div id="msg-cmp" class="msg"></div>
    </div></details>`;
}

function pedirPlazo(r: ResumenPortal): string {
  if (r.solicitudPendiente) {
    return `<div class="card"><div class="h">Tu solicitud de plazo</div>
      <p style="font-size:.88rem;color:var(--tx2)">Pediste plazo hasta el <strong style="color:var(--tx)">${esc(
        r.solicitudPendiente.hastaLargo
      )}</strong>. Está pendiente de que la tienda la apruebe; te avisamos por WhatsApp en cuanto se resuelva.</p>
      <p class="nota">Mientras no se apruebe, la fecha que vale sigue siendo la de tu cuota.</p></div>`;
  }
  if (!r.puedePedirPlazo) return '';
  const max = new Date(Date.parse(`${r.hoy}T00:00:00Z`) + r.maxDiasPlazo * 86400000)
    .toISOString()
    .slice(0, 10);
  const minimo = r.proxima && r.proxima.vence > r.hoy ? r.proxima.vence : r.hoy;
  return `<details><summary>No puedo pagar ahora, quiero pedir unos días</summary>
    <div class="cuerpo">
      <p>Dinos hasta qué día podrías pagar. La tienda lo revisa; si lo aprueba,
      el equipo no se bloquea hasta esa fecha y te llega la confirmación por WhatsApp.</p>
      <label for="hasta">¿Hasta qué día?</label>
      <input type="date" id="hasta" min="${esc(minimo)}" max="${esc(max)}">
      <label for="motivo">¿Por qué? (nos ayuda a aprobarlo)</label>
      <textarea id="motivo" maxlength="300" placeholder="Me pagan el viernes..."></textarea>
      <button class="s" id="btn-plazo">Pedir el plazo</button>
      <div id="msg-plazo" class="msg"></div>
    </div></details>`;
}

const GUION = `
<script>
(function(){
  var API = window.__API__, T = window.__TOKEN__;
  function msg(id, texto, ok){
    var e = document.getElementById(id);
    if(!e) return;
    e.className = 'msg ' + (ok ? 'ok' : 'err');
    e.textContent = texto;
  }
  function pedir(ruta, cuerpo){
    return fetch(API + '/api/portal/' + T + ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {})
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(d){
        if(!res.ok) throw new Error(d && d.error ? d.error : 'No se pudo completar la operación.');
        return d;
      });
    });
  }

  // --- Pagar ---------------------------------------------------------------
  Array.prototype.forEach.call(document.querySelectorAll('[data-pagar]'), function(b){
    b.addEventListener('click', function(){
      var todos = document.querySelectorAll('[data-pagar]');
      Array.prototype.forEach.call(todos, function(x){ x.disabled = true; });
      b.textContent = 'Abriendo el pago...';
      pedir('/pagar', { alcance: b.getAttribute('data-pagar') })
        .then(function(d){ window.location.href = d.url; })
        .catch(function(e){
          msg('msg-pago', e.message, false);
          Array.prototype.forEach.call(todos, function(x){ x.disabled = false; });
          window.location.reload();
        });
    });
  });

  // --- Comprobante ---------------------------------------------------------
  /* Las capturas salen de la cámara del teléfono y pesan 2-4 MB; el servidor
     acepta 700 KB. Sin reducirla aquí, la mayoría de los envíos fracasarían y el
     cliente volvería a WhatsApp, que es justo lo que esto viene a evitar. */
  function reducir(file){
    return new Promise(function(resolve, reject){
      var fr = new FileReader();
      fr.onerror = function(){ reject(new Error('No se pudo leer la imagen.')); };
      fr.onload = function(){
        var img = new Image();
        img.onerror = function(){ reject(new Error('El archivo no parece ser una imagen.')); };
        img.onload = function(){
          var MAX = 1400;
          var esc2 = Math.min(1, MAX / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * esc2);
          c.height = Math.round(img.height * esc2);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var calidades = [0.75, 0.6, 0.45, 0.3];
          for (var i = 0; i < calidades.length; i++){
            var d = c.toDataURL('image/jpeg', calidades[i]);
            if (d.length * 0.75 < 660 * 1024) return resolve(d);
          }
          resolve(c.toDataURL('image/jpeg', 0.25));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  var btnC = document.getElementById('btn-cmp');
  if (btnC) btnC.addEventListener('click', function(){
    var f = document.getElementById('cmp').files[0];
    if (!f) return msg('msg-cmp', 'Primero elige la captura del pago.', false);
    btnC.disabled = true; btnC.textContent = 'Enviando...';
    reducir(f)
      .then(function(img){ return pedir('/comprobante', { image: img, filename: f.name }); })
      .then(function(){
        msg('msg-cmp', 'Listo, ya nos llegó. Lo revisamos y te registramos la cuota.', true);
        btnC.textContent = 'Enviado';
      })
      .catch(function(e){
        msg('msg-cmp', e.message, false);
        btnC.disabled = false; btnC.textContent = 'Enviar comprobante';
      });
  });

  // --- Pedir plazo ---------------------------------------------------------
  var btnP = document.getElementById('btn-plazo');
  if (btnP) btnP.addEventListener('click', function(){
    var hasta = document.getElementById('hasta').value;
    if (!hasta) return msg('msg-plazo', 'Elige hasta qué día podrías pagar.', false);
    btnP.disabled = true; btnP.textContent = 'Enviando...';
    pedir('/plazo', { hasta: hasta, motivo: document.getElementById('motivo').value })
      .then(function(d){
        msg('msg-plazo', d.mensaje || 'Tu solicitud quedó registrada.', true);
        setTimeout(function(){ window.location.reload(); }, 1800);
      })
      .catch(function(e){
        msg('msg-plazo', e.message, false);
        btnP.disabled = false; btnP.textContent = 'Pedir el plazo';
      });
  });

  /* Vuelta de Bold: el webhook puede tardar unos segundos en llegar, así que la
     página se recarga sola unas cuantas veces y luego para. Sin el tope, una
     pestaña olvidada en un teléfono estaría recargando el backend para siempre. */
  if (window.__ESPERANDO__) {
    var n = Number(sessionStorage.getItem('cl-esperas') || 0);
    if (n < 10) {
      sessionStorage.setItem('cl-esperas', n + 1);
      setTimeout(function(){ window.location.reload(); }, 4000);
    }
  } else {
    sessionStorage.removeItem('cl-esperas');
  }
})();
</script>`;

export type AvisoPago = 'aprobado' | 'pendiente' | 'rechazado';

export interface OpcionesPagina {
  resumen: ResumenPortal;
  token: string;
  /** Origen absoluto del backend, para que el fetch funcione igual tras un proxy. */
  api: string;
  avisoPago: AvisoPago | null;
  /** Si la pasarela está configurada. Sin esto se ofrece WhatsApp y no un botón muerto. */
  pagoActivo: boolean;
}

export function paginaPortal(o: OpcionesPagina): string {
  const r = o.resumen;
  const pagadasPct = r.totalCuotas > 0 ? Math.round((r.pagadas / r.totalCuotas) * 100) : 0;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0d0d0f">
<title>Mi cuenta — CREDILOCK</title>
<style>${ESTILOS}</style>
</head>
<body>
<div class="top"><div class="in">
  ${LOGO}
  <div class="marca">CREDILOCK</div>
  <div class="cuenta">Mi cuenta</div>
</div></div>

<div class="wrap">
  <div class="hola">Hola, <b>${esc(nombreBonito(r.nombre))}</b></div>

  ${banner(r, o.avisoPago)}

  <div class="card">
    <div class="h">Tu crédito</div>
    <div class="saldo">
      <div class="l">${r.liquidado ? 'Pagado por completo' : 'Te falta por pagar'}</div>
      <div class="v">${pesos(r.saldo)}</div>
    </div>
    <div class="barra"><i style="width:${pagadasPct}%"></i></div>
    <div class="bajo">
      <span><b>${r.pagadas}</b> de ${r.totalCuotas} cuotas pagadas</span>
      <span>${pagadasPct}%</span>
    </div>
  </div>

  ${
    r.proxima
      ? `<div class="card">
    <div class="h">Tu próxima cuota</div>
    <div class="fila"><span class="k">Cuota</span><span class="v">#${r.proxima.numero}</span></div>
    <div class="fila"><span class="k">Valor</span><span class="v">${pesos(r.valorCuota)}</span></div>
    <div class="fila"><span class="k">${r.plazo ? 'Plazo hasta' : 'Vence'}</span><span class="v">${esc(
          r.proxima.venceLargo
        )}</span></div>
    ${
      r.proxima.vencePactada
        ? `<div class="fila"><span class="k">Fecha pactada</span><span class="v suave">${esc(
            r.proxima.vencePactada
          )}</span></div>`
        : ''
    }
    ${
      r.equipo.bloqueado
        ? '<div class="fila"><span class="k">Equipo</span><span class="v mal">Bloqueado</span></div>'
        : ''
    }
  </div>`
      : ''
  }

  ${botonesPago(r, o.pagoActivo)}
  ${subirComprobante(r)}
  ${pedirPlazo(r)}
  ${tablaCuotas(r)}

  <div class="card">
    <div class="h">Tu equipo</div>
    <div class="fila"><span class="k">Modelo</span><span class="v">${esc(r.producto || '—')}</span></div>
    <div class="fila"><span class="k">IMEI</span><span class="v">${esc(r.imei)}</span></div>
  </div>

  <div class="pie">
    ¿Algo no cuadra? Escríbenos.<br>
    <a class="wa" href="https://wa.me/${WHATSAPP_TIENDA}">WhatsApp ${TELEFONO_TIENDA}</a>
    <div class="dir">Cl. 31 #61-64, Los Ángeles — Cartagena</div>
    <div class="vista">Esta página es sólo tuya. No la compartas: cualquiera con el link vería tu cuenta.</div>
  </div>
</div>
<script>
window.__TOKEN__ = ${aJs(o.token)};
window.__API__ = ${aJs(o.api)};
window.__ESPERANDO__ = ${o.avisoPago === 'pendiente' ? 'true' : 'false'};
</script>
${GUION}
</body>
</html>`;
}

/**
 * Página de error. No distingue "no existe" de "firma mala" a propósito: decir
 * "el financiamiento existe pero tu firma no vale" le confirma a quien está
 * probando ids que acertó con uno.
 */
export function paginaErrorPortal(titulo: string, detalle: string, codigo = 404): { html: string; codigo: number } {
  return {
    codigo,
    html: `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Mi cuenta — CREDILOCK</title><style>${ESTILOS}</style></head>
<body>
<div class="top"><div class="in">
  ${LOGO}
  <div class="marca">CREDILOCK</div>
  <div class="cuenta">Mi cuenta</div>
</div></div>
<div class="wrap">
  <div class="banner b-aviso" style="margin-top:1.5rem">
    <div class="ico">🔗</div>
    <div><div class="t">${esc(titulo)}</div><div class="d">${esc(detalle)}</div></div>
  </div>
  <!-- El pie no explica qué hacer: eso ya lo dice el detalle, que cambia según el
       caso. Un texto fijo aquí ("te mandamos un link nuevo") mentiría en los 500 y
       503, donde el link está bien y lo roto somos nosotros. Sólo la salida. -->
  <div class="pie">
    <a class="wa" href="https://wa.me/${WHATSAPP_TIENDA}">WhatsApp ${TELEFONO_TIENDA}</a>
  </div>
</div></body></html>`,
  };
}

/**
 * Puerta de entrada por código corto: la que se abre desde la pantalla de un
 * equipo bloqueado.
 *
 * Por qué existe: en el bloqueo sólo podemos escribir texto plano, y el link
 * normal del portal mide ~95 caracteres terminados en una firma de 24. Pedirle a
 * alguien que copie eso a otro teléfono es pedirle que no pague. El código corto
 * cabe en la pantalla y se puede teclear; los cuatro dígitos de la cédula son los
 * que de verdad abren.
 *
 * Tres decisiones que no son estéticas:
 *
 * 1. **Sin JavaScript.** Un `<form>` que hace POST. Quien llega aquí está en un
 *    teléfono prestado, con la conexión que haya, y a veces en el navegador
 *    cautivo de WhatsApp. Un formulario HTML es lo único que funciona en todos.
 *
 * 2. **No dice nada de la cuenta.** Ni el nombre, ni el saldo, ni si el código
 *    existe. Esta página se ve idéntica para un código real y para uno inventado,
 *    porque si distinguiera los dos casos, probar códigos se volvería gratis.
 *
 * 3. **El teléfono de la tienda va siempre**, incluso cuando el freno de
 *    intentos cerró la puerta. Es la razón por la que podemos permitirnos cerrar
 *    el código a los cinco fallos: el camino humano nunca se cierra, y el cliente
 *    que de verdad olvidó su cédula no se queda sin forma de reactivar el equipo.
 */
export function paginaCodigoCorto(o: {
  codigo: string;
  /** Texto a mostrar en rojo. Genérico a propósito: ver punto 2. */
  error?: string;
  /** Minutos que faltan para volver a intentar. >0 esconde el formulario. */
  esperaMinutos?: number;
}): string {
  const esperando = Number(o.esperaMinutos) > 0;
  const minutos = Math.max(1, Math.ceil(Number(o.esperaMinutos) || 0));

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Mi cuenta — CREDILOCK</title><style>${ESTILOS}</style></head>
<body>
<div class="top"><div class="in">
  ${LOGO}
  <div class="marca">CREDILOCK</div>
  <div class="cuenta">Mi cuenta</div>
</div></div>
<div class="wrap">
${
  esperando
    ? `  <div class="banner b-mal" style="margin-top:1.5rem">
    <div class="ico">⏳</div>
    <div>
      <div class="t">Demasiados intentos</div>
      <div class="d">Por seguridad bloqueamos este código por ${minutos} minuto${minutos === 1 ? '' : 's'}.
        Si no recuerdas los dígitos, escríbenos y te atendemos de una.</div>
    </div>
  </div>`
    : `  <div class="banner b-info" style="margin-top:1.5rem">
    <div class="ico">🔒</div>
    <div>
      <div class="t">Confirma que eres tú</div>
      <div class="d">Para ver tu cuenta y pagar, escribe los <b>4 últimos dígitos de tu cédula</b>.</div>
    </div>
  </div>

  <form class="card" method="POST" action="/p/${esc(o.codigo)}">
    <div class="h">Tu código</div>
    <div class="codigo">${esc(o.codigo)}</div>

    <label for="cedula">Últimos 4 dígitos de tu cédula</label>
    <!-- inputmode=numeric saca el teclado de números sin que el campo sea
         type=number: en Android, type=number deja pegar signos y notación
         científica, y recorta los ceros de la izquierda. pattern + maxlength
         validan en el navegador, pero el servidor no se fía de ninguno. -->
    <input class="pin" id="cedula" name="cedula" inputmode="numeric" pattern="[0-9]{4}"
           maxlength="4" autocomplete="off" required autofocus placeholder="••••">
    ${o.error ? `<div class="msg err">${esc(o.error)}</div>` : ''}

    <button class="p" type="submit">Ver mi cuenta</button>

    <div class="nota">
      Son los 4 últimos dígitos de la cédula del titular del financiamiento, sin
      puntos. Al entrar verás tu saldo, tus cuotas y podrás pagar en línea.
    </div>
  </form>`
}

  <div class="pie">
    Comunícate al ${TELEFONO_TIENDA} para reactivarlo.<br>
    <a class="wa" href="https://wa.me/${WHATSAPP_TIENDA}">WhatsApp ${TELEFONO_TIENDA}</a>
    <div class="dir">Cl. 31 #61-64, Los Ángeles — Cartagena</div>
  </div>
</div></body></html>`;
}

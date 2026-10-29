import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Switch } from '../../ui/switch';
import { Label } from '../../ui/label';
import { Input } from '../../ui/input';
import { useDeviceStore } from '../../../lib/blocking/store';
import { MongoDBStatus } from '../../../components/MongoDBStatus';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  DollarSign,
  HelpCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from 'lucide-react';

const pesos = (valor: number) =>
  '$' + Math.round(valor).toLocaleString('es-CO');

/**
 * Las cifras las calcula el servidor, no esta pantalla.
 *
 * Antes el Dashboard derivaba `stats` contando el array de `devices` que tenía
 * en memoria. Eso daba números que no coincidían con la realidad en cuanto el
 * panel tuviera la lista a medio cargar, y peor: contaba como "activo" a
 * cualquier equipo cuyo `status` no fuera 'blocked', incluidos los de Nuovo que
 * esta API no alcanza y los que llevan semanas apagados. Un contador de
 * "109 activos" cuando 24 son ingobernables y 7 están incomunicados le dice al
 * dueño que tiene control sobre equipos que no puede tocar.
 */
export function Dashboard() {
  const history = useDeviceStore((s) => s.history);
  const stats = useDeviceStore((s) => s.stats);
  const config = useDeviceStore((s) => s.config);
  const decisiones = useDeviceStore((s) => s.decisiones);
  const isLoading = useDeviceStore((s) => s.isLoading);
  const error = useDeviceStore((s) => s.error);
  const loadFromApi = useDeviceStore((s) => s.loadFromApi);
  const cargarPrevisualizacion = useDeviceStore((s) => s.cargarPrevisualizacion);
  const guardarConfig = useDeviceStore((s) => s.guardarConfig);
  const sincronizarCartera = useDeviceStore((s) => s.sincronizarCartera);
  const reconciliarTodo = useDeviceStore((s) => s.reconciliarTodo);

  const [diasDeGracia, setDiasDeGracia] = useState('');
  const [maxPorVuelta, setMaxPorVuelta] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [guiaAbierta, setGuiaAbierta] = useState(
    () => localStorage.getItem('credilock.guia') !== 'cerrada'
  );

  const alternarGuia = () => {
    setGuiaAbierta((abierta) => {
      localStorage.setItem('credilock.guia', abierta ? 'cerrada' : 'abierta');
      return !abierta;
    });
  };

  useEffect(() => {
    loadFromApi();
    cargarPrevisualizacion();
  }, []);

  useEffect(() => {
    if (!config) return;
    setDiasDeGracia(String(config.diasDeGracia));
    setMaxPorVuelta(String(config.maxBloqueosPorVuelta));
  }, [config]);

  const cambiarConfig = async (cambios: Parameters<typeof guardarConfig>[0]) => {
    const ok = await guardarConfig(cambios);
    toast[ok ? 'success' : 'error'](
      ok ? 'Configuración guardada.' : 'No se pudo guardar la configuración.'
    );
  };

  const correr = async (fn: () => Promise<{ ok: boolean; mensaje: string }>) => {
    setTrabajando(true);
    const r = await fn();
    toast[r.ok ? 'success' : 'error'](r.mensaje, { duration: 8000 });
    await cargarPrevisualizacion();
    setTrabajando(false);
  };

  const aBloquear = decisiones.filter((d) => d.accion === 'bloquear');
  const aDesbloquear = decisiones.filter((d) => d.accion === 'desbloquear');
  const aLiberar = decisiones.filter((d) => d.accion === 'liberar');

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-medium text-gray-900 sm:text-2xl">Dashboard</h2>
          <p className="mt-1 text-gray-600">Bloqueo remoto de equipos financiados</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={trabajando || isLoading}
            onClick={() => correr(sincronizarCartera)}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Sincronizar cartera
          </Button>
          <Button
            variant="outline"
            disabled={trabajando || isLoading}
            onClick={() => correr(reconciliarTodo)}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Verificar estado real
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <MongoDBStatus />

      <Card className="border-blue-200 bg-blue-50/60">
        <button
          type="button"
          onClick={alternarGuia}
          className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
        >
          <span className="flex items-center gap-2 font-medium text-blue-900">
            <HelpCircle className="h-5 w-5 shrink-0 text-blue-600" />
            Cómo funciona este módulo
          </span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-blue-600 transition-transform ${
              guiaAbierta ? 'rotate-180' : ''
            }`}
          />
        </button>

        {guiaAbierta && (
          <CardContent className="space-y-5 border-t border-blue-200 pt-5 text-sm text-blue-900">
            <ol className="space-y-4">
              <Paso numero={1} titulo="Sincronizar cartera">
                Lee las financiaciones y crea o actualiza la ficha de cada equipo con
                sus cuotas, su saldo y su mora. Es lo primero que hay que hacer: sin
                esto el automatismo no sabe quién debe.
              </Paso>
              <Paso numero={2} titulo="Verificar estado real">
                Le pregunta al proveedor, equipo por equipo, en qué estado está de
                verdad. Va lento a propósito: el proveedor rechaza el lote completo si
                un solo IMEI no es nuestro, así que hay que consultar de uno en uno.
                Mientras corre es normal ver equipos «sin resolver». Se repite solo
                cada 2 minutos.
              </Paso>
              <Paso numero={3} titulo="El automatismo decide">
                Cada 30 minutos revisa la cartera: avisa en la pantalla del equipo el
                día antes, y bloquea cuando se pasaron los días de gracia, respetando
                la hora acordada con cada cliente. Con la simulación encendida no
                bloquea nada, sólo deja constancia en la bitácora de lo que habría
                hecho.
              </Paso>
              <Paso numero={4} titulo="Al pagar, se desbloquea solo">
                No hay que entrar aquí a desbloquear. Al registrar el pago en
                Financiaciones el equipo se libera por su cuenta.
              </Paso>
            </ol>

            <div className="rounded-lg border border-blue-200 bg-white/70 p-4">
              <p className="font-medium">Dos cosas que conviene saber</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  Este panel no decide si un equipo está bloqueado: lo confirma el
                  proveedor. Una orden enviada a un teléfono apagado se queda en
                  «orden sin confirmar» hasta que el equipo se prenda.
                </li>
                <li>
                  Los equipos en Nuovo no se alcanzan desde esta API. Aparecen en el
                  listado para no perderlos de vista, pero hay que manejarlos en su
                  propio portal.
                </li>
              </ul>
            </div>

            <div className="rounded-lg border border-blue-200 bg-white/70 p-4">
              <p className="font-medium">Qué hacer ahora</p>
              <p className="mt-2">
                Déjalo una semana en simulación. Revisa cada día «Qué haría el
                automatismo ahora mismo» y la bitácora; si lo que propone coincide con
                lo que habrías hecho a mano, apaga la simulación y enciende el bloqueo
                automático.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <Tarjeta
          titulo="Equipos en el panel"
          valor={stats?.total ?? 0}
          pie={`${stats?.enrolled ?? 0} operables desde aquí`}
          icono={<Smartphone className="h-5 w-5 text-white" />}
          color="bg-[#ff6700]"
        />
        <Tarjeta
          titulo="Activos (confirmado)"
          valor={stats?.active ?? 0}
          pie="Según el proveedor, no según lo que pedimos"
          icono={<ShieldCheck className="h-5 w-5 text-white" />}
          color="bg-green-600"
          tono="text-green-600"
        />
        <Tarjeta
          titulo="Bloqueados (confirmado)"
          valor={stats?.blocked ?? 0}
          pie={`${stats?.divergentes ?? 0} con orden sin confirmar`}
          icono={<ShieldAlert className="h-5 w-5 text-white" />}
          color="bg-red-600"
          tono="text-red-600"
        />
        <Tarjeta
          titulo="Sin reportar"
          valor={stats?.incomunicados ?? 0}
          pie="Más de 48 h apagados: un bloqueo no les llega"
          icono={<WifiOff className="h-5 w-5 text-white" />}
          color="bg-amber-600"
          tono="text-amber-600"
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <Tarjeta
          titulo="En Nuovo"
          valor={stats?.enNuovo ?? 0}
          pie="Esta API no los alcanza: gestión manual"
          icono={<AlertTriangle className="h-5 w-5 text-white" />}
          color="bg-slate-600"
        />
        <Tarjeta
          titulo="En mora"
          valor={stats?.enMora ?? 0}
          pie="Con al menos una cuota vencida"
          icono={<AlertTriangle className="h-5 w-5 text-white" />}
          color="bg-orange-600"
          tono="text-orange-600"
        />
        <Tarjeta
          titulo="Liquidados"
          valor={stats?.liquidados ?? 0}
          pie="Pagaron todo: no deberían estar bloqueados"
          icono={<ShieldCheck className="h-5 w-5 text-white" />}
          color="bg-emerald-600"
          tono="text-emerald-600"
        />
        <Tarjeta
          titulo="Saldo por cobrar"
          valor={pesos(stats?.saldoTotal ?? 0)}
          pie={`${stats?.sinResolver ?? 0} equipos sin verificar`}
          icono={<DollarSign className="h-5 w-5 text-white" />}
          color="bg-[#ff6700]"
          tono="text-[#ff6700]"
        />
      </div>

      <Card className="border border-gray-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-medium text-gray-900">
            Automatismo de bloqueo por mora
          </CardTitle>
          <p className="text-sm text-gray-600">
            Con la simulación encendida, el sistema decide y lo anota en la bitácora, pero no
            toca ningún equipo. Es la forma de auditar la política antes de dejarla suelta.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Bloqueo automático</Label>
              <p className="text-xs text-gray-500">
                Si está apagado, nadie se bloquea solo: todo pasa por un clic manual.
              </p>
            </div>
            <Switch
              checked={Boolean(config?.autoBloqueoActivo)}
              onCheckedChange={(v) => cambiarConfig({ autoBloqueoActivo: v })}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Modo simulación</Label>
              <p className="text-xs text-gray-500">
                Apágalo sólo cuando las decisiones de abajo sean exactamente las que esperas.
              </p>
            </div>
            <Switch
              checked={Boolean(config?.simulacion)}
              onCheckedChange={(v) => cambiarConfig({ simulacion: v })}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Aviso en pantalla el día antes</Label>
              <p className="text-xs text-gray-500">
                Notificación con el monto y la fecha, sin bloquear.
              </p>
            </div>
            <Switch
              checked={Boolean(config?.avisoEnPantallaActivo)}
              onCheckedChange={(v) => cambiarConfig({ avisoEnPantallaActivo: v })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Días de gracia</Label>
              <Input
                type="number"
                min={0}
                value={diasDeGracia}
                onChange={(e) => setDiasDeGracia(e.target.value)}
                onBlur={() => {
                  const n = Number(diasDeGracia);
                  if (Number.isFinite(n) && n >= 0 && n !== config?.diasDeGracia) {
                    cambiarConfig({ diasDeGracia: n });
                  }
                }}
              />
              <p className="text-xs text-gray-500">
                Días después del vencimiento antes de bloquear.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">Máximo de bloqueos por vuelta</Label>
              <Input
                type="number"
                min={1}
                value={maxPorVuelta}
                onChange={(e) => setMaxPorVuelta(e.target.value)}
                onBlur={() => {
                  const n = Number(maxPorVuelta);
                  if (Number.isFinite(n) && n >= 1 && n !== config?.maxBloqueosPorVuelta) {
                    cambiarConfig({ maxBloqueosPorVuelta: n });
                  }
                }}
              />
              <p className="text-xs text-gray-500">
                Tope por ejecución: un error de configuración no deja a 80 clientes sin
                teléfono de golpe.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-gray-200 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-medium text-gray-900">
              Qué haría el automatismo ahora mismo
            </CardTitle>
            <p className="text-sm text-gray-600">
              Sin ejecutar nada. {aBloquear.length} a bloquear, {aDesbloquear.length} a
              desbloquear, {aLiberar.length} a liberar.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => cargarPrevisualizacion()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {decisiones.filter((d) => d.accion !== 'nada').length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              Ninguna acción pendiente con la configuración actual.
            </p>
          ) : (
            <div className="divide-y">
              {decisiones
                .filter((d) => d.accion !== 'nada')
                .map((d) => (
                  <div
                    key={d.imei + d.accion}
                    className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{d.owner}</p>
                      <p className="text-xs text-gray-500">{d.motivo}</p>
                    </div>
                    <Badge
                      className={
                        d.accion === 'bloquear'
                          ? 'bg-red-100 text-red-800'
                          : d.accion === 'desbloquear'
                          ? 'bg-green-100 text-green-800'
                          : d.accion === 'liberar'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-blue-100 text-blue-800'
                      }
                    >
                      {d.accion}
                    </Badge>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-gray-200 bg-white shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-[#ff6700] p-2">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <CardTitle className="text-lg font-medium text-gray-900">Bitácora</CardTitle>
          </div>
          <p className="text-sm text-gray-600">
            La escribe el servidor cuando una acción ocurre de verdad. El panel no puede
            añadir entradas, para que sirva como prueba si un cliente reclama.
          </p>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-8 text-center text-gray-500">No hay actividad registrada</p>
          ) : (
            <div className="space-y-4">
              {history.slice(0, 15).map((entry, i) => (
                <div
                  key={entry.id ?? `${entry.timestamp}-${i}`}
                  className="flex items-start gap-4 border-b pb-4 last:border-0 last:pb-0"
                >
                  <div className={`rounded-lg p-2 ${colorAccion(entry.action)}`}>
                    {esDesbloqueo(entry.action) ? (
                      <ShieldCheck className="h-5 w-5" />
                    ) : esBloqueo(entry.action) ? (
                      <ShieldAlert className="h-5 w-5" />
                    ) : (
                      <Smartphone className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">{etiquetaAccion(entry.action)}</p>
                    <p className="mt-1 text-sm text-gray-600">{entry.deviceInfo}</p>
                    {entry.reason && (
                      <p className="mt-1 text-xs text-gray-500">Motivo: {entry.reason}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-500">Por {entry.user}</span>
                      <span className="text-xs text-gray-400">•</span>
                      <span className="text-xs text-gray-500">
                        {new Date(entry.timestamp).toLocaleString('es-CO', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Paso({
  numero,
  titulo,
  children,
}: {
  numero: number;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-medium text-white">
        {numero}
      </span>
      <div>
        <p className="font-medium">{titulo}</p>
        <p className="mt-0.5 text-blue-800">{children}</p>
      </div>
    </li>
  );
}

function Tarjeta({
  titulo,
  valor,
  pie,
  icono,
  color,
  tono = 'text-gray-900',
}: {
  titulo: string;
  valor: number | string;
  pie: string;
  icono: ReactNode;
  color: string;
  tono?: string;
}) {
  return (
    <Card className="border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-normal text-gray-600">{titulo}</CardTitle>
        <div className={`rounded-md p-2 ${color}`}>{icono}</div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-normal sm:text-3xl ${tono}`}>{valor}</div>
        <p className="mt-1 text-xs text-gray-500">{pie}</p>
      </CardContent>
    </Card>
  );
}

/**
 * `action` llega como string libre porque el servidor también emite
 * `simulado:bloquear` y variantes nuevas. Se traduce lo conocido y se muestra
 * el resto tal cual, en vez de caer en un "Dispositivo Agregado" por defecto
 * que etiquetaba mal cualquier acción no prevista.
 */
const ETIQUETAS: Record<string, string> = {
  block: 'Bloqueo solicitado',
  unblock: 'Desbloqueo solicitado',
  notify: 'Aviso en pantalla',
  lock_message: 'Mensaje de bloqueo actualizado',
  pin_unlock: 'Desbloqueo por PIN',
  harden: 'Protecciones antievasión aplicadas',
  release: 'Equipo liberado del financiamiento',
  set_auto: 'Automatismo por equipo cambiado',
  add: 'Equipo registrado',
  delete: 'Equipo quitado del panel',
  sync: 'Cartera sincronizada',
  reconcile: 'Estado verificado con el proveedor',
  'simulado:bloquear': 'Simulación: bloquearía',
  'simulado:desbloquear': 'Simulación: desbloquearía',
  'simulado:liberar': 'Simulación: liberaría',
  'simulado:avisar_pantalla': 'Simulación: avisaría en pantalla',
};

function etiquetaAccion(action: string) {
  return ETIQUETAS[action] ?? action;
}

// 'desbloquear' contiene 'bloquear', así que el desbloqueo se comprueba primero
// o un desbloqueo saldría pintado de rojo con icono de candado.
function esDesbloqueo(action: string) {
  return action.includes('desbloquear') || action === 'unblock' || action === 'pin_unlock';
}

function esBloqueo(action: string) {
  return action.includes('bloquear') || action === 'block';
}

function colorAccion(action: string) {
  if (action.startsWith('simulado:')) return 'bg-gray-100 text-gray-600';
  if (esDesbloqueo(action)) return 'bg-green-100 text-green-600';
  if (esBloqueo(action)) return 'bg-red-100 text-red-600';
  return 'bg-blue-100 text-blue-600';
}

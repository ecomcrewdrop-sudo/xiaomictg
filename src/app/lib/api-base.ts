const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Backend en Railway (Mongo accesible; cPanel bloquea puerto 27017). */
const RAILWAY_API_ORIGIN = 'https://xiaomictg-backend-production-66f6.up.railway.app';

export const API_ORIGIN = LOCAL_HOSTS.has(window.location.hostname)
  ? ''
  : RAILWAY_API_ORIGIN;

export const API_BASE_URL = API_ORIGIN ? `${API_ORIGIN}/api` : '/api';

export const RUTA_LOGIN_ADMIN = '/login-admin';

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem('adminToken');
  } catch {
    // Safari en modo privado puede lanzar al tocar localStorage.
    return null;
  }
}

export function cerrarSesionAdmin(): void {
  try {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
  } catch {
    /* ignorar */
  }
}

/**
 * Pone la cabecera Authorization en todas las llamadas a nuestra API y cierra
 * la sesión cuando el backend responde 401.
 *
 * Se hace parcheando window.fetch en lugar de ir fichero a fichero porque hay
 * más de cincuenta `fetch` repartidos por el panel (muchos sin pasar por
 * fetchWithTimeout): tocarlos uno a uno garantiza olvidarse alguno, y una
 * llamada sin token ahora es un 401 y un módulo del panel que deja de cargar.
 *
 * Sólo se añade la cabecera si hay token guardado. Así el visitante normal de
 * la tienda no manda Authorization y sus peticiones al catálogo siguen siendo
 * "simple requests", sin preflight OPTIONS extra contra Railway.
 */
function instalarInterceptorAuth(): void {
  const w = window as any;
  if (w.__authFetchInstalado) return;
  w.__authFetchInstalado = true;

  const fetchOriginal = window.fetch.bind(window);

  const esNuestraApi = (url: string): boolean => {
    try {
      const absoluta = new URL(url, window.location.origin);
      const base = new URL(API_BASE_URL, window.location.origin);
      return absoluta.origin === base.origin && absoluta.pathname.startsWith('/api/');
    } catch {
      return false;
    }
  };

  const urlDe = (input: RequestInfo | URL): string => {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlDe(input);

    if (!esNuestraApi(url)) return fetchOriginal(input as any, init);

    const token = getAdminToken();
    let peticion: RequestInfo | URL = input;
    let opciones = init;

    if (token) {
      // Las cabeceras pueden venir como Headers, array o objeto plano; Headers
      // normaliza los tres casos. Si quien llama ya puso un Authorization
      // propio, se respeta.
      const cabeceras = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined)
      );
      if (!cabeceras.has('Authorization')) {
        cabeceras.set('Authorization', `Bearer ${token}`);
      }

      if (input instanceof Request && !init) {
        peticion = new Request(input, { headers: cabeceras });
      } else {
        opciones = { ...init, headers: cabeceras };
      }
    }

    const respuesta = await fetchOriginal(peticion as any, opciones);

    // El 401 del propio login es "credenciales incorrectas": lo gestiona la
    // pantalla de login, aquí redirigir sería un bucle.
    const esLogin = url.includes('/api/login');

    // Sólo se redirige si HABÍA una sesión, o sea si de verdad ha caducado.
    // Sin token, un 401 significa que algún componente de la tienda ha llamado
    // a una ruta de administración; mandar al cliente al login del panel en
    // mitad de una compra sería muchísimo peor que el propio fallo.
    if (respuesta.status === 401 && !esLogin && token) {
      cerrarSesionAdmin();
      if (window.location.pathname !== RUTA_LOGIN_ADMIN) {
        window.location.href = RUTA_LOGIN_ADMIN;
      }
    }

    return respuesta;
  };
}

instalarInterceptorAuth();

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

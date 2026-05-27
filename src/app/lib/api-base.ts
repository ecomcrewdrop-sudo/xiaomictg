const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Backend en Railway (Mongo accesible; cPanel bloquea puerto 27017). */
const RAILWAY_API_ORIGIN = 'https://xiaomictg-production.up.railway.app';

export const API_ORIGIN = LOCAL_HOSTS.has(window.location.hostname)
  ? ''
  : RAILWAY_API_ORIGIN;

export const API_BASE_URL = API_ORIGIN ? `${API_ORIGIN}/api` : '/api';

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

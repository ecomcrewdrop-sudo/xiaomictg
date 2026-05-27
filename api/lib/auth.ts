import { createHmac, randomBytes } from 'crypto';

const SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'xiaomi-secret-key-fallback';
const TOKEN_EXPIRY_HOURS = 12;

/**
 * Genera un token firmado con HMAC-SHA256.
 * Formato: base64(payload).base64(signature)
 */
export function generateToken(username: string, role: string): string {
  const payload = {
    sub: username,
    role,
    iat: Date.now(),
    exp: Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
    jti: randomBytes(8).toString('hex'),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payloadB64).digest('base64url');

  return `${payloadB64}.${sig}`;
}

/**
 * Verifica y decodifica un token.
 * Retorna el payload si es válido, null si no.
 */
export function verifyToken(token: string): { sub: string; role: string } | null {
  if (!token) return null;

  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;

    // Verificar firma
    const expectedSig = createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
    if (sig !== expectedSig) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    // Verificar expiración
    if (Date.now() > payload.exp) return null;

    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

/**
 * Middleware: extrae y verifica el token del header Authorization.
 * Header esperado: "Bearer <token>"
 * También acepta el token legacy 'admin-token-*' para compatibilidad con sesiones existentes.
 */
export function requireAuth(authHeader: string | undefined): boolean {
  if (!authHeader) return false;

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  // Compatibilidad temporal: tokens viejos (localStorage existente) — se aceptan hasta que expiren
  if (token.startsWith('admin-token-')) {
    const ts = parseInt(token.replace('admin-token-', ''));
    // Sesiones legacy expiran a las 24h
    if (!isNaN(ts) && Date.now() - ts < 24 * 60 * 60 * 1000) return true;
    return false;
  }

  return verifyToken(token) !== null;
}

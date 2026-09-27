// Guarda de acesso da API (auditoria de segurança 27/09/2026).
//
// O console é de UM usuário, nesta máquina: a API escuta só no loopback e exige
// um token aleatório gerado a cada início. O token vai para um arquivo fora do
// git; o proxy do Vite o lê e injeta o cabeçalho — o navegador nunca o vê. Um
// site malicioso aberto no mesmo navegador não tem o token (e sem CORS não lê
// resposta); outro computador nem alcança a porta.
//
// Este módulo é o PONTO ÚNICO que um deploy multiusuário troca por autenticação
// real (identidade vinda de proxy com SSO + autorização por projeto).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TOKEN_HEADER = 'x-studio-token';
export const TOKEN_FILE = process.env.STUDIO_TOKEN_FILE || path.join(__dirname, '.runtime', 'token');

/** Gera (ou lê de STUDIO_TOKEN) o token da sessão e o grava em TOKEN_FILE. */
export function initToken() {
  const token = process.env.STUDIO_TOKEN || crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

/** Lê o token gravado (usado pelo proxy do Vite e por agentes locais). */
export function readToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Nome do host do cabeçalho Host, sem a porta. */
export function hostName(hostHeader) {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

/**
 * Host permitido: loopback, mais o que API_ALLOWED_HOSTS listar (vírgulas).
 * Barra DNS rebinding — um domínio externo que resolve para 127.0.0.1 chega
 * com o Host desse domínio.
 */
export function hostGuard(allowed = process.env.API_ALLOWED_HOSTS) {
  const extra = String(allowed || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const ok = new Set([...LOOPBACK, ...extra]);
  return (req, res, next) => {
    if (ok.has(hostName(req.headers.host))) return next();
    res.status(403).json({ error: 'Host não permitido' });
  };
}

/** Exige o token em toda a API, exceto /api/health. */
export function requireToken(token) {
  if (!token) throw new Error('requireToken: token vazio');
  return (req, res, next) => {
    if (req.path === '/health') return next();
    const got = req.get(TOKEN_HEADER);
    if (got && sameToken(got, token)) return next();
    res.status(401).json({ error: 'Não autorizado' });
  };
}

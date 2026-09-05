const base = '/api';

// Wrapper ÚNICO de chamadas à API. Nenhuma falha explode em SyntaxError de JSON:
//  - rede fora           -> { error: 'Servidor indisponível…' }
//  - HTTP 4xx/5xx        -> { error } (usa o error do corpo se houver; senão status + trecho)
//  - corpo não-JSON      -> tolerado (vira {} em 2xx)
// Os chamadores já tratam `r.error`, então a convenção é uniforme em toda a UI.
async function request(url: string, init?: RequestInit): Promise<any> {
  let r: Response;
  try {
    r = await fetch(base + url, init);
  } catch {
    return { error: 'Servidor indisponível — a console está rodando? (npm run dev)' };
  }
  const text = await r.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null; // HTML de erro, texto solto…
    }
  }
  if (!r.ok) {
    // Corpo HTML (página de erro) não serve como mensagem — usa só o status.
    const snippet = text && !text.trim().startsWith('<') ? text.slice(0, 200) : r.statusText || 'falha na requisição';
    return { error: data?.error || `Erro ${r.status}: ${snippet}` };
  }
  return data ?? {};
}

const json = (method: string, body: any): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const jget = (url: string) => request(url);
export const jpost = (url: string, body: any) => request(url, json('POST', body));
export const jput = (url: string, body: any) => request(url, json('PUT', body));
export const jdel = (url: string) => request(url, { method: 'DELETE' });

/** Upload multipart (Connectors). */
export function upload(url: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return request(url, { method: 'POST', body: fd });
}

// Executa SQL no schema do projeto (fontes são escopadas por projeto no server).
export async function runQuery(sql: string, project?: string): Promise<{ columns?: string[]; rows?: any[]; error?: string }> {
  return jpost('/query', { sql, project });
}

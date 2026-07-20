// basePath は next.config.js の env でビルド時に埋め込まれる。
// basePath 未設定時は ''、設定時は '/harness' としてビルドされる。
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

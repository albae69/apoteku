export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

const TOKEN_KEY = "apoteku.token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown };

/** Kirim permintaan dan kembalikan isi JSON apa adanya (pembungkus tidak dibuka). */
async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const json = (await res.json().catch(() => null)) as
    | { data?: unknown; error?: string; details?: unknown }
    | null;

  if (!res.ok) {
    if (res.status === 401) tokenStore.clear();
    throw new ApiError(res.status, json?.error ?? "Terjadi kesalahan", json?.details);
  }
  return json as T;
}

/**
 * Panggil REST API untuk satu objek: pembungkus `{ data: ... }` dibuka otomatis
 * (mis. `/settings`, `/shifts/current`, `/dashboard/summary`).
 * `{ data: null }` dikembalikan sebagai `null`, bukan sebagai objek pembungkus.
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const json = await request<Record<string, unknown> | null>(path, options);
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

/**
 * Panggil REST API untuk daftar: isi respons `{ data, meta }` dikembalikan apa
 * adanya, supaya pemanggil dapat memakai `data` sekaligus `meta` (jumlah/paginasi).
 */
export async function apiList<T>(path: string, options: ApiOptions = {}): Promise<T> {
  return request<T>(path, options);
}

export type PaginatedResponse<T> = {
  data: T[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
};

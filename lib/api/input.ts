export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export class InputError extends Error {}
export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new InputError(message);
}
export function https(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}


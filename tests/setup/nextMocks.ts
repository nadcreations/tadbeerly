import { vi } from "vitest";

/** In-memory cookie jar standing in for Next's request cookies. */
const jar = new Map<string, string>();
let headerInit: Record<string, string> = {};

export function setCookie(name: string, value: string): void {
  jar.set(name, value);
}
export function getCookie(name: string): string | undefined {
  return jar.get(name);
}
export function clearCookies(): void {
  jar.clear();
}
export function setHeaders(init: Record<string, string>): void {
  headerInit = init;
}

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(headerInit),
}));

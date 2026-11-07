import { setTransportForTests } from "@/lib/email/transport";

/**
 * Installs the silent default: sends succeed and print nothing. Tests that
 * install their own transport call this in afterEach, so later tests in the
 * same file stay quiet instead of falling back to the console transport.
 */
export function useSilentTransport(): void {
  setTransportForTests({ name: "silent", send: async () => {} });
}

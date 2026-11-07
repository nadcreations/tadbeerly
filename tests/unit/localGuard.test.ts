import { describe, expect, test } from "vitest";
import { assertLocalDatabase } from "@/db/localGuard";

describe("assertLocalDatabase", () => {
  test.each([
    "postgresql://u:p@localhost:5435/db",
    "postgresql://u:p@127.0.0.1:5435/db",
  ])("accepts %s", (url) => {
    expect(() => assertLocalDatabase(url)).not.toThrow();
  });

  test.each([
    ["look-alike host", "postgresql://u:p@localhost.evil.com:5432/db"],
    ["IPv6 loopback", "postgresql://u:p@[::1]:5432/db"],
    ["socket-style", "postgresql:///db?host=/var/run/postgresql"],
    ["multi-host", "postgresql://u:p@localhost:5435,evil.com:5432/db"],
    ["multi-host without ports", "postgresql://u:p@localhost,evil.com/db"],
    ["host override in the query", "postgresql://u:p@localhost/db?host=evil.com"],
    ["remote", "postgresql://u:p@db.example.com:5432/db"],
    ["unparseable", "not a url"],
    ["missing", ""],
  ])("refuses %s", (_name, url) => {
    expect(() => assertLocalDatabase(url)).toThrow(/Refusing/);
  });
});

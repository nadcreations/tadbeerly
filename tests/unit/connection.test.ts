import { describe, expect, test } from "vitest";
import { connectionOptions } from "@/db/connection";

const local = "postgresql://u:p@127.0.0.1:5435/tadbeerly";
const supabaseTx = "postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
const supabaseSession = "postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

describe("connectionOptions", () => {
  test("a local database needs neither SSL nor special statement handling", () => {
    expect(connectionOptions(local, {})).toEqual({ prepare: true, ssl: false });
    expect(connectionOptions("postgresql://u:p@localhost/db", {})).toEqual({ prepare: true, ssl: false });
  });

  test("Supabase's transaction pooler (port 6543) cannot use prepared statements", () => {
    expect(connectionOptions(supabaseTx, {})).toEqual({ prepare: false, ssl: "require" });
  });

  test("the session pooler keeps prepared statements but requires SSL", () => {
    expect(connectionOptions(supabaseSession, {})).toEqual({ prepare: true, ssl: "require" });
  });

  test("an explicit sslmode in the URL is left to the driver", () => {
    const opts = connectionOptions(`${supabaseSession}?sslmode=verify-full`, {});
    expect(opts.ssl).toBeUndefined();
  });

  test("DB_PREPARE=false turns prepared statements off anywhere", () => {
    expect(connectionOptions(supabaseSession, { DB_PREPARE: "false" }).prepare).toBe(false);
  });
});

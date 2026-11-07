import { loadEnv, requireEnv } from "@/lib/env";

loadEnv();
process.env.DATABASE_URL = requireEnv("TEST_DATABASE_URL");

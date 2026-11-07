import { loadEnv } from "@/lib/env";

loadEnv();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

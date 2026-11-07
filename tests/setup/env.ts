import { loadEnv, requireEnv } from "@/lib/env";

loadEnv();
process.env.DATABASE_URL = requireEnv("TEST_DATABASE_URL");

/*
 * Tests that trigger dispatch must not print email bodies. A silent transport
 * is the default here; the production default stays "console", and tests that
 * need to observe sends install their own with setTransportForTests.
 */
import { useSilentTransport } from "./transport";

useSilentTransport();

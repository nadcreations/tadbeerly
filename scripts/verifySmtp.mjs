import nodemailer from "nodemailer";
import fs from "node:fs";

// Read .env.local directly so this checks exactly what the app will use.
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const port = Number(env.SMTP_PORT ?? 587);
console.log(`host=${env.SMTP_HOST} port=${port} secure=${env.SMTP_SECURE} user=${env.SMTP_USER}`);

const t = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port,
  secure: env.SMTP_SECURE === "true" || port === 465,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 20000,
  logger: false,
});

try {
  await t.verify();
  console.log("\nRESULT: SMTP AUTH SUCCEEDED — the mailbox will accept mail from this app.");
} catch (e) {
  console.log("\nRESULT: FAILED");
  console.log("code:      ", e.code ?? "(none)");
  console.log("response:  ", (e.response ?? "").toString().slice(0, 400));
  console.log("message:   ", e.message?.slice(0, 400));
  process.exit(1);
}
process.exit(0);

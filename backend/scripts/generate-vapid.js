import webpush from "web-push";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");

if (fs.existsSync(envPath) && fs.readFileSync(envPath, "utf8").includes("VAPID_PUBLIC_KEY=")) {
  console.log(".env already has VAPID keys — not overwriting. Delete them from .env if you want to regenerate.");
  process.exit(0);
}

const keys = webpush.generateVAPIDKeys();

const lines = [
  `VAPID_PUBLIC_KEY=${keys.publicKey}`,
  `VAPID_PRIVATE_KEY=${keys.privateKey}`,
  `VAPID_SUBJECT=mailto:scgoldhaber@gmail.com`,
  `PORT=4000`,
  `DB_PATH=./data/calendar.db`,
  `CORS_ORIGIN=*`,
];

fs.mkdirSync(path.dirname(envPath), { recursive: true });
fs.appendFileSync(envPath, lines.join("\n") + "\n");
console.log("Generated VAPID keys and wrote them to .env");
console.log("Public key:", keys.publicKey);

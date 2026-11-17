import { writeFile } from "node:fs/promises";

const LEGACY_BASE = process.env.LEGACY_WORKER_URL || "https://coey-subscribers-worker.coey.dev";
const LEGACY_USER = process.env.LEGACY_USER || "admin";
const LEGACY_PASSWORD = process.env.LEGACY_PASSWORD || "";
const OPTKIT_BASE = process.env.OPTKIT_URL || "https://optkit.com";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!LEGACY_PASSWORD || !OWNER_PASSWORD) {
  console.error("LEGACY_PASSWORD and OWNER_PASSWORD are required");
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${LEGACY_USER}:${LEGACY_PASSWORD}`).toString("base64")}`;
const dumpResponse = await fetch(`${LEGACY_BASE}/dump-legacy`, { headers: { authorization: auth } });
if (!dumpResponse.ok) {
  console.error(`dump failed: ${dumpResponse.status}`);
  process.exit(1);
}
const raw = await dumpResponse.json();

const addresses = new Set();
const collect = (value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (EMAIL_RE.test(normalized)) addresses.add(normalized);
    return;
  }
  if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === "object") Object.values(value).forEach(collect);
};
collect(raw);

const dumpPath = process.env.LEGACY_DUMP_PATH || "receipts/legacy-dump.json";
await writeFile(dumpPath, JSON.stringify(raw), "utf8");
console.log(`dumped ${addresses.size} unique addresses to ${dumpPath}`);

let cookie = "";
const login = await fetch(`${OPTKIT_BASE}/dashboard/login`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ password: OWNER_PASSWORD }).toString(),
  redirect: "manual",
});
const setCookie = login.headers.get("set-cookie");
if (!setCookie) {
  console.error("optkit login failed");
  process.exit(1);
}
cookie = setCookie.split(";")[0];

const importResponse = await fetch(`${OPTKIT_BASE}/api/import-legacy`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie },
  body: JSON.stringify({ addresses: [...addresses] }),
});
if (!importResponse.ok) {
  console.error(`import failed: ${importResponse.status}`);
  process.exit(1);
}
const proof = await importResponse.json();
console.log(JSON.stringify(proof));
if (proof.unique !== addresses.size) {
  console.error("count mismatch");
  process.exit(1);
}

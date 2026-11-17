import { readFile } from "node:fs/promises";

const profile = JSON.parse(await readFile("./alchemy-home-link/profiles/personal/cloudflare.json", "utf8"));
const account = profile.values.accountId;
const access = profile.values.access;
const workerName = "optkit-worker";
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${workerName}`;

const headers = { authorization: `Bearer ${access}` };
const settings = await (await fetch(`${base}/settings`, { headers })).json();
const current = settings.result?.bindings || [];
if (current.some((binding) => binding.type === "send_email" && binding.name === "SEND_EMAIL")) {
  console.log("send_email binding already present");
  process.exit(0);
}

const scriptResponse = await fetch(base, { headers });
if (!scriptResponse.ok) {
  console.error("script fetch failed", scriptResponse.status);
  process.exit(1);
}
const raw = Buffer.from(await scriptResponse.arrayBuffer());
const contentType = scriptResponse.headers.get("content-type") || "";
const boundary = contentType.match(/boundary=(.+)$/)?.[1];
if (!contentType.startsWith("multipart/form-data") || !boundary) {
  console.error("unexpected script payload");
  process.exit(1);
}
const nonSecret = current.filter((binding) => binding.type !== "secret_text");
const metadata = {
  main_module: "index.js",
  compatibility_date: "2026-03-01",
  compatibility_flags: [],
  bindings: [...nonSecret, { type: "send_email", name: "SEND_EMAIL" }],
  observability: { enabled: true },
  logpush: false,
  tags: [],
};
const nextBoundary = `----optkitPatch${Date.now()}`;
const chunks = [];
const push = (text) => chunks.push(Buffer.from(text));
const segment = Buffer.from(`\r\n--${boundary}`);
const parts = raw.split ? [] : [];
const buffers = raw.toString ? [] : [];
const rawBuffers = [];
let start = 0;
for (;;) {
  const index = raw.indexOf(segment, start);
  if (index === -1) {
    rawBuffers.push(raw.subarray(start));
    break;
  }
  rawBuffers.push(raw.subarray(start, index + 2));
  start = index + segment.length;
}
for (const piece of rawBuffers) {
  const text = piece.toString("latin1");
  if (!text.trim()) continue;
  if (text.startsWith("--") || text === "--\r\n") continue;
  const headerEnd = text.indexOf("\r\n\r\n");
  if (headerEnd === -1) continue;
  const header = text.slice(0, headerEnd);
  const nameMatch = header.match(/name="([^"]+)"/);
  const name = nameMatch?.[1] || "script";
  if (name === "metadata" || name === "index.js.map" || !name.endsWith(".js")) continue;
  push(`--${nextBoundary}\r\n${header}\r\n\r\n`);
  chunks.push(piece.subarray(headerEnd + 4).subarray(0, piece.length - (headerEnd + 4) - (text.endsWith("\r\n") ? 2 : 0)));
  push("\r\n");
}
push(`--${nextBoundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${nextBoundary}--\r\n`);
const payload = Buffer.concat(chunks);
const put = await fetch(base, {
  method: "PUT",
  headers: { authorization: `Bearer ${access}`, "Content-Type": `multipart/form-data; boundary=${nextBoundary}` },
  body: payload,
});
console.log("put status", put.status);
console.log((await put.text()).slice(0, 400));
if (!put.ok) process.exit(1);

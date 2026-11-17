import { Hono } from "hono";
import { Effect } from "effect";
import type { Env } from "./env";
import {
  ensureAccount,
  ensureList,
  subscribe,
  confirmSubscription,
  unsubscribe,
  getSubscriberById,
  getSubscriber,
  listSubscribers,
  deleteSubscriber,
  createCampaign,
  getCampaign,
  updateCampaign,
  listCampaigns,
  createApiKey,
  verifyApiKey,
  createApiKeyConfirmation,
  consumeApiKeyConfirmation,
  checkRateLimit,
  logEvent,
  newId,
  nowIso,
  type CampaignRow,
} from "./store";
import { verifyToken, makeUnsubscribeToken } from "./crypto";
import { sendMail } from "./mail";
import { fanOutCampaign } from "./queue";
import {
  clearSessionCookie,
  checkOwnerPassword,
  makeSession,
  readSession,
  sessionCookie,
  verifyTurnstile,
} from "./auth";

const ACCOUNT_ID = "account-1";
const LIST_ID = "list-1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Powered-By", "optkit");
});

function base(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

async function authed(c: { env: Env; req: { header: (name: string) => string | undefined | null } }): Promise<boolean> {
  return readSession(c.env.SESSION_SECRET, c.req.header("cookie") ?? null);
}

async function apiKeyAuth(c: { env: Env; req: { header: (name: string) => string | undefined | null } }) {
  const header = c.req.header("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!key) return null;
  return verifyApiKey(c.env.DB, key);
}

function forbidden() {
  return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain" } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sendTransactional(
  env: Env,
  to: string,
  subject: string,
  html: string,
  text: string,
  unsubscribeUrl: string,
): Promise<void> {
  await sendMail(
    env.SEND_EMAIL,
    {
      from: env.SENDER_EMAIL,
      fromName: env.FROM_NAME,
      to,
      subject,
      html,
      text,
      unsubscribeUrl,
      messageId: `${newId()}@optkit.com`,
      date: new Date(),
    },
    { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.EMAIL_API_TOKEN },
  );
}

function shell(c: { env: Env }, title: string, kicker: string, body: string, rail?: string): string {
  const siteKey = c.env.TURNSTILE_SITEKEY || "";
  const nav = `<a href="/" class="logo">optkit</a><nav><a href="/docs?page=tutorial">Docs</a><a href="/docs?page=explain">How it works</a><a href="/docs?page=pricing">Pricing</a><a href="/docs?page=reference">API</a><a href="https://github.com/acoyfellow/optkit">GitHub</a><a href="/dashboard" class="get">Sign in</a></nav>`;
  const railHtml = rail
    ? `<aside>${rail}</aside><article><p class="kicker">${kicker}</p>${body}</article>`
    : `<article class="wide"><p class="kicker">${kicker}</p>${body}</article>`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — optkit</title>
<meta name="description" content="optkit is small, reliable email for your list, on Cloudflare.">
${siteKey ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ""}
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;color:#172019;background:#fff;margin:0}
header.top{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #eee}
header.top .logo{font-family:ui-monospace,Menlo,monospace;font-weight:900;color:#172019;text-decoration:none}
header.top nav{display:flex;gap:14px;align-items:center}
header.top nav a{color:#17201955;text-decoration:none;font-size:13px;font-family:ui-monospace,Menlo,monospace}
header.top nav a:hover{color:#172019}
header.top nav a.get{background:#172019;color:#f1efe7;padding:6px 12px;border-radius:999px}
main{display:grid;grid-template-columns:220px minmax(0,640px);gap:48px;max-width:960px;margin:0 auto;padding:28px 20px}
main article.wide{grid-column:1 / -1}
aside{display:flex;flex-direction:column;gap:2px;padding-top:8px}
aside a{color:#17201988;text-decoration:none;font-size:13px;padding:6px 8px;border-radius:6px;font-family:ui-monospace,Menlo,monospace}
aside a:hover{background:#f1efe755;color:#172019}
aside a.on{background:#172019;color:#f1efe7}
.kicker{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#ff5a36;margin:0}
h1{font-size:40px;letter-spacing:-0.03em;line-height:1.05;margin:10px 0}
h2{font-size:20px;letter-spacing:-0.02em;margin:28px 0 8px}
p.lede{font-size:16px;color:#172019aa;line-height:1.5}
pre{background:#f7f7f5;border:1px solid #eee;border-radius:8px;padding:12px;overflow:auto;font-size:12px}
code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
table{border-collapse:collapse;font-size:13px}
th,td{border-bottom:1px solid #eee;padding:6px 10px;text-align:left}
.form{display:flex;max-width:26rem;border:2px solid #172019;margin-top:16px}
.form input{flex:1;min-width:0;padding:10px 12px;border:0;font:inherit;outline:none}
.form button{border:0;border-left:2px solid #172019;background:#172019;color:#f1efe7;padding:0 14px;cursor:pointer}
.note{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#17201988}
footer{border-top:1px solid #eee;padding:14px 20px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#17201966;display:flex;gap:16px}
footer a{color:inherit}
</style>
</head>
<body>
<header class="top">${nav}</header>
<main>${railHtml}</main>
<footer><span>optkit</span><a href="https://github.com/acoyfellow/optkit">GitHub</a><a href="/docs">Docs</a></footer>
<script>
const form = document.getElementById("optkit-form");
if (form) {
  const msg = document.getElementById("optkit-msg");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("email").value;
    const cfTurnstileResponse = document.querySelector("[name=cf-turnstile-response]")?.value ?? null;
    try {
      const res = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, turnstile: cfTurnstileResponse }) });
      if (res.ok) { msg.textContent = "Check your inbox to confirm."; form.reset(); return; }
      if (res.status === 409) { msg.textContent = "You are already subscribed."; return; }
      msg.textContent = (await res.text()) || "Subscribe failed.";
    } catch { msg.textContent = "Could not reach the server. Try again."; }
  });
}
</script>
</body></html>`;
}

app.get("/", (c) => {
  const siteKey = c.env.TURNSTILE_SITEKEY || "";
  const html = shell(c, "optkit", "Docs", `<h1>Small, reliable email for your list.</h1><p class="lede">Your list lives in D1. Campaigns go through queues. Every email carries a real one-click unsubscribe.</p><p class="lede">Pricing stance: bring your account, pay Cloudflare direct. No per-seat markup.</p><form id="optkit-form" class="form"><label class="sr-only" for="email">Email</label><input id="email" type="email" required placeholder="you@domain.com">${siteKey ? `<div class="cf-turnstile" data-sitekey="${siteKey}"></div>` : ""}<button type="submit">Subscribe</button></form><p id="optkit-msg" class="note"></p><p class="note">One email per post. Leave any time. <a href="/docs?page=tutorial">Read the tutorial</a></p>`);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});

app.get("/docs", (c) => {
  const page = c.req.query("page") || "tutorial";
  const rail = `<a href="/docs?page=tutorial" class="${page === "tutorial" ? "on" : ""}">Learn Tutorial</a><a href="/docs?page=team" class="${page === "team" ? "on" : ""}">Join Your team</a><a href="/docs?page=howto" class="${page === "howto" ? "on" : ""}">Do How-to</a><a href="/docs?page=reference" class="${page === "reference" ? "on" : ""}">Look up Reference</a><a href="/docs?page=explain" class="${page === "explain" ? "on" : ""}">Understand Explanation</a><a href="/docs?page=pricing" class="${page === "pricing" ? "on" : ""}">Pricing</a>`;
  const pages: Record<string, { kicker: string; body: string }> = {
    tutorial: {
      kicker: "Learn",
      body: `<h1>Run your first list</h1><p class="lede">About two minutes. Subscribe, confirm, send one campaign.</p><h2>1. Subscribe</h2><pre>POST /api/subscribe\n{ "email": "you@domain.com" }</pre><p>A confirm email arrives within seconds. Confirm links expire in 24 hours.</p><h2>2. Confirm</h2><p>Click the confirm link. You are confirmed and safe to receive campaigns.</p><h2>3. Send</h2><pre>POST /api/admin/campaigns\n{ "subject": "Hello", "html": "<p>Hi {{email}}</p>" }</pre><p>Send enqueues one message per confirmed subscriber. Retries land on the DLQ after three attempts.</p>`,
    },
    team: {
      kicker: "Join",
      body: `<h1>Bring your own account</h1><p class="lede">optkit runs on your Cloudflare account. Your D1, queues, and email sending are yours.</p><h2>Use</h2><p>Sign in as owner, create a list, import CSV, compose a campaign, send it.</p>`,
    },
    howto: {
      kicker: "Do",
      body: `<h1>Embed the form on any page</h1><p class="lede">One script tag. The form posts to the public API.</p><pre>&lt;script src="https://optkit.com/embed.js"&gt;&lt;/script&gt;\n&lt;div data-optkit data-optkit-account="account-1" data-optkit-list="list-1"&gt;\n</pre>`,
    },
    reference: {
      kicker: "Look up",
      body: `<h1>API and tools</h1><p class="lede">Every route needs an owner session or an API key, and only ever shows your own lists.</p><h2>API</h2><pre>POST /api/subscribe    subscribe (double opt-in)\nGET  /api/confirm      confirm via signed link\nPOST /api/unsubscribe  one-click unsubscribe\nGET  /api/v1/lists/:id  list subscribers (key)\nPOST /api/v1/campaigns draft (key)\nPOST /api/v1/campaigns/:id/send send (owner confirm)</pre><h2>MCP</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td>list_lists</td><td>Your lists and totals.</td></tr><tr><td>list_subscribers</td><td>Confirmed subscribers.</td></tr><tr><td>draft_campaign</td><td>Draft without sending.</td></tr><tr><td>preview_campaign</td><td>Preview with substitutions.</td></tr><tr><td>send_test</td><td>Send a test email.</td></tr><tr><td>send_campaign</td><td>Needs an owner confirmation token.</td></tr><tr><td>campaign_status</td><td>Send counts.</td></tr></table><h2>Limits</h2><p class="lede">5 subscribes per IP or email per minute. Unconfirmed addresses never receive campaigns.</p>`,
    },
    explain: {
      kicker: "Understand",
      body: `<h1>How it works</h1><p class="lede">D1 is the source of truth. Queues fan out. Email Sending delivers.</p><h2>Idempotent sends</h2><p>Every (campaign, subscriber) pair is claimed once. A retry cannot double-send.</p><h2>One-click unsubscribe</h2><p>List-Unsubscribe and List-Unsubscribe-Post headers plus a signed link in the body (RFC 8058).</p>`,
    },
    pricing: {
      kicker: "Pricing",
      body: `<h1>Bring your account</h1><p class="lede">optkit has no per-seat markup. You pay Cloudflare direct for D1, Queues, and Email Sending usage. The Worker runs on the free tier for most lists.</p>`,
    },
  };
  const found = pages[page] ?? pages.tutorial!;
  const html = shell(c, `Docs — ${page}`, found.kicker, found.body, rail);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});

app.get("/embed.js", (c) => {
  const js = `(function () {
  var mount = document.querySelector("[data-optkit]");
  if (!mount) return;
  var account = mount.getAttribute("data-optkit-account") || "account-1";
  var list = mount.getAttribute("data-optkit-list") || "list-1";
  mount.innerHTML = '<form style="display:flex;gap:8px"><input type="email" required placeholder="you@domain.com" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:6px"><button type="submit" style="padding:8px 14px;border-radius:6px;background:#111;color:#fff;border:0;cursor:pointer">Subscribe</button></form><p style="font-size:12px;color:#666;margin-top:6px"></p>';
  var form = mount.querySelector("form");
  var note = mount.querySelector("p");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var email = form.querySelector("input").value;
    fetch("https://optkit.com/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, account: account, list: list, source: "embed" }),
    }).then(async function (res) {
      if (res.ok) { note.textContent = "Check your inbox to confirm."; form.reset(); return; }
      if (res.status === 409) { note.textContent = "Already subscribed."; return; }
      note.textContent = "Subscribe failed.";
    }).catch(function () { note.textContent = "Could not reach the server."; });
  });
})();`;
  return new Response(js, { headers: { "Content-Type": "application/javascript" } });
});

app.post("/api/subscribe", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const body = (await c.req.json().catch(() => null)) as {
    email?: string;
    account?: string;
    list?: string;
    source?: string;
    turnstile?: string;
  } | null;
  const emailAddress = body?.email?.trim().toLowerCase() || "";
  if (!EMAIL_RE.test(emailAddress)) return c.text("Invalid email", 400);
  const accountId = body?.account || ACCOUNT_ID;
  const listId = body?.list || LIST_ID;
  const allowed = await checkRateLimit(c.env.DB, `ip:${ip}`, 5, 60_000);
  if (!allowed) return c.text("Too many requests", 429);
  const allowedEmail = await checkRateLimit(c.env.DB, `email:${accountId}:${emailAddress}`, 5, 60_000);
  if (!allowedEmail) return c.text("Too many requests", 429);
  const turnstileOk = await verifyTurnstile(c.env.TURNSTILE_SECRET, body?.turnstile ?? null);
  if (!turnstileOk) return c.text("Verification failed", 403);
  await ensureAccount(c.env.DB, accountId, accountId === ACCOUNT_ID ? "coey.dev" : accountId);
  await ensureList(c.env.DB, accountId, listId, listId === LIST_ID ? "coey.dev newsletter" : listId);
  const existing = await getSubscriber(c.env.DB, accountId, listId, emailAddress);
  if (existing?.status === "confirmed") return c.text("Already subscribed", 409);
  const { token } = await subscribe(c.env.DB, c.env.SIGNING_SECRET, accountId, listId, emailAddress, body?.source || "web");
  const confirmUrl = `${base(c.req.raw)}/api/confirm?token=${token}`;
  const unsubToken = existing ? await makeUnsubscribeToken(c.env.SIGNING_SECRET, existing.id) : "";
  const unsubscribeUrl = unsubToken ? `${base(c.req.raw)}/api/unsubscribe?token=${unsubToken}` : `${base(c.req.raw)}/api/unsubscribe`;
  await Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        sendTransactional(
          c.env,
          emailAddress,
          "Confirm your subscription",
          `<p>Confirm your subscription to optkit.</p><p><a href="${confirmUrl}">Confirm</a></p><p>Confirm link expires in 24 hours.</p>`,
          `Confirm your subscription: ${confirmUrl}`,
          unsubscribeUrl,
        ),
      catch: (error) => error as Error,
    }),
  ).catch(() => undefined);
  return json({ ok: true });
});

app.get("/api/confirm", async (c) => {
  const token = c.req.query("token") || "";
  const row = await confirmSubscription(c.env.DB, token);
  if (!row) return c.text("Invalid or expired token", 403);
  const unsubToken = await makeUnsubscribeToken(c.env.SIGNING_SECRET, row.id);
  const unsubscribeUrl = `${base(c.req.raw)}/api/unsubscribe?token=${unsubToken}`;
  await sendTransactional(
    c.env,
    row.email,
    "Welcome to optkit",
    `<p>Welcome. You are confirmed.</p><p>${unsubscribeUrl}</p>`,
    `Welcome. You are confirmed. Unsubscribe: ${unsubscribeUrl}`,
    unsubscribeUrl,
  ).catch(() => undefined);
  return new Response("Subscription confirmed.", { headers: { "Content-Type": "text/plain" } });
});

app.post("/api/unsubscribe", async (c) => {
  const url = new URL(c.req.url);
  let token = url.searchParams.get("token") || "";
  if (!token) {
    const body = (await c.req.json().catch(() => null)) as { token?: string } | null;
    token = body?.token || "";
  }
  if (!token) return c.text("Token required", 400);
  const body = await verifyToken(c.env.SIGNING_SECRET, token);
  if (!body?.startsWith("unsub:")) return c.text("Invalid token", 403);
  const subscriberId = body.slice("unsub:".length);
  const row = await unsubscribe(c.env.DB, subscriberId, "one-click");
  if (!row) return c.text("Not found", 404);
  return new Response("Unsubscribed.", { headers: { "Content-Type": "text/plain" } });
});

app.get("/api/unsubscribe", async (c) => {
  const token = c.req.query("token") || "";
  if (!token) {
    return new Response("<p>Provide a token from an optkit email.</p>", { headers: { "Content-Type": "text/html" } });
  }
  const body = await verifyToken(c.env.SIGNING_SECRET, token);
  if (!body?.startsWith("unsub:")) return c.text("Invalid token", 403);
  const html = `<form method="post" action="/api/unsubscribe?token=${token}"><p>Unsubscribe from optkit?</p><button type="submit">Unsubscribe</button></form>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
});

app.get("/dashboard", async (c) => {
  if (!(await authed(c))) {
    const html = `<!doctype html><html><head><title>Owner sign in — optkit</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-stone-50"><main class="mx-auto max-w-sm px-6 py-16"><h1 class="text-xl font-bold">Owner sign in</h1><form method="post" action="/dashboard/login" class="mt-4 flex flex-col gap-3"><label class="text-sm">Password<input type="password" name="password" required class="mt-1 w-full rounded border border-stone-300 px-3 py-2"></label><button class="rounded bg-stone-900 px-4 py-2 text-white">Sign in</button></form></main></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
  const { rows, total } = await listSubscribers(c.env.DB, ACCOUNT_ID, LIST_ID, "", "", 5, 0);
  const campaigns = await listCampaigns(c.env.DB, ACCOUNT_ID);
  const rowsHtml = rows.map((row) => `<tr><td class="border p-2">${row.email}</td><td class="border p-2">${row.status}</td></tr>`).join("");
  const campaignsHtml = campaigns
    .map((row) => `<tr><td class="border p-2">${row.subject}</td><td class="border p-2">${row.status}</td><td class="border p-2">${row.sent}/${row.total}</td></tr>`)
    .join("");
  const html = `<!doctype html><html><head><title>Dashboard — optkit</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-stone-50"><main class="mx-auto max-w-3xl px-6 py-10"><h1 class="text-2xl font-bold">optkit dashboard</h1><p class="mt-1 text-sm text-stone-600">Account ${ACCOUNT_ID} · list ${LIST_ID} · ${total} subscribers</p><section class="mt-6"><h2 class="font-semibold">Subscribers (first 5)</h2><table class="mt-2 w-full border-collapse text-sm"><thead><tr><th class="border p-2 text-left">Email</th><th class="border p-2 text-left">Status</th></tr></thead><tbody>${rowsHtml || "<tr><td class='border p-2' colspan='2'>None yet</td></tr>"}</tbody></table></section><section class="mt-6"><h2 class="font-semibold">Campaigns</h2><table class="mt-2 w-full border-collapse text-sm"><thead><tr><th class="border p-2 text-left">Subject</th><th class="border p-2 text-left">Status</th><th class="border p-2 text-left">Sent</th></tr></thead><tbody>${campaignsHtml || "<tr><td class='border p-2' colspan='3'>None yet</td></tr>"}</tbody></table></section><form method="post" action="/dashboard/logout" class="mt-8"><button class="rounded border px-3 py-1 text-sm">Sign out</button></form></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
});

app.post("/dashboard/login", async (c) => {
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const password = String(form.password || "");
  const ok = await checkOwnerPassword(c.env.OWNER_PASSWORD_HASH, password);
  const headers = new Headers({ Location: "/dashboard" });
  if (!ok) {
    headers.append("Set-Cookie", sessionCookie("", 0));
    return new Response("Invalid password", { status: 403, headers });
  }
  const session = await makeSession(c.env.SESSION_SECRET);
  headers.append("Set-Cookie", sessionCookie(session, 30 * 24 * 60 * 60));
  return new Response(null, { status: 303, headers });
});

app.post("/dashboard/logout", (c) => {
  const headers = new Headers({ Location: "/dashboard" });
  headers.append("Set-Cookie", clearSessionCookie());
  return new Response(null, { status: 303, headers });
});

async function requireOwner(c: { env: Env; req: { header: (name: string) => string | undefined | null } }): Promise<boolean> {
  return authed(c);
}

app.get("/api/admin/subscribers", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  const search = c.req.query("search") || "";
  const status = c.req.query("status") || "";
  const limit = Math.min(Number(c.req.query("limit") || 100), 1000);
  const offset = Number(c.req.query("offset") || 0);
  const { rows, total } = await listSubscribers(c.env.DB, ACCOUNT_ID, LIST_ID, search, status, limit, offset);
  return json({ ok: true, subscribers: rows, total });
});

app.get("/api/admin/subscribers.csv", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  let offset = 0;
  const lines: string[] = ["email,status,created_at"];
  for (;;) {
    const { rows } = await listSubscribers(c.env.DB, ACCOUNT_ID, LIST_ID, "", "", 1000, offset);
    for (const row of rows) lines.push(`${row.email},${row.status},${row.created_at}`);
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=subscribers.csv" } });
});

app.delete("/api/admin/subscribers/:id", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  await deleteSubscriber(c.env.DB, c.req.param("id"));
  return json({ ok: true });
});

app.post("/api/admin/import", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  const text = await c.req.text();
  const emails = text
    .split(/[\r\n,]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => EMAIL_RE.test(part));
  await ensureAccount(c.env.DB, ACCOUNT_ID, "coey.dev");
  await ensureList(c.env.DB, ACCOUNT_ID, LIST_ID, "coey.dev newsletter");
  let imported = 0;
  for (const email of emails) {
    const existing = await getSubscriber(c.env.DB, ACCOUNT_ID, LIST_ID, email);
    if (!existing) {
      const id = newId();
      const now = nowIso();
      await c.env.DB.prepare(
        `INSERT INTO subscribers (id, account_id, list_id, email, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'confirmed', ?, ?)`,
      )
        .bind(id, ACCOUNT_ID, LIST_ID, email, now, now)
        .run();
      imported += 1;
    }
  }
  await logEvent(c.env.DB, ACCOUNT_ID, "subscribers.import", { imported });
  return json({ ok: true, imported });
});

app.post("/api/admin/campaigns", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  const body = (await c.req.json().catch(() => null)) as { subject?: string; html?: string; text?: string } | null;
  if (!body?.subject || !body?.html) return c.text("Subject and HTML required", 400);
  const campaign = await createCampaign(c.env.DB, ACCOUNT_ID, LIST_ID, body.subject, body.html, body.text || "");
  return json({ ok: true, campaign });
});

app.get("/api/admin/campaigns", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  const campaigns = await listCampaigns(c.env.DB, ACCOUNT_ID);
  return json({ ok: true, campaigns });
});

app.get("/api/admin/campaigns/:id", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign) return c.text("Not found", 404);
  return json({ ok: true, campaign });
});

app.post("/api/admin/campaigns/:id/preview", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign) return c.text("Not found", 404);
  const unsubToken = "preview";
  return json({ ok: true, preview: { subject: campaign.subject, html: campaign.html.replaceAll("{{email}}", "you@domain.com").replaceAll("{{unsubscribe_url}}", `/api/unsubscribe?token=${unsubToken}`) } });
});

app.post("/api/admin/campaigns/:id/test-send", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  const body = (await c.req.json().catch(() => null)) as { to?: string } | null;
  const to = body?.to?.trim().toLowerCase() || "";
  if (!EMAIL_RE.test(to)) return c.text("Valid to required", 400);
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign) return c.text("Not found", 404);
  await sendTransactional(c.env, to, `[test] ${campaign.subject}`, campaign.html.replaceAll("{{email}}", to), campaign.text_body.replaceAll("{{email}}", to), `${base(c.req.raw)}/api/unsubscribe`);
  return json({ ok: true });
});

app.post("/api/admin/campaigns/:id/send", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign) return c.text("Not found", 404);
  await updateCampaign(c.env.DB, campaign.id, { status: "queued" });
  const enqueued = await fanOutCampaign(c.env, campaign.id);
  return json({ ok: true, campaign: { ...campaign, total: enqueued, status: "sending" } });
});

app.post("/api/admin/api-keys", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  const body = (await c.req.json().catch(() => null)) as { label?: string; scopes?: string } | null;
  const { id, key } = await createApiKey(c.env.DB, ACCOUNT_ID, body?.label || "agent", body?.scopes || "read,write");
  return json({ ok: true, id, key });
});

async function requireV1(c: { env: Env; req: { header: (name: string) => string | undefined | null } }) {
  const key = await apiKeyAuth(c);
  if (!key) return null;
  return key;
}

app.post("/api/v1/subscribe", async (c) => {
  const key = await requireV1(c);
  if (!key) return forbidden();
  if (!key.scopes.includes("write") && !key.scopes.includes("read")) return forbidden();
  const body = (await c.req.json().catch(() => null)) as { email?: string; list?: string } | null;
  const emailAddress = body?.email?.trim().toLowerCase() || "";
  if (!EMAIL_RE.test(emailAddress)) return c.text("Invalid email", 400);
  const listId = body?.list || LIST_ID;
  await ensureAccount(c.env.DB, key.accountId, key.accountId);
  await ensureList(c.env.DB, key.accountId, listId, listId);
  const { token } = await subscribe(c.env.DB, c.env.SIGNING_SECRET, key.accountId, listId, emailAddress, "api");
  const existing = await getSubscriber(c.env.DB, key.accountId, listId, emailAddress);
  const unsubToken = existing ? await makeUnsubscribeToken(c.env.SIGNING_SECRET, existing.id) : "";
  await sendTransactional(
    c.env,
    emailAddress,
    "Confirm your subscription",
    `<p>Confirm: ${base(c.req.raw)}/api/confirm?token=${token}</p>`,
    `Confirm: ${base(c.req.raw)}/api/confirm?token=${token}`,
    `${base(c.req.raw)}/api/unsubscribe?token=${unsubToken}`,
  ).catch(() => undefined);
  return json({ ok: true });
});

app.get("/api/v1/lists/:list", async (c) => {
  const key = await requireV1(c);
  if (!key) return forbidden();
  const listId = c.req.param("list");
  const { rows, total } = await listSubscribers(c.env.DB, key.accountId, listId, "", "confirmed", 5, 0);
  return json({ ok: true, subscribers: rows, total });
});

app.post("/api/v1/campaigns", async (c) => {
  const key = await requireV1(c);
  if (!key) return forbidden();
  if (!key.scopes.includes("write")) return forbidden();
  const body = (await c.req.json().catch(() => null)) as { subject?: string; html?: string; text?: string; list?: string } | null;
  if (!body?.subject || !body?.html) return c.text("Subject and HTML required", 400);
  const campaign = await createCampaign(c.env.DB, key.accountId, body?.list || LIST_ID, body.subject, body.html, body.text || "");
  return json({ ok: true, campaign });
});

app.get("/api/v1/campaigns/:id", async (c) => {
  const key = await requireV1(c);
  if (!key) return forbidden();
  const campaign = (await getCampaign(c.env.DB, c.req.param("id"))) as CampaignRow | null;
  if (!campaign || campaign.account_id !== key.accountId) return c.text("Not found", 404);
  return json({ ok: true, campaign });
});

app.post("/api/v1/campaigns/:id/preview", async (c) => {
  const key = await requireV1(c);
  if (!key) return forbidden();
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign || campaign.account_id !== key.accountId) return c.text("Not found", 404);
  return json({ ok: true, preview: { subject: campaign.subject, html: campaign.html } });
});

app.post("/api/v1/campaigns/:id/test-send", async (c) => {
  const key = await requireV1(c);
  if (!key) return forbidden();
  if (!key.scopes.includes("write")) return forbidden();
  const body = (await c.req.json().catch(() => null)) as { to?: string } | null;
  const to = body?.to?.trim().toLowerCase() || "";
  if (!EMAIL_RE.test(to)) return c.text("Valid to required", 400);
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign || campaign.account_id !== key.accountId) return c.text("Not found", 404);
  await sendTransactional(c.env, to, `[test] ${campaign.subject}`, campaign.html.replaceAll("{{email}}", to), campaign.text_body.replaceAll("{{email}}", to), `${base(c.req.raw)}/api/unsubscribe`);
  return json({ ok: true });
});

app.post("/api/v1/campaigns/:id/request-send", async (c) => {
  const key = await requireV1(c);
  if (!key) return forbidden();
  if (!key.scopes.includes("write")) return forbidden();
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign || campaign.account_id !== key.accountId) return c.text("Not found", 404);
  const token = await createApiKeyConfirmation(c.env.DB, key.id, campaign.id);
  await logEvent(c.env.DB, key.accountId, "campaign.send_requested", { campaignId: campaign.id }, undefined, campaign.id);
  return json({ ok: true, confirmationToken: token });
});

app.post("/api/v1/campaigns/:id/send", async (c) => {
  const key = await requireV1(c);
  if (!key) return forbidden();
  if (!key.scopes.includes("write")) return forbidden();
  const body = (await c.req.json().catch(() => null)) as { confirmationToken?: string } | null;
  const campaign = await getCampaign(c.env.DB, c.req.param("id"));
  if (!campaign || campaign.account_id !== key.accountId) return c.text("Not found", 404);
  const consumed = body?.confirmationToken
    ? await consumeApiKeyConfirmation(c.env.DB, key.id, campaign.id, body.confirmationToken)
    : false;
  if (!consumed) {
    await logEvent(c.env.DB, key.accountId, "campaign.send_refused", { campaignId: campaign.id, reason: "owner confirmation required or invalid" }, undefined, campaign.id);
    return json({ ok: false, error: "Owner confirmation required" }, 403);
  }
  await updateCampaign(c.env.DB, campaign.id, { status: "queued" });
  const enqueued = await fanOutCampaign(c.env, campaign.id);
  return json({ ok: true, campaign: { ...campaign, total: enqueued, status: "sending" } });
});

app.post("/mcp", async (c) => {
  const key = await requireV1(c);
  if (!key) return forbidden();
  const payload = (await c.req.json().catch(() => null)) as {
    jsonrpc?: string;
    id?: string | number;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  } | null;
  if (!payload || payload.jsonrpc !== "2.0") return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
  const dispatch = async (): Promise<{ result?: unknown; error?: { code: number; message: string } }> => {
    if (payload.method === "initialize") {
      return { result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "optkit", version: "0.0.1" } } };
    }
    if (payload.method === "tools/list") {
      return {
        result: {
          tools: [
            { name: "list_lists", description: "List campaign lists", inputSchema: { type: "object" } },
            { name: "list_subscribers", description: "List confirmed subscribers", inputSchema: { type: "object", properties: { list: { type: "string" } } } },
            { name: "draft_campaign", description: "Draft a campaign without sending", inputSchema: { type: "object", properties: { subject: { type: "string" }, html: { type: "string" }, list: { type: "string" } }, required: ["subject", "html"] } },
            { name: "preview_campaign", description: "Preview a campaign", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
            { name: "send_test", description: "Send a test email", inputSchema: { type: "object", properties: { id: { type: "string" }, to: { type: "string" } }, required: ["id", "to"] } },
            { name: "send_campaign", description: "Send a campaign. Requires owner confirmation token.", inputSchema: { type: "object", properties: { id: { type: "string" }, confirmationToken: { type: "string" } }, required: ["id"] } },
            { name: "campaign_status", description: "Campaign status", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
          ],
        },
      };
    }
    if (payload.method === "tools/call") {
      const name = payload.params?.name || "";
      const args = payload.params?.arguments || {};
      const text = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
      if (name === "list_lists") {
        const { total } = await listSubscribers(c.env.DB, key.accountId, LIST_ID, "", "confirmed", 1, 0);
        return { result: text({ lists: [{ id: LIST_ID }], total }) };
      }
      if (name === "list_subscribers") {
        const list = String(args.list || LIST_ID);
        const { rows, total } = await listSubscribers(c.env.DB, key.accountId, list, "", "confirmed", 10, 0);
        return { result: text({ subscribers: rows.map((row) => row.email), total }) };
      }
      if (name === "draft_campaign") {
        if (!key.scopes.includes("write")) return { error: { code: -32001, message: "Forbidden" } };
        const campaign = await createCampaign(c.env.DB, key.accountId, String(args.list || LIST_ID), String(args.subject), String(args.html), "");
        return { result: text({ campaign }) };
      }
      if (name === "preview_campaign") {
        const campaign = await getCampaign(c.env.DB, String(args.id));
        if (!campaign || campaign.account_id !== key.accountId) return { error: { code: -32602, message: "Not found" } };
        return { result: text({ preview: { subject: campaign.subject, html: campaign.html } }) };
      }
      if (name === "send_test") {
        if (!key.scopes.includes("write")) return { error: { code: -32001, message: "Forbidden" } };
        const campaign = await getCampaign(c.env.DB, String(args.id));
        if (!campaign || campaign.account_id !== key.accountId) return { error: { code: -32602, message: "Not found" } };
        const to = String(args.to);
        await sendTransactional(c.env, to, `[test] ${campaign.subject}`, campaign.html.replaceAll("{{email}}", to), campaign.text_body.replaceAll("{{email}}", to), `${base(c.req.raw)}/api/unsubscribe`);
        return { result: text({ ok: true }) };
      }
      if (name === "send_campaign") {
        if (!key.scopes.includes("write")) return { error: { code: -32001, message: "Forbidden" } };
        const campaign = await getCampaign(c.env.DB, String(args.id));
        if (!campaign || campaign.account_id !== key.accountId) return { error: { code: -32602, message: "Not found" } };
        const consumed = args.confirmationToken
          ? await consumeApiKeyConfirmation(c.env.DB, key.id, campaign.id, String(args.confirmationToken))
          : false;
        if (!consumed) return { error: { code: -32001, message: "Owner confirmation required" } };
        await updateCampaign(c.env.DB, campaign.id, { status: "queued" });
        const enqueued = await fanOutCampaign(c.env, campaign.id);
        return { result: text({ ok: true, total: enqueued }) };
      }
      if (name === "campaign_status") {
        const campaign = await getCampaign(c.env.DB, String(args.id));
        if (!campaign || campaign.account_id !== key.accountId) return { error: { code: -32602, message: "Not found" } };
        return { result: text({ campaign }) };
      }
      return { error: { code: -32601, message: "Unknown tool" } };
    }
    return { error: { code: -32601, message: "Method not found" } };
  };
  const outcome = await dispatch();
  return json({ jsonrpc: "2.0", id: payload.id ?? null, ...outcome });
});

app.post("/api/import-legacy", async (c) => {
  if (!(await requireOwner(c))) return forbidden();
  const body = (await c.req.json().catch(() => null)) as { addresses?: string[] } | null;
  const addresses = (body?.addresses || []).map((address) => address.trim().toLowerCase()).filter((address) => EMAIL_RE.test(address));
  const unique = [...new Set(addresses)];
  await ensureAccount(c.env.DB, ACCOUNT_ID, "coey.dev");
  await ensureList(c.env.DB, ACCOUNT_ID, LIST_ID, "coey.dev newsletter");
  let imported = 0;
  let skipped = 0;
  for (const email of unique) {
    const existing = await getSubscriber(c.env.DB, ACCOUNT_ID, LIST_ID, email);
    if (existing) {
      skipped += 1;
      continue;
    }
    const id = newId();
    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO subscribers (id, account_id, list_id, email, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'confirmed', ?, ?)`,
    )
      .bind(id, ACCOUNT_ID, LIST_ID, email, now, now)
      .run();
    imported += 1;
  }
  const { total } = await listSubscribers(c.env.DB, ACCOUNT_ID, LIST_ID, "", "", 1, 0);
  return json({ ok: true, received: addresses.length, unique: unique.length, imported, skipped, totalInList: total });
});

export default app;

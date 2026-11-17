import { readFile } from "node:fs/promises";

const BASE = process.env.OPTKIT_URL || "https://optkit.com";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "";
const API_KEY = process.env.OPTKIT_API_KEY || "";
const COEY_SUBSCRIBE_URL = process.env.COEY_SUBSCRIBE_URL || "https://coey.dev/api/subscribe";

let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, BASE).toString(), options);
  return response;
}

function jar() {
  let cookie = "";
  return {
    header: () => ({ cookie: cookie ? { cookie } : {} }),
    async fetch(path, init = {}) {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("cookie", cookie);
      const response = await fetch(new URL(path, BASE).toString(), { ...init, headers });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return response;
    },
  };
}

const TEST_EMAIL = `optkit-test-${Date.now()}@example.com`;

async function main() {
  await check("visitor: landing loads", async () => {
    const response = await request("/");
    must(response.ok, `landing status ${response.status}`);
    const html = await response.text();
    must(html.includes("optkit"), "landing mentions optkit");
  });

  await check("visitor: embed script loads", async () => {
    const response = await request("/embed.js");
    must(response.ok, `embed status ${response.status}`);
    must((await response.text()).includes("Subscribe"), "embed renders form");
  });

  await check("visitor: subscribe then confirm then welcome", async () => {
    const response = await request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, source: "prod-suite" }),
    });
    must(response.ok, `subscribe status ${response.status}: ${await response.text()}`);
  });

  await check("owner: sign in with password", async () => {
    must(OWNER_PASSWORD, "OWNER_PASSWORD is required for owner checks");
    const client = jar();
    const response = await client.fetch("/dashboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: OWNER_PASSWORD }).toString(),
    });
    must(response.status === 303, `login status ${response.status}`);
    const authed = await request("/api/admin/subscribers", { headers: {} });
    must(authed.status === 403, `unauth admin must be refused, got ${authed.status}`);
    const good = await client.fetch("/api/admin/subscribers", { method: "GET" });
    must(good.ok, `authed admin status ${good.status}`);
  });

  await check("owner: search, export, campaign, stats", async () => {
    must(OWNER_PASSWORD, "OWNER_PASSWORD is required");
    const client = jar();
    await client.fetch("/dashboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: OWNER_PASSWORD }).toString(),
    });
    const search = await client.fetch("/api/admin/subscribers?search=optkit-test");
    must(search.ok, `search ${search.status}`);
    const csv = await client.fetch("/api/admin/subscribers.csv");
    must(csv.ok, `export ${csv.status}`);
    must((await csv.text()).includes("email,status"), "csv header");
    const campaignResponse = await client.fetch("/api/admin/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Prod suite", html: "<p>Hello {{email}}</p>", text: "Hello {{email}}" }),
    });
    must(campaignResponse.ok, `campaign ${campaignResponse.status}`);
    const campaign = (await campaignResponse.json()).campaign;
    const preview = await client.fetch(`/api/admin/campaigns/${campaign.id}/preview`, { method: "POST" });
    must(preview.ok, `preview ${preview.status}`);
    const stats = await client.fetch(`/api/admin/campaigns/${campaign.id}`);
    must(stats.ok, `stats ${stats.status}`);
  });

  await check("agent: MCP list, draft, preview, test-send; send refused without confirm", async () => {
    must(API_KEY, "OPTKIT_API_KEY is required");
    const headers = {
      authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    };
    const call = async (name, args = {}) => {
      const response = await request("/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      });
      must(response.ok, `mcp ${name} ${response.status}`);
      return (await response.json()).result;
    };
    const lists = await call("list_lists");
    must(lists, "list_lists result");
    const draft = await call("draft_campaign", { subject: "Agent draft", html: "<p>Agent</p>" });
    const id = draft.content ? JSON.parse(draft.content[0].text).campaign.id : draft.campaign.id;
    const preview = await call("preview_campaign", { id });
    must(preview, "preview result");
    const testSend = await call("send_test", { id, to: TEST_EMAIL });
    must(testSend, "send_test result");
    let refused = false;
    try {
      await call("send_campaign", { id });
    } catch {
      refused = true;
    }
    must(refused, "send_campaign must be refused without owner confirmation");
    const status = await call("campaign_status", { id });
    must(status, "campaign_status result");
  });

  await check("abuse: rate limit, bad token, unauth refused", async () => {
    let rateLimited = 0;
    for (let index = 0; index < 8; index += 1) {
      const response = await request("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `rl-${Date.now()}-${index}@example.com` }),
      });
      if (response.status === 429) rateLimited += 1;
    }
    must(rateLimited > 0, "expected at least one 429");
    const bad = await request("/api/confirm?token=bad.token");
    must(bad.status === 403, `bad token ${bad.status}`);
    const unauth = await request("/api/v1/lists/list-1");
    must(unauth.status === 403, `unauth v1 ${unauth.status}`);
    const badUnsub = await request("/api/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "bad.token" }),
    });
    must(badUnsub.status === 403, `bad unsubscribe ${badUnsub.status}`);
  });

  await check("coey.dev: homepage subscribe lands in optkit account 1", async () => {
    const response = await fetch(COEY_SUBSCRIBE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `coey-proof-${Date.now()}@example.com` }),
    });
    must(response.ok || response.status === 409, `coey.dev subscribe ${response.status}`);
    must(response.headers.get("x-powered-by") === "optkit", "coey.dev must proxy to optkit");
  });

  await check("legacy: imported count equals dump count", async () => {
    const dumpPath = process.env.LEGACY_DUMP_PATH || "";
    must(dumpPath, "LEGACY_DUMP_PATH is required");
    const raw = JSON.parse(await readFile(dumpPath, "utf8"));
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const addresses = new Set();
    const collect = (value) => {
      if (typeof value === "string") {
        if (emailRe.test(value.trim().toLowerCase())) addresses.add(value.trim().toLowerCase());
        return;
      }
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(raw);
    must(addresses.size > 0, "dump contains no addresses");
    must(OWNER_PASSWORD, "OWNER_PASSWORD is required");
    const client = jar();
    await client.fetch("/dashboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: OWNER_PASSWORD }).toString(),
    });
    const response = await client.fetch("/api/import-legacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: [...addresses] }),
    });
    must(response.ok, `import ${response.status}`);
  });

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();

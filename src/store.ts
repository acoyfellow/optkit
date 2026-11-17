import { randomToken, makeConfirmToken, sha256Hex } from "./crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export type SubscriberRow = {
  id: string;
  account_id: string;
  list_id: string;
  email: string;
  status: string;
  confirm_token_hash: string | null;
  confirm_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function ensureAccount(db: D1Database, accountId: string, name: string): Promise<void> {
  await db
    .prepare(`INSERT OR IGNORE INTO accounts (id, name, created_at) VALUES (?, ?, ?)`)
    .bind(accountId, name, nowIso())
    .run();
}

export async function ensureList(db: D1Database, accountId: string, listId: string, name: string): Promise<string> {
  const existing = (await db
    .prepare(`SELECT id FROM lists WHERE account_id = ? AND id = ?`)
    .bind(accountId, listId)
    .first<{ id: string }>()) as { id: string } | null;
  if (existing) return existing.id;
  await db
    .prepare(`INSERT INTO lists (id, account_id, name, created_at) VALUES (?, ?, ?, ?)`)
    .bind(listId, accountId, name, nowIso())
    .run();
  return listId;
}

export async function getSubscriber(
  db: D1Database,
  accountId: string,
  listId: string,
  email: string,
): Promise<SubscriberRow | null> {
  return (await db
    .prepare(`SELECT * FROM subscribers WHERE account_id = ? AND list_id = ? AND email = ?`)
    .bind(accountId, listId, email)
    .first()) as SubscriberRow | null;
}

export type SubscribeResult = { token: string; isNew: boolean };

export async function subscribe(
  db: D1Database,
  signingSecret: string,
  accountId: string,
  listId: string,
  email: string,
  source: string,
): Promise<SubscribeResult> {
  const normalized = email.trim().toLowerCase();
  const now = nowIso();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const existing = await getSubscriber(db, accountId, listId, normalized);
  if (existing?.status === "confirmed") {
    return { token: "", isNew: false };
  }
  const token = await makeConfirmToken(signingSecret);
  const tokenHash = await sha256Hex(token);
  if (existing) {
    await db
      .prepare(
        `UPDATE subscribers SET status = 'pending', confirm_token_hash = ?, confirm_expires_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(tokenHash, expires, now, existing.id)
      .run();
    await db
      .prepare(`INSERT INTO consents (id, subscriber_id, action, source, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(newId(), existing.id, "subscribe", source, now)
      .run();
    return { token, isNew: false };
  }
  const id = newId();
  await db
    .prepare(
      `INSERT INTO subscribers (id, account_id, list_id, email, status, confirm_token_hash, confirm_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .bind(id, accountId, listId, normalized, tokenHash, expires, now, now)
    .run();
  await db
    .prepare(`INSERT INTO consents (id, subscriber_id, action, source, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(newId(), id, "subscribe", source, now)
    .run();
  return { token, isNew: true };
}

export async function confirmSubscription(
  db: D1Database,
  token: string,
): Promise<SubscriberRow | null> {
  const tokenHash = await sha256Hex(token);
  const row = (await db
    .prepare(`SELECT * FROM subscribers WHERE confirm_token_hash = ? AND status = 'pending'`)
    .bind(tokenHash)
    .first()) as SubscriberRow | null;
  if (!row) return null;
  if (row.confirm_expires_at && new Date(row.confirm_expires_at).getTime() < Date.now()) return null;
  const now = nowIso();
  await db
    .prepare(
      `UPDATE subscribers SET status = 'confirmed', confirm_token_hash = NULL, confirm_expires_at = NULL, updated_at = ? WHERE id = ?`,
    )
    .bind(now, row.id)
    .run();
  await db
    .prepare(`INSERT INTO consents (id, subscriber_id, action, source, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(newId(), row.id, "confirm", "email-link", now)
    .run();
  return { ...row, status: "confirmed" };
}

export async function unsubscribe(db: D1Database, subscriberId: string, source: string): Promise<SubscriberRow | null> {
  const row = (await db
    .prepare(`SELECT * FROM subscribers WHERE id = ?`)
    .bind(subscriberId)
    .first()) as SubscriberRow | null;
  if (!row) return null;
  const now = nowIso();
  await db
    .prepare(`UPDATE subscribers SET status = 'unsubscribed', updated_at = ? WHERE id = ?`)
    .bind(now, subscriberId)
    .run();
  await db
    .prepare(`INSERT INTO consents (id, subscriber_id, action, source, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(newId(), subscriberId, "unsubscribe", source, now)
    .run();
  return { ...row, status: "unsubscribed" };
}

export async function getSubscriberById(db: D1Database, id: string): Promise<SubscriberRow | null> {
  return (await db.prepare(`SELECT * FROM subscribers WHERE id = ?`).bind(id).first()) as SubscriberRow | null;
}

export async function listSubscribers(
  db: D1Database,
  accountId: string,
  listId: string,
  search: string,
  status: string,
  limit: number,
  offset: number,
): Promise<{ rows: SubscriberRow[]; total: number }> {
  const clauses: string[] = [`account_id = ?`, `list_id = ?`];
  const params: unknown[] = [accountId, listId];
  if (status) {
    clauses.push(`status = ?`);
    params.push(status);
  }
  if (search) {
    clauses.push(`email LIKE ?`);
    params.push(`%${search.toLowerCase()}%`);
  }
  const where = clauses.join(" AND ");
  const totalRow = (await db
    .prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE ${where}`)
    .bind(...params)
    .first()) as { n: number } | null;
  const rows = (await db
    .prepare(`SELECT * FROM subscribers WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all()) as unknown as { results: SubscriberRow[] };
  return { rows: rows.results, total: totalRow?.n ?? 0 };
}

export async function deleteSubscriber(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM sends WHERE subscriber_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM consents WHERE subscriber_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM subscribers WHERE id = ?`).bind(id).run();
}

export type CampaignRow = {
  id: string;
  account_id: string;
  list_id: string;
  subject: string;
  html: string;
  text_body: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  created_at: string;
  updated_at: string;
};

export async function createCampaign(
  db: D1Database,
  accountId: string,
  listId: string,
  subject: string,
  html: string,
  textBody: string,
): Promise<CampaignRow> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO campaigns (id, account_id, list_id, subject, html, text_body, status, total, sent, failed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', 0, 0, 0, ?, ?)`,
    )
    .bind(id, accountId, listId, subject, html, textBody, now, now)
    .run();
  return {
    id,
    account_id: accountId,
    list_id: listId,
    subject,
    html,
    text_body: textBody,
    status: "draft",
    total: 0,
    sent: 0,
    failed: 0,
    created_at: now,
    updated_at: now,
  };
}

export async function getCampaign(db: D1Database, id: string): Promise<CampaignRow | null> {
  return (await db.prepare(`SELECT * FROM campaigns WHERE id = ?`).bind(id).first()) as CampaignRow | null;
}

export async function updateCampaign(db: D1Database, id: string, fields: Partial<Pick<CampaignRow, "status" | "total" | "sent" | "failed">>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = ?`);
  params.push(nowIso(), id);
  await db.prepare(`UPDATE campaigns SET ${sets.join(", ")} WHERE id = ?`).bind(...params).run();
}

export async function claimSend(
  db: D1Database,
  campaignId: string,
  subscriberId: string,
): Promise<boolean> {
  const now = nowIso();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO sends (campaign_id, subscriber_id, status, attempts, created_at, updated_at) VALUES (?, ?, 'queued', 0, ?, ?)`,
    )
    .bind(campaignId, subscriberId, now, now)
    .run();
  const inserted = (result.meta.changes ?? 0) > 0;
  if (inserted) return true;
  const row = (await db
    .prepare(`SELECT status FROM sends WHERE campaign_id = ? AND subscriber_id = ?`)
    .bind(campaignId, subscriberId)
    .first()) as { status: string } | null;
  if (row?.status === "failed") {
    await db
      .prepare(`UPDATE sends SET status = 'queued', attempts = 0, error = NULL, updated_at = ? WHERE campaign_id = ? AND subscriber_id = ?`)
      .bind(now, campaignId, subscriberId)
      .run();
    return true;
  }
  return false;
}

export async function markSend(db: D1Database, campaignId: string, subscriberId: string, status: string, error?: string): Promise<void> {
  await db
    .prepare(`UPDATE sends SET status = ?, error = ?, updated_at = ? WHERE campaign_id = ? AND subscriber_id = ?`)
    .bind(status, error ?? null, nowIso(), campaignId, subscriberId)
    .run();
  const campaign = (await db
    .prepare(`SELECT sent, failed, total FROM campaigns WHERE id = ?`)
    .bind(campaignId)
    .first()) as { sent: number; failed: number; total: number } | null;
  if (!campaign) return;
  const column = status === "sent" ? "sent" : status === "failed" ? "failed" : null;
  if (column) {
    await db.prepare(`UPDATE campaigns SET ${column} = ${column} + 1, updated_at = ? WHERE id = ?`).bind(nowIso(), campaignId).run();
  }
  if (campaign.sent + campaign.failed + (column === "sent" ? 1 : column === "failed" ? 1 : 0) >= campaign.total && campaign.total > 0) {
    await db.prepare(`UPDATE campaigns SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'sending'`).bind(nowIso(), campaignId).run();
  }
}

export async function listCampaigns(db: D1Database, accountId: string): Promise<CampaignRow[]> {
  const result = (await db
    .prepare(`SELECT * FROM campaigns WHERE account_id = ? ORDER BY created_at DESC LIMIT 50`)
    .bind(accountId)
    .all()) as unknown as { results: CampaignRow[] };
  return result.results;
}

export async function createApiKey(
  db: D1Database,
  accountId: string,
  label: string,
  scopes: string,
): Promise<{ id: string; key: string }> {
  const id = newId();
  const key = `sk_${randomToken(24)}`;
  const keyHash = await sha256Hex(key);
  await db
    .prepare(`INSERT INTO api_keys (id, account_id, label, key_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, accountId, label, keyHash, scopes, nowIso())
    .run();
  return { id, key };
}

export async function verifyApiKey(
  db: D1Database,
  key: string,
): Promise<{ id: string; accountId: string; scopes: string[] } | null> {
  const keyHash = await sha256Hex(key);
  const row = (await db
    .prepare(`SELECT * FROM api_keys WHERE key_hash = ?`)
    .bind(keyHash)
    .first()) as { id: string; account_id: string; scopes: string } | null;
  if (!row) return null;
  await db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).bind(nowIso(), row.id).run();
  return { id: row.id, accountId: row.account_id, scopes: row.scopes.split(",").map((scope) => scope.trim()) };
}

export async function createApiKeyConfirmation(
  db: D1Database,
  keyId: string,
  campaignId: string,
): Promise<string> {
  const id = newId();
  const token = randomToken(16);
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await db
    .prepare(`INSERT INTO api_key_confirmations (id, key_id, campaign_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, keyId, campaignId, tokenHash, expires, nowIso())
    .run();
  return token;
}

export async function consumeApiKeyConfirmation(
  db: D1Database,
  keyId: string,
  campaignId: string,
  token: string,
): Promise<boolean> {
  const tokenHash = await sha256Hex(token);
  const row = (await db
    .prepare(`SELECT * FROM api_key_confirmations WHERE key_id = ? AND campaign_id = ? AND token_hash = ? AND consumed_at IS NULL`)
    .bind(keyId, campaignId, tokenHash)
    .first()) as { id: string; expires_at: string } | null;
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  await db.prepare(`UPDATE api_key_confirmations SET consumed_at = ? WHERE id = ?`).bind(nowIso(), row.id).run();
  return true;
}

export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now();
  const row = (await db.prepare(`SELECT * FROM rate_limits WHERE key = ?`).bind(key).first()) as {
    count: number;
    window_start: string;
  } | null;
  if (!row) {
    await db
      .prepare(`INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)`)
      .bind(key, new Date(now).toISOString())
      .run();
    return true;
  }
  if (new Date(row.window_start).getTime() + windowMs < now) {
    await db
      .prepare(`UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ?`)
      .bind(new Date(now).toISOString(), key)
      .run();
    return true;
  }
  if (row.count >= limit) return false;
  await db.prepare(`UPDATE rate_limits SET count = count + 1 WHERE key = ?`).bind(key).run();
  return true;
}

export async function logEvent(
  db: D1Database,
  accountId: string,
  kind: string,
  data: Record<string, unknown>,
  subscriberId?: string,
  campaignId?: string,
): Promise<void> {
  await db
    .prepare(`INSERT INTO events (id, account_id, kind, subscriber_id, campaign_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId(), accountId, kind, subscriberId ?? null, campaignId ?? null, JSON.stringify(data), nowIso())
    .run();
}

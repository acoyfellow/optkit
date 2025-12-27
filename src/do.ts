import { Effect } from "effect";
import { DurableObject } from "cloudflare:workers";
import { subscribers, campaigns, type Subscriber, type Campaign } from "./schema";
import type { QueryParams, QueryResult, CampaignInput, SubscriberStatus } from "./types";
import { InvalidEmail, AlreadySubscribed, CampaignNotFound } from "./errors";

export interface OptKitDOEnv {
  // No env needed for DO itself
}

export class OptKitDO extends DurableObject<OptKitDOEnv> {
  constructor(state: DurableObjectState, env: OptKitDOEnv) {
    super(state, env);

    // Initialize tables
    state.blockConcurrencyWhile(async () => {
      // Create subscribers table
      await this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS subscribers (
          email TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      // Create campaigns table
      await this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS campaigns (
          id TEXT PRIMARY KEY,
          subject TEXT NOT NULL,
          html TEXT NOT NULL,
          status TEXT NOT NULL,
          total INTEGER NOT NULL DEFAULT 0,
          sent INTEGER NOT NULL DEFAULT 0,
          failed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private validateEmail(email: string): boolean {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRe.test(email);
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  // RPC Methods - These are called via RPC, so they return Promises
  // The Effect wrapping happens in the optkit() function

  async optIn(email: string): Promise<Subscriber> {
    const normalized = this.normalizeEmail(email);
    if (!this.validateEmail(normalized)) {
      throw new InvalidEmail({ email: normalized });
    }

    // Check if exists
    const existing = await this.getSubscriber(normalized);

    if (existing?.status === "active") {
      throw new AlreadySubscribed({ email: normalized });
    }

    const ts = this.nowIso();
    const subscriber: Subscriber = existing
      ? { ...existing, status: "active", updatedAt: ts }
      : {
        email: normalized,
        status: "active",
        createdAt: ts,
        updatedAt: ts,
      };

    // Save to SQL
    await this.saveSubscriber(subscriber);

    return subscriber;
  }

  async optOut(email: string): Promise<Subscriber> {
    const normalized = this.normalizeEmail(email);
    if (!this.validateEmail(normalized)) {
      throw new InvalidEmail({ email: normalized });
    }

    const ts = this.nowIso();
    const existing = await this.getSubscriber(normalized);

    const subscriber: Subscriber = existing
      ? { ...existing, status: "unsubscribed", updatedAt: ts }
      : {
        email: normalized,
        status: "unsubscribed",
        createdAt: ts,
        updatedAt: ts,
      };

    await this.saveSubscriber(subscriber);

    return subscriber;
  }

  async get(email: string): Promise<Subscriber | null> {
    const normalized = this.normalizeEmail(email);
    return await this.getSubscriber(normalized);
  }

  async list(params: QueryParams = {}): Promise<QueryResult> {
    const limit = Math.min(params.limit || 100, 100);
    const offset = ((params.page || 1) - 1) * limit;
    const status = params.status || "";
    const search = params.search || "";
    const sort = params.sort || "created";
    const order = params.order || "desc";

    // Build WHERE clause
    let whereConditions: string[] = [];
    let whereParams: any[] = [];

    if (status) {
      whereConditions.push("status = ?");
      whereParams.push(status);
    }

    if (search) {
      whereConditions.push("email LIKE ?");
      whereParams.push(`%${search}%`);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

    // Build ORDER BY
    let orderBy = "created_at";
    if (sort === "updated") orderBy = "updated_at";
    if (sort === "email") orderBy = "email";
    const orderDir = order === "asc" ? "ASC" : "DESC";

    // Get total count
    const countResult = await this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as count FROM subscribers ${whereClause}`,
      ...whereParams
    );
    const total = Number(countResult.toArray()[0]?.count) || 0;

    // Get active/unsubscribed counts
    const activeResult = await this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as count FROM subscribers WHERE status = 'active' ${search ? "AND email LIKE ?" : ""}`,
      ...(search ? [`%${search}%`] : [])
    );
    const active = Number(activeResult.toArray()[0]?.count) || 0;

    const unsubscribedResult = await this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as count FROM subscribers WHERE status = 'unsubscribed' ${search ? "AND email LIKE ?" : ""}`,
      ...(search ? [`%${search}%`] : [])
    );
    const unsubscribed = Number(unsubscribedResult.toArray()[0]?.count) || 0;

    // Get subscribers
    const result = await this.ctx.storage.sql.exec(
      `SELECT * FROM subscribers ${whereClause} ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`,
      ...whereParams,
      limit,
      offset
    );

    const subscriberList = result.toArray().map((row: any) => ({
      email: row.email,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return {
      subscribers: subscriberList,
      total,
      active,
      unsubscribed,
      hasMore: offset + limit < total,
    };
  }

  async createCampaign(campaign: CampaignInput): Promise<Campaign> {
    const id = crypto.randomUUID();
    const ts = this.nowIso();

    const campaignRecord: Campaign = {
      id,
      subject: campaign.subject,
      html: campaign.html,
      status: "queued",
      total: 0,
      sent: 0,
      failed: 0,
      createdAt: ts,
      updatedAt: ts,
    };

    await this.saveCampaign(campaignRecord);
    return campaignRecord;
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    const result = await this.ctx.storage.sql.exec(
      "SELECT * FROM campaigns WHERE id = ?",
      id
    );
    const rows = result.toArray();
    const row = rows[0];
    if (!row) return null;

    return {
      id: String(row.id),
      subject: String(row.subject),
      html: String(row.html),
      status: String(row.status),
      total: Number(row.total),
      sent: Number(row.sent),
      failed: Number(row.failed),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  async updateCampaign(id: string, updates: Partial<Campaign>): Promise<Campaign> {
    const existing = await this.getCampaign(id);
    if (!existing) {
      throw new CampaignNotFound({ campaignId: id });
    }

    const updated: Campaign = {
      ...existing,
      ...updates,
      updatedAt: this.nowIso(),
    };

    await this.saveCampaign(updated);
    return updated;
  }

  // Private helper methods

  private async getSubscriber(email: string): Promise<Subscriber | null> {
    const result = await this.ctx.storage.sql.exec(
      "SELECT * FROM subscribers WHERE email = ?",
      email
    );
    const rows = result.toArray();
    const row = rows[0];
    if (!row) return null;

    return {
      email: String(row.email),
      status: String(row.status),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private async saveSubscriber(subscriber: Subscriber): Promise<void> {
    await this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO subscribers (email, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      subscriber.email,
      subscriber.status,
      subscriber.createdAt,
      subscriber.updatedAt
    );
  }

  private async saveCampaign(campaign: Campaign): Promise<void> {
    await this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO campaigns (id, subject, html, status, total, sent, failed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      campaign.id,
      campaign.subject,
      campaign.html,
      campaign.status,
      campaign.total,
      campaign.sent,
      campaign.failed,
      campaign.createdAt,
      campaign.updatedAt
    );
  }
}


import type { Effect } from "effect";
import type { Subscriber, Campaign } from "./schema";
import type { InvalidEmail, AlreadySubscribed, CampaignNotFound, EmailSendError, DatabaseError } from "./errors";

export type SubscriberStatus = "active" | "unsubscribed";
export type CampaignStatus = "queued" | "sending" | "completed" | "failed";

export interface QueryParams {
  page?: number;
  limit?: number;
  sort?: "created" | "updated" | "email";
  order?: "asc" | "desc";
  status?: SubscriberStatus | "";
  search?: string;
}

export interface QueryResult {
  subscribers: Subscriber[];
  total: number;
  active: number;
  unsubscribed: number;
  hasMore: boolean;
}

export interface CampaignInput {
  subject: string;
  html: string;
}

export interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

export interface OptKitConfig {
  do: DurableObjectNamespace;
  queue: Queue;
  email: {
    send(message: EmailMessage): Promise<void>;
  };
  templates?: {
    optIn?: (email: string) => EmailTemplate;
    optOut?: (email: string) => EmailTemplate;
    newSubscriber?: (email: string) => EmailTemplate;
  };
  validateEmail?: (email: string) => boolean;
  adminEmail?: string;
  senderEmail?: string;
}

export interface OptKit {
  optIn(email: string): Effect<Subscriber, InvalidEmail | AlreadySubscribed | EmailSendError | DatabaseError>;
  optOut(email: string): Effect<Subscriber, InvalidEmail | EmailSendError | DatabaseError>;
  get(email: string): Effect<Subscriber | null, DatabaseError>;
  list(params?: QueryParams): Effect<QueryResult, DatabaseError>;
  sendCampaign(campaign: CampaignInput): Effect<Campaign, DatabaseError>;
  getCampaign(id: string): Effect<Campaign | null, CampaignNotFound | DatabaseError>;
}

export { type Subscriber, type Campaign };


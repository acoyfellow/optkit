import type { Subscriber, Campaign } from "./schema";

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
  optIn(email: string): Promise<Subscriber>;
  optOut(email: string): Promise<Subscriber>;
  get(email: string): Promise<Subscriber | null>;
  list(params?: QueryParams): Promise<QueryResult>;
  sendCampaign(campaign: CampaignInput): Promise<Campaign>;
  getCampaign(id: string): Promise<Campaign | null>;
}

export { type Subscriber, type Campaign };


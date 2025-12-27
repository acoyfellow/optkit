import type { OptKitConfig, OptKit, Subscriber, Campaign, CampaignInput, QueryParams, QueryResult } from "./types";
import { sendOptInConfirmation, sendOptOutConfirmation, sendNewSubscriberNotification } from "./email";

export function optkit(config: OptKitConfig): OptKit {
  const stub = config.do.getByName("global") as any;

  const defaultValidateEmail = (email: string): boolean => {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRe.test(email.trim().toLowerCase());
  };

  const validateEmail = config.validateEmail || defaultValidateEmail;

  return {
    async optIn(email: string): Promise<Subscriber> {
      if (!validateEmail(email)) {
        throw new Error("Invalid email");
      }

      const subscriber = await stub.optIn(email);

      // Send confirmation emails
      await Promise.allSettled([
        sendOptInConfirmation(email, config),
        sendNewSubscriberNotification(email, config),
      ]);

      return subscriber;
    },

    async optOut(email: string): Promise<Subscriber> {
      if (!validateEmail(email)) {
        throw new Error("Invalid email");
      }

      const subscriber = await stub.optOut(email);

      // Send confirmation
      await sendOptOutConfirmation(email, config).catch(() => {
        // Ignore email errors for opt-out
      });

      return subscriber;
    },

    async get(email: string): Promise<Subscriber | null> {
      return await stub.get(email);
    },

    async list(params?: QueryParams): Promise<QueryResult> {
      return await stub.list(params);
    },

    async sendCampaign(campaign: CampaignInput): Promise<Campaign> {
      // Create campaign
      const campaignRecord = await stub.createCampaign(campaign);

      // Get all active subscribers
      const result = await stub.list({ status: "active", limit: 10000 });
      const activeEmails = result.subscribers.map((s: Subscriber) => s.email);

      // Update campaign total
      await stub.updateCampaign(campaignRecord.id, {
        total: activeEmails.length,
        status: "sending",
      });

      // Queue batches (50-100 emails per batch)
      const batchSize = 50;
      const batches: { campaignId: string; emails: string[]; subject: string; html: string }[] = [];

      for (let i = 0; i < activeEmails.length; i += batchSize) {
        batches.push({
          campaignId: campaignRecord.id,
          emails: activeEmails.slice(i, i + batchSize),
          subject: campaign.subject,
          html: campaign.html,
        });
      }

      // Send batches to queue
      if (batches.length > 0) {
        await config.queue.sendBatch(batches.map(b => ({ body: b })));
      } else {
        // No subscribers, mark as completed
        await stub.updateCampaign(campaignRecord.id, {
          status: "completed",
        });
      }

      return campaignRecord;
    },

    async getCampaign(id: string): Promise<Campaign | null> {
      return await stub.getCampaign(id);
    },
  };
}

// Re-export types and DO
export type { OptKitConfig, OptKit, Subscriber, Campaign, CampaignInput, QueryParams, QueryResult } from "./types";
export { OptKitDO } from "./do";
export { subscribers, campaigns } from "./schema";
export { processCampaignBatch } from "./queue";
export type { QueueMessage } from "./queue";


import { Effect } from "effect";
import type { OptKitConfig, OptKit, Subscriber, Campaign, CampaignInput, QueryParams, QueryResult } from "./types";
import { InvalidEmail, AlreadySubscribed, DatabaseError } from "./errors";
import { sendOptInConfirmation, sendOptOutConfirmation, sendNewSubscriberNotification } from "./email";

export function optkit(config: OptKitConfig): OptKit {
  const stub = config.do.getByName("global") as any;

  const defaultValidateEmail = (email: string): boolean => {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRe.test(email.trim().toLowerCase());
  };

  const validateEmail = config.validateEmail || defaultValidateEmail;

  return {
    optIn(email: string) {
      return Effect.gen(function* () {
        if (!validateEmail(email)) {
          return yield* Effect.fail(new InvalidEmail({ email }));
        }

        const subscriber = yield* Effect.tryPromise({
          try: () => stub.optIn(email) as Promise<Subscriber>,
          catch: (error) => {
            // Check if it's already a TaggedError
            if (error && typeof error === 'object' && '_tag' in error) {
              return error as InvalidEmail | AlreadySubscribed;
            }
            return new DatabaseError({
              operation: "optIn",
              cause: error as Error
            });
          }
        });

        // Send confirmation emails (fire and forget)
        yield* Effect.all([
          sendOptInConfirmation(email, config),
          sendNewSubscriberNotification(email, config),
        ], { mode: "either" });

        return subscriber;
      });
    },

    optOut(email: string) {
      return Effect.gen(function* () {
        if (!validateEmail(email)) {
          return yield* Effect.fail(new InvalidEmail({ email }));
        }

        const subscriber = yield* Effect.tryPromise({
          try: () => stub.optOut(email) as Promise<Subscriber>,
          catch: (error) => {
            // Check if it's already a TaggedError
            if (error && typeof error === 'object' && '_tag' in error) {
              return error as InvalidEmail;
            }
            return new DatabaseError({
              operation: "optOut",
              cause: error as Error
            });
          }
        });

        // Send confirmation (ignore errors)
        yield* Effect.ignore(sendOptOutConfirmation(email, config));

        return subscriber;
      });
    },

    get(email: string) {
      return Effect.tryPromise({
        try: () => stub.get(email) as Promise<Subscriber | null>,
        catch: (error) => new DatabaseError({
          operation: "get",
          cause: error as Error
        })
      });
    },

    list(params?: QueryParams) {
      return Effect.tryPromise({
        try: () => stub.list(params) as Promise<QueryResult>,
        catch: (error) => new DatabaseError({
          operation: "list",
          cause: error as Error
        })
      });
    },

    sendCampaign(campaign: CampaignInput) {
      return Effect.gen(function* () {
        // Create campaign
        const campaignRecord = yield* Effect.tryPromise({
          try: () => stub.createCampaign(campaign) as Promise<Campaign>,
          catch: (error) => new DatabaseError({
            operation: "createCampaign",
            cause: error as Error
          })
        });

        // Get all active subscribers
        const result = yield* Effect.tryPromise({
          try: () => stub.list({ status: "active", limit: 10000 }) as Promise<QueryResult>,
          catch: (error) => new DatabaseError({
            operation: "list",
            cause: error as Error
          })
        });

        const activeEmails = result.subscribers.map((s: Subscriber) => s.email);

        // Update campaign total
        yield* Effect.tryPromise({
          try: () => stub.updateCampaign(campaignRecord.id, {
            total: activeEmails.length,
            status: "sending",
          }) as Promise<Campaign>,
          catch: (error) => new DatabaseError({
            operation: "updateCampaign",
            cause: error as Error
          })
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
          yield* Effect.tryPromise({
            try: () => config.queue.sendBatch(batches.map(b => ({ body: b }))) as Promise<void>,
            catch: (error) => new DatabaseError({
              operation: "sendBatch",
              cause: error as Error
            })
          });
        } else {
          // No subscribers, mark as completed
          yield* Effect.tryPromise({
            try: () => stub.updateCampaign(campaignRecord.id, {
              status: "completed",
            }) as Promise<Campaign>,
            catch: (error) => new DatabaseError({
              operation: "updateCampaign",
              cause: error as Error
            })
          });
        }

        return campaignRecord;
      });
    },

    getCampaign(id: string) {
      return Effect.tryPromise({
        try: () => stub.getCampaign(id) as Promise<Campaign | null>,
        catch: (error) => new DatabaseError({
          operation: "getCampaign",
          cause: error as Error
        })
      });
    },
  };
}

// Re-export types and DO
export type { OptKitConfig, OptKit, Subscriber, Campaign, CampaignInput, QueryParams, QueryResult } from "./types";
export { OptKitDO } from "./do";
export { subscribers, campaigns } from "./schema";
export { processCampaignBatch } from "./queue";
export type { QueueMessage } from "./queue";
export { InvalidEmail, AlreadySubscribed, CampaignNotFound, EmailSendError, DatabaseError } from "./errors";


import { Effect } from "effect";
import type { OptKitConfig } from "./types";
import { sendCampaignBatch } from "./email";
import { DatabaseError, CampaignNotFound } from "./errors";

export interface QueueMessage {
  campaignId: string;
  emails: string[];
  subject: string;
  html: string;
}

export async function processCampaignBatch(
  batch: MessageBatch<QueueMessage>,
  config: OptKitConfig
): Promise<void> {
  const stub = config.do.getByName("global") as any;

  for (const message of batch.messages) {
    const { campaignId, emails, subject, html } = message.body;

    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        // Send emails
        const { sent, failed } = yield* sendCampaignBatch(emails, subject, html, config);

        // Update campaign progress
        const campaign = yield* Effect.tryPromise({
          try: () => stub.getCampaign(campaignId),
          catch: (error) => new DatabaseError({ 
            operation: "getCampaign", 
            cause: error as Error 
          })
        });

        if (!campaign) {
          return yield* Effect.fail(new CampaignNotFound({ campaignId }));
        }

        yield* Effect.tryPromise({
          try: () => stub.updateCampaign(campaignId, {
            sent: campaign.sent + sent,
            failed: campaign.failed + failed,
            status: campaign.sent + sent + campaign.failed + failed >= campaign.total
              ? "completed"
              : "sending",
          }),
          catch: (error) => new DatabaseError({ 
            operation: "updateCampaign", 
            cause: error as Error 
          })
        });
      })
    );

    if (result._tag === "Success") {
      message.ack();
    } else {
      console.error(`Failed to process campaign batch ${campaignId}:`, result.cause);
      message.retry();
    }
  }
}


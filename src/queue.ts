import type { OptKitConfig } from "./types";
import { sendCampaignBatch } from "./email";

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

    try {
      // Send emails
      const { sent, failed } = await sendCampaignBatch(emails, subject, html, config);

      // Update campaign progress
      const campaign = await stub.getCampaign(campaignId);
      if (campaign) {
        await stub.updateCampaign(campaignId, {
          sent: campaign.sent + sent,
          failed: campaign.failed + failed,
          status: campaign.sent + sent + campaign.failed + failed >= campaign.total
            ? "completed"
            : "sending",
        });
      }

      message.ack();
    } catch (error) {
      console.error(`Failed to process campaign batch ${campaignId}:`, error);
      message.retry();
    }
  }
}


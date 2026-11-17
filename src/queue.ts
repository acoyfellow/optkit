import { claimSend, getCampaign, getSubscriberById, listSubscribers, markSend, updateCampaign, logEvent } from "./store";
import { sendMail } from "./mail";
import type { Env } from "./env";
import { makeUnsubscribeToken } from "./crypto";

export type CampaignMessage = {
  campaignId: string;
  subscriberId: string;
  accountId: string;
  listId: string;
};

export async function fanOutCampaign(env: Env, campaignId: string): Promise<number> {
  const campaign = await getCampaign(env.DB, campaignId);
  if (!campaign) return 0;
  let offset = 0;
  const pageSize = 500;
  let enqueued = 0;
  for (;;) {
    const { rows } = await listSubscribers(env.DB, campaign.account_id, campaign.list_id, "", "confirmed", pageSize, offset);
    if (rows.length === 0) break;
    for (const row of rows) {
      await env.CAMPAIGN_QUEUE.send({
        campaignId,
        subscriberId: row.id,
        accountId: campaign.account_id,
        listId: campaign.list_id,
      } satisfies CampaignMessage);
      enqueued += 1;
    }
    offset += rows.length;
    if (rows.length < pageSize) break;
  }
  await updateCampaign(env.DB, campaignId, { total: enqueued, status: "sending" });
  await logEvent(env.DB, campaign.account_id, "campaign.fanout", { campaignId, enqueued }, undefined, campaignId);
  return enqueued;
}

export async function consumeBatch(batch: MessageBatch<CampaignMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await deliver(message.body, env);
      message.ack();
    } catch (error) {
      const attempts = message.attempts ?? 0;
      if (attempts >= 2) {
        await env.CAMPAIGN_DLQ.send(message.body);
        await markSend(env.DB, message.body.campaignId, message.body.subscriberId, "failed", String(error));
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}

async function deliver(body: CampaignMessage, env: Env): Promise<void> {
  const claimed = await claimSend(env.DB, body.campaignId, body.subscriberId);
  const campaign = await getCampaign(env.DB, body.campaignId);
  const subscriber = await getSubscriberById(env.DB, body.subscriberId);
  if (!claimed || !campaign || !subscriber || subscriber.status !== "confirmed") {
    if (subscriber && subscriber.status !== "confirmed" && campaign) {
      await markSend(env.DB, body.campaignId, body.subscriberId, "failed", "not confirmed");
    }
    return;
  }
  const token = await makeUnsubscribeToken(env.SIGNING_SECRET, subscriber.id);
  const base = publicBase(env);
  const unsubscribeUrl = `${base}/api/unsubscribe?token=${token}`;
  const messageId = `${body.campaignId}-${body.subscriberId}@optkit.com`;
  const html = campaign.html
    .replaceAll("{{email}}", subscriber.email)
    .replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
  const text = campaign.text_body
    .replaceAll("{{email}}", subscriber.email)
    .replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
  try {
    await sendMail(
      env.SEND_EMAIL,
      {
        from: env.SENDER_EMAIL,
        fromName: env.FROM_NAME,
        to: subscriber.email,
        subject: campaign.subject,
        html,
        text,
        unsubscribeUrl,
        messageId,
        date: new Date(),
      },
      { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.EMAIL_API_TOKEN },
    );
    await markSend(env.DB, body.campaignId, body.subscriberId, "sent");
  } catch (error) {
    await markSend(env.DB, body.campaignId, body.subscriberId, "failed", String(error));
    throw error;
  }
}

function publicBase(env: Env): string {
  return "https://optkit.com";
}

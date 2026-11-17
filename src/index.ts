import app from "./app";
import type { Env } from "./env";

export default app;

export async function queue(
  batch: MessageBatch<{ campaignId: string; subscriberId: string; accountId: string; listId: string }>,
  env: Env,
): Promise<void> {
  const { consumeBatch } = await import("./queue");
  await consumeBatch(batch, env);
}

export async function email(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const { handleInbound } = await import("./inbox");
  await handleInbound(message, env);
}

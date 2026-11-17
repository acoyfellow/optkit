import { newId, nowIso } from "./store";
import type { Env } from "./env";

export async function handleInbound(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const raw = await new Response(message.raw).text();
  await env.DB.prepare(`INSERT INTO inbox_messages (id, raw, created_at) VALUES (?, ?, ?)`)
    .bind(newId(), raw, nowIso())
    .run();
  await env.INBOX_QUEUE.send({ messageId: newId(), to: message.to });
}

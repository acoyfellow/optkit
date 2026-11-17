import { buildRawMessage, type MailOptions } from "./mail";

export type EmailApiOptions = {
  accountId: string;
  token: string;
};

export async function sendMailViaApi(
  api: EmailApiOptions,
  options: MailOptions,
): Promise<void> {
  const raw = buildRawMessage(options);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${api.accountId}/email/sending/send_raw`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${api.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: options.from,
        to: options.to,
        raw,
      }),
    },
  );
  const body = (await response.json()) as { success?: boolean; errors?: Array<{ message?: string }> };
  if (!response.ok || body.success !== true) {
    throw new Error(`email send failed: ${body.errors?.map((error) => error.message).join(", ") || response.status}`);
  }
}

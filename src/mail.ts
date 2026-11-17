import { EmailMessage } from "cloudflare:email";

export type MailOptions = {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
  messageId: string;
  date: Date;
};

export function encodeQuotedPrintable(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let output = "";
  let lineLength = 0;
  for (const byte of bytes) {
    if (byte === 10) {
      output += "\r\n";
      lineLength = 0;
      continue;
    }
    if (byte === 13) continue;
    const isSafe =
      (byte >= 33 && byte <= 60) ||
      (byte >= 62 && byte <= 126) ||
      byte === 32 ||
      byte === 9;
    const escaped = isSafe ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    if (lineLength + escaped.length > 74) {
      output += "=\r\n";
      lineLength = 0;
    }
    output += escaped;
    lineLength += escaped.length;
  }
  return output;
}

export function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(value)));
  return `=?utf-8?b?${base64}?=`;
}

export function buildRawMessage(options: MailOptions): string {
  const boundary = `----optkit_${options.messageId.replace(/[^A-Za-z0-9]/g, "")}`;
  const textPart = encodeQuotedPrintable(options.text);
  const htmlPart = encodeQuotedPrintable(options.html);
  const headers = [
    `From: ${encodeHeaderValue(options.fromName)} <${options.from}>`,
    `To: ${options.to}`,
    `Subject: ${encodeHeaderValue(options.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `Message-ID: <${options.messageId}>`,
    `Date: ${options.date.toUTCString()}`,
    `List-Unsubscribe: <${options.unsubscribeUrl}>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
  ];
  return [
    ...headers,
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    "",
    textPart,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    "",
    htmlPart,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export async function sendMail(binding: SendEmail | undefined, options: MailOptions, api?: { accountId: string; token: string }): Promise<void> {
  if (binding) {
    const raw = buildRawMessage(options);
    const message = new EmailMessage(options.from, options.to, raw);
    await binding.send(message);
    return;
  }
  if (api) {
    const { sendMailViaApi } = await import("./mail-api");
    await sendMailViaApi(api, options);
    return;
  }
  throw new Error("no email delivery configured");
}

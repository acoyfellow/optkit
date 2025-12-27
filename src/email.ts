import { Effect } from "effect";
import { EmailMessage } from "cloudflare:email";
import type { OptKitConfig, EmailTemplate } from "./types";
import { EmailSendError } from "./errors";

function createMimeMessage(from: string, to: string, subject: string, html?: string, text?: string): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const parts: string[] = [];

  if (text) {
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: quoted-printable\r\n\r\n` +
      `${text}\r\n`
    );
  }

  if (html) {
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: quoted-printable\r\n\r\n` +
      `${html}\r\n`
    );
  }

  return [
    `From: ${from}\r\n`,
    `To: ${to}\r\n`,
    `Subject: ${subject}\r\n`,
    `MIME-Version: 1.0\r\n`,
    `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`,
    parts.join(''),
    `--${boundary}--\r\n`
  ].join('');
}

const defaultOptInTemplate = (email: string): EmailTemplate => ({
  subject: "Welcome!",
  html: `<p>Thanks for subscribing, ${email}!</p>`,
  text: `Thanks for subscribing, ${email}!`,
});

const defaultOptOutTemplate = (email: string): EmailTemplate => ({
  subject: "You've been unsubscribed",
  html: `<p>You've been unsubscribed from our newsletter.</p>`,
  text: `You've been unsubscribed from our newsletter.`,
});

const defaultNewSubscriberTemplate = (email: string): EmailTemplate => ({
  subject: "New subscriber",
  html: `<p>New subscriber: ${email}</p>`,
  text: `New subscriber: ${email}`,
});

export function sendOptInConfirmation(
  email: string,
  config: OptKitConfig
): Effect.Effect<void, EmailSendError> {
  const template = config.templates?.optIn || defaultOptInTemplate;
  const emailTemplate = template(email);
  return sendEmail(email, emailTemplate, config);
}

export function sendOptOutConfirmation(
  email: string,
  config: OptKitConfig
): Effect.Effect<void, EmailSendError> {
  const template = config.templates?.optOut || defaultOptOutTemplate;
  const emailTemplate = template(email);
  return sendEmail(email, emailTemplate, config);
}

export function sendNewSubscriberNotification(
  email: string,
  config: OptKitConfig
): Effect.Effect<void, EmailSendError> {
  if (!config.adminEmail) {
    return Effect.void;
  }

  const template = config.templates?.newSubscriber || defaultNewSubscriberTemplate;
  const emailTemplate = template(email);
  return sendEmail(config.adminEmail, emailTemplate, config);
}

function sendEmail(
  to: string,
  template: EmailTemplate,
  config: OptKitConfig
): Effect.Effect<void, EmailSendError> {
  if (!config.senderEmail) {
    return Effect.fail(new EmailSendError({
      email: to,
      cause: new Error("senderEmail is required in OptKitConfig")
    }));
  }

  return Effect.tryPromise({
    try: async () => {
      const raw = createMimeMessage(
        config.senderEmail!,
        to,
        template.subject,
        template.html,
        template.text
      );

      const emailMessage = new EmailMessage(
        config.senderEmail!,
        to,
        raw
      );

      await config.email.send(emailMessage);
    },
    catch: (error) => new EmailSendError({
      email: to,
      cause: error as Error
    })
  });
}

export function sendCampaignBatch(
  emails: string[],
  subject: string,
  html: string,
  config: OptKitConfig
): Effect.Effect<{ sent: number; failed: number }, EmailSendError> {
  if (!config.senderEmail) {
    return Effect.fail(new EmailSendError({
      email: emails[0] || "unknown",
      cause: new Error("senderEmail is required in OptKitConfig")
    }));
  }

  return Effect.gen(function* () {
    let sent = 0;
    let failed = 0;

    for (const email of emails) {
      const result = yield* Effect.either(
        Effect.tryPromise({
          try: async () => {
            const raw = createMimeMessage(
              config.senderEmail!,
              email,
              subject,
              html
            );

            const emailMessage = new EmailMessage(
              config.senderEmail!,
              email,
              raw
            );

            await config.email.send(emailMessage);
          },
          catch: (error) => new EmailSendError({
            email,
            cause: error as Error
          })
        })
      );

      if (result._tag === "Left") {
        failed++;
        console.error(`Failed to send email to ${email}:`, result.left);
      } else {
        sent++;
      }
    }

    return { sent, failed };
  });
}


import { Effect } from "effect";
import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";
import type { OptKitConfig, EmailTemplate } from "./types";
import { EmailSendError } from "./errors";

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

function buildMimeMessage(
  from: string,
  to: string,
  template: EmailTemplate,
  senderName?: string,
): string {
  const msg = createMimeMessage();
  msg.setSender({ name: senderName ?? from, addr: from });
  msg.setRecipient(to);
  msg.setSubject(template.subject);

  if (template.html) {
    msg.addMessage({ contentType: "text/html", data: template.html });
  }
  if (template.text) {
    msg.addMessage({ contentType: "text/plain", data: template.text });
  }

  return msg.asRaw();
}

export function sendOptInConfirmation(
  email: string,
  config: OptKitConfig
): Effect.Effect<void, EmailSendError> {
  const template = config.templates?.optIn || defaultOptInTemplate;
  return sendEmail(email, template(email), config);
}

export function sendOptOutConfirmation(
  email: string,
  config: OptKitConfig
): Effect.Effect<void, EmailSendError> {
  const template = config.templates?.optOut || defaultOptOutTemplate;
  return sendEmail(email, template(email), config);
}

export function sendNewSubscriberNotification(
  email: string,
  config: OptKitConfig
): Effect.Effect<void, EmailSendError> {
  if (!config.adminEmail) {
    return Effect.void;
  }
  const template = config.templates?.newSubscriber || defaultNewSubscriberTemplate;
  return sendEmail(config.adminEmail, template(email), config);
}

function sendEmail(
  to: string,
  template: EmailTemplate,
  config: OptKitConfig
): Effect.Effect<void, EmailSendError> {
  if (!config.email) {
    // Email binding not configured — skip silently
    return Effect.void;
  }

  if (!config.senderEmail) {
    return Effect.fail(new EmailSendError({
      email: to,
      cause: new Error("senderEmail is required when email binding is configured")
    }));
  }

  return Effect.tryPromise({
    try: async () => {
      const raw = buildMimeMessage(
        config.senderEmail!,
        to,
        template,
        config.senderName,
      );

      const emailMessage = new EmailMessage(
        config.senderEmail!,
        to,
        raw
      );

      await config.email!.send(emailMessage);
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
  if (!config.email) {
    return Effect.fail(new EmailSendError({
      email: emails[0] || "unknown",
      cause: new Error("email binding (send_email) is required for campaigns — see https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/")
    }));
  }

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
            const raw = buildMimeMessage(
              config.senderEmail!,
              email,
              { subject, html },
              config.senderName,
            );

            const emailMessage = new EmailMessage(
              config.senderEmail!,
              email,
              raw
            );

            await config.email!.send(emailMessage);
          },
          catch: (error) => new EmailSendError({
            email,
            cause: error as Error
          })
        })
      );

      if (result._tag === "Left") {
        failed++;
        console.error(`Failed to send to ${email}:`, result.left);
      } else {
        sent++;
      }
    }

    return { sent, failed };
  });
}

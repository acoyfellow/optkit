import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";
import type { OptKitConfig, EmailTemplate } from "./types";

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

export async function sendOptInConfirmation(
  email: string,
  config: OptKitConfig
): Promise<void> {
  const template = config.templates?.optIn || defaultOptInTemplate;
  const emailTemplate = template(email);
  await sendEmail(email, emailTemplate, config);
}

export async function sendOptOutConfirmation(
  email: string,
  config: OptKitConfig
): Promise<void> {
  const template = config.templates?.optOut || defaultOptOutTemplate;
  const emailTemplate = template(email);
  await sendEmail(email, emailTemplate, config);
}

export async function sendNewSubscriberNotification(
  email: string,
  config: OptKitConfig
): Promise<void> {
  if (!config.adminEmail) return;

  const template = config.templates?.newSubscriber || defaultNewSubscriberTemplate;
  const emailTemplate = template(email);
  await sendEmail(config.adminEmail, emailTemplate, config);
}

async function sendEmail(
  to: string,
  template: EmailTemplate,
  config: OptKitConfig
): Promise<void> {
  if (!config.senderEmail) {
    throw new Error("senderEmail is required in OptKitConfig");
  }

  const msg = createMimeMessage();
  msg.setSender({ addr: config.senderEmail });
  msg.setRecipient(to);
  msg.setSubject(template.subject);

  if (template.html) {
    msg.addMessage({
      contentType: "text/html",
      data: template.html,
    });
  }

  if (template.text) {
    msg.addMessage({
      contentType: "text/plain",
      data: template.text,
    });
  }

  const emailMessage = new EmailMessage(
    config.senderEmail,
    to,
    msg.asRaw()
  ) as any;

  await config.email.send(emailMessage);
}

export async function sendCampaignBatch(
  emails: string[],
  subject: string,
  html: string,
  config: OptKitConfig
): Promise<{ sent: number; failed: number }> {
  if (!config.senderEmail) {
    throw new Error("senderEmail is required in OptKitConfig");
  }

  let sent = 0;
  let failed = 0;

  for (const email of emails) {
    try {
      const msg = createMimeMessage();
      msg.setSender({ addr: config.senderEmail! });
      msg.setRecipient(email);
      msg.setSubject(subject);
      msg.addMessage({
        contentType: "text/html",
        data: html,
      });

      const emailMessage = new EmailMessage(
        config.senderEmail!,
        email,
        msg.asRaw()
      ) as any;

      await config.email.send(emailMessage);
      sent++;
    } catch (error) {
      failed++;
      console.error(`Failed to send email to ${email}:`, error);
    }
  }

  return { sent, failed };
}


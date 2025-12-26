import { EmailMessage } from "cloudflare:email";
import type { OptKitConfig, EmailTemplate } from "./types";

// Simple MIME message builder for Workers (no Node.js deps)
function createMimeMessage(from: string, to: string, subject: string, html: string, text?: string): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const date = new Date().toUTCString();
  
  let message = `From: ${from}\r\n`;
  message += `To: ${to}\r\n`;
  message += `Subject: ${subject}\r\n`;
  message += `Date: ${date}\r\n`;
  message += `MIME-Version: 1.0\r\n`;
  message += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
  message += `\r\n`;
  
  if (text) {
    message += `--${boundary}\r\n`;
    message += `Content-Type: text/plain; charset=utf-8\r\n`;
    message += `Content-Transfer-Encoding: 7bit\r\n`;
    message += `\r\n`;
    message += `${text}\r\n`;
    message += `\r\n`;
  }
  
  message += `--${boundary}\r\n`;
  message += `Content-Type: text/html; charset=utf-8\r\n`;
  message += `Content-Transfer-Encoding: 7bit\r\n`;
  message += `\r\n`;
  message += `${html}\r\n`;
  message += `\r\n`;
  message += `--${boundary}--\r\n`;
  
  return message;
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

  const raw = createMimeMessage(
    config.senderEmail,
    to,
    template.subject,
    template.html,
    template.text
  );

  const emailMessage = new EmailMessage(
    config.senderEmail,
    to,
    raw
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


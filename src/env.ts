export type Env = {
  DB: D1Database;
  CAMPAIGN_QUEUE: Queue;
  CAMPAIGN_DLQ: Queue;
  INBOX_QUEUE: Queue;
  SEND_EMAIL: SendEmail;
  SENDER_EMAIL: string;
  FROM_NAME: string;
  OWNER_PASSWORD_HASH: string;
  SESSION_SECRET: string;
  SIGNING_SECRET: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITEKEY?: string;
  TEST_INBOX_URL?: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  EMAIL_API_TOKEN: string;
};

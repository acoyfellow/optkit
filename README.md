# OptKit

**Email subscriber management powered by Cloudflare's [`send_email`](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/) binding. SQL-backed storage, queue-powered campaigns, built-in admin dashboard — zero external services.**

> Built on Cloudflare Workers, Durable Objects (SQL), Queues, and Email Routing.
> Everything runs on Cloudflare. No Mailgun. No SendGrid. No API keys to rotate.

```ts
import { optkit } from 'optkit';

const kit = optkit({
  do: env.SUBSCRIBERS_DO,
  queue: env.EMAIL_QUEUE,
  email: env.SEND_EMAIL,        // Cloudflare send_email binding
  senderEmail: 'hi@yourdomain.com',
  senderName: 'My Newsletter',
});

await kit.optIn('user@example.com');
await kit.sendCampaign({ subject: 'News', html: '<h1>Hello!</h1>' });
```

## Why OptKit

| Feature | OptKit | Typical SaaS |
|---------|--------|-------------|
| **Email sending** | Cloudflare `send_email` — no API keys | Third-party API + secrets |
| **Storage** | Durable Object SQL — colocated, fast | External DB or KV hacks |
| **Campaigns** | Queue-powered — 10K+ emails, no timeouts | Hope your function doesn't timeout |
| **Admin UI** | One-line Hono middleware | Build your own or pay for dashboards |
| **Cost** | Workers free tier gets you far | $20+/mo before you send anything |
| **Vendor lock** | It's just SQL + email. Portable. | Good luck migrating |

## Prerequisites

1. A Cloudflare account with [Email Routing](https://developers.cloudflare.com/email-routing/) enabled on your domain
2. A verified sender address (must be on a domain with Email Routing active)
3. Workers, Durable Objects, and Queues enabled

## Quick Start

### 1. Install

```bash
npm install optkit hono mimetext
```

### 2. Configure Wrangler

```jsonc
// wrangler.jsonc
{
  "name": "my-newsletter",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",

  "durable_objects": {
    "bindings": [
      { "name": "SUBSCRIBERS_DO", "class_name": "OptKitDO" }
    ]
  },

  "queues": {
    "producers": [
      { "binding": "EMAIL_QUEUE", "queue": "email-campaigns" }
    ],
    "consumers": [
      { "queue": "email-campaigns" }
    ]
  },

  // Cloudflare Email Routing — send_email binding
  // No restrictions = can send to any verified Email Routing address
  "send_email": [
    { "name": "SEND_EMAIL" }
  ],

  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["OptKitDO"] }
  ]
}
```

### 3. Wire it up

```ts
import { Hono } from 'hono';
import { optkit, OptKitDO, processCampaignBatch } from 'optkit';
import type { QueueMessage } from 'optkit';
import { adminUI } from 'optkit/admin';
import { basicAuth } from 'hono/basic-auth';

// Re-export the Durable Object class
export { OptKitDO };

interface Env {
  SUBSCRIBERS_DO: DurableObjectNamespace;
  EMAIL_QUEUE: Queue;
  SEND_EMAIL: { send(message: EmailMessage): Promise<void> };
  ADMIN_USER: string;
  ADMIN_PASS: string;
}

const app = new Hono<{ Bindings: Env }>();

app.post('/subscribe', async (c) => {
  const kit = optkit({
    do: c.env.SUBSCRIBERS_DO,
    queue: c.env.EMAIL_QUEUE,
    email: c.env.SEND_EMAIL,
    senderEmail: 'hi@yourdomain.com',
    senderName: 'My Newsletter',
  });

  const { email } = await c.req.json();
  const result = await Effect.runPromise(kit.optIn(email));
  return c.json(result);
});

// Admin dashboard — one line
const auth = basicAuth({ username: 'admin', password: 'secret' });
app.get('/admin', auth, adminUI);

export default {
  fetch: app.fetch,

  // Queue consumer — handles campaign email batches
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    await processCampaignBatch(batch, {
      do: env.SUBSCRIBERS_DO,
      queue: env.EMAIL_QUEUE,
      email: env.SEND_EMAIL,
      senderEmail: 'hi@yourdomain.com',
      senderName: 'My Newsletter',
    });
  },
};
```

## How Email Sending Works

OptKit uses Cloudflare's native [`send_email` binding](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/) — the same infrastructure that powers Email Routing. Your Worker sends email directly through Cloudflare's edge. No SMTP servers, no third-party APIs.

```
┌──────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────┐
│  optkit   │───▶│  Queue batch  │───▶│  send_email   │───▶│  Inbox   │
│ .sendCampaign  │  (50/batch)  │    │  (CF edge)    │    │          │
└──────────┘    └──────────────┘    └───────────────┘    └──────────┘
```

**Sender requirements:**
- The sender address must be on a domain where you have [Email Routing](https://developers.cloudflare.com/email-routing/) active
- For unrestricted sending, use a binding with no `destination_address` / `allowed_destination_addresses`
- For targeted use (e.g. admin notifications only), use `destination_address` to lock the binding

## API

```ts
const kit = optkit({
  do: env.SUBSCRIBERS_DO,
  queue: env.EMAIL_QUEUE,
  email: env.SEND_EMAIL,           // optional: Cloudflare send_email binding
  senderEmail: 'hi@yourdomain.com', // required if email binding is set
  senderName: 'My Newsletter',     // optional: display name in From header
  adminEmail: 'admin@yourdomain.com', // optional: get notified on new subs
});

// Subscribers
await Effect.runPromise(kit.optIn(email));
await Effect.runPromise(kit.optOut(email));
const sub = await Effect.runPromise(kit.get(email));
const list = await Effect.runPromise(kit.list({
  status: 'active',
  search: '@gmail',
  limit: 100,
}));

// Campaigns (queued, fault-tolerant)
const campaign = await Effect.runPromise(kit.sendCampaign({
  subject: 'Weekly Update',
  html: '<h1>Hi</h1>',
}));
const status = await Effect.runPromise(kit.getCampaign(campaign.id));
```

## Admin UI

### Built-in (recommended)

```ts
import { adminUI } from 'optkit/admin';
import { basicAuth } from 'hono/basic-auth';

app.get('/admin', basicAuth({ username: env.ADMIN_USER, password: env.ADMIN_PASS }), adminUI);
```

Full dashboard with search, filters, pagination. Tailwind-styled, server-rendered.

### BYO (bring your own)

Use the API directly from your own frontend:

```ts
const res = await fetch('/api/subscribers');
const { subscribers, total, active } = await res.json();
```

## Customize Templates

```ts
const kit = optkit({
  do: env.SUBSCRIBERS_DO,
  queue: env.EMAIL_QUEUE,
  email: env.SEND_EMAIL,
  senderEmail: 'hi@yourdomain.com',
  templates: {
    optIn: (email) => ({
      subject: 'Welcome!',
      html: `<p>Thanks ${email}!</p>`,
      text: `Thanks ${email}!`,
    }),
    optOut: (email) => ({
      subject: 'Goodbye',
      html: '<p>Unsubscribed.</p>',
    }),
    newSubscriber: (email) => ({
      subject: 'New sub!',
      html: `<p>${email} joined</p>`,
    }),
  },
});
```

## Without Email (Subscriber Management Only)

Don't need email sending? Skip the binding — OptKit works as a pure subscriber store:

```ts
const kit = optkit({
  do: env.SUBSCRIBERS_DO,
  queue: env.EMAIL_QUEUE,
  // no email binding — subscriber management only
});

await Effect.runPromise(kit.optIn('user@example.com'));
await Effect.runPromise(kit.list({ status: 'active' }));
```

## Architecture

- **Durable Object (SQL)** — Single global DO stores all subscribers and campaign state. SQLite under the hood. No external database.
- **Queues** — Campaign sends are batched (50 emails per message) and processed via Queue consumer. Automatic retries on failure.
- **Email Routing** — `send_email` binding sends through Cloudflare's edge. MIME messages built with [mimetext](https://www.npmjs.com/package/mimetext).
- **Effect** — All operations return `Effect` types with typed errors (`InvalidEmail`, `AlreadySubscribed`, `EmailSendError`, `DatabaseError`).

## Related

- [Cloudflare Email Routing — Send emails from Workers](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Durable Objects with SQL](https://developers.cloudflare.com/durable-objects/api/sql-storage/)

## License

MIT

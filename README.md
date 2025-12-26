# OptKit

**Newsletter subscribers for Cloudflare Workers. SQL-backed, queue-powered, RPC-first.**

[![npm](https://img.shields.io/npm/v/optkit)](https://www.npmjs.com/package/optkit)

```bash
npm install optkit
# or
bun add optkit
```

```ts
import { optkit } from 'optkit';
import { adminUI } from 'optkit/admin';

const kit = optkit({ do: env.SUBSCRIBERS_DO, queue: env.EMAIL_QUEUE });

await kit.optIn('user@example.com');
await kit.sendCampaign({ subject: 'News', html: '...' }); // 10K+ subscribers? Handled.

// One-line admin UI
app.get('/admin', authMiddleware, adminUI);
```

## Why

- **SQL-backed** - Durable Object SQL, not KV hacks
- **Queue-powered** - Email blasts don't timeout
- **RPC-first** - DO methods, not fetch() handlers
- **Admin included** - One line for a full dashboard

## Setup

```bash
npm install optkit hono
```

```ts
// alchemy.run.ts
import { OptKitDO } from 'optkit/do';

const SUBSCRIBERS_DO = DurableObjectNamespace('subscribers', {
  className: 'OptKitDO',
  sqlite: true,
});
```

## Admin UI

### Option 1: Built-in (recommended)

```ts
import { adminUI } from 'optkit/admin';
import { basicAuth } from 'hono/basic-auth';

const auth = basicAuth({ username: env.ADMIN_USER, password: env.ADMIN_PASS });

app.get('/admin', auth, adminUI);  // That's it
```

Visit `/admin` - full dashboard with search, filters, pagination.

### Option 2: BYO (bring your own)

Use the API directly from your own frontend:

```ts
// Your SvelteKit/Next/etc app
const res = await fetch('/api/subscribers', {
  headers: { Authorization: `Basic ${btoa('user:pass')}` }
});
const { subscribers, total, active } = await res.json();
```

## API

```ts
const kit = optkit({
  do: env.SUBSCRIBERS_DO,
  queue: env.EMAIL_QUEUE,
  email: env.SEND_EMAIL,        // optional: Cloudflare Email
  senderEmail: 'hi@you.com',    // optional: from address
  adminEmail: 'admin@you.com',  // optional: new subscriber alerts
});

// Subscribers
await kit.optIn(email);
await kit.optOut(email);
const sub = await kit.get(email);
const list = await kit.list({ status: 'active', search: '@gmail', limit: 100 });

// Campaigns (queued, fault-tolerant)
const campaign = await kit.sendCampaign({ subject: 'Weekly', html: '<h1>Hi</h1>' });
const status = await kit.getCampaign(campaign.id);
```

## Customize Templates

```ts
const kit = optkit({
  do: env.SUBSCRIBERS_DO,
  queue: env.EMAIL_QUEUE,
  templates: {
    optIn: (email) => ({ subject: 'Welcome!', html: `<p>Thanks ${email}!</p>` }),
    optOut: (email) => ({ subject: 'Goodbye', html: '<p>Unsubscribed.</p>' }),
    newSubscriber: (email) => ({ subject: 'New sub!', html: `<p>${email} joined</p>` }),
  },
});
```

MIT


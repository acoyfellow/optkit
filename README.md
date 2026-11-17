# optkit

Small, reliable email for your list, on Cloudflare.

## The pain

coey.dev kept subscribers in a Durable Object of a KV-era design. Campaigns were capped, unsubscribe was ad hoc, and sending was a log line away from silent failure. optkit is the extraction: D1 as the source of truth, queues for fan-out, Cloudflare Email Sending for delivery.

## The promise

One Worker runs subscribe, confirm, campaign, unsubscribe, dashboard, API, and MCP. Every user path is a prod test.

## Run it

```
bun install
bun run test          # unit
bunx vitest run
./typecheck.sh        # project-local tsc (TS 7)
npx alchemy deploy --profile personal
bun run test:prod     # gate, against prod
```

## How it works

D1 holds accounts, lists, subscribers, consents, campaigns, sends, events, and hashed API keys. A campaign queues one message per confirmed subscriber. The queue consumer delivers through `send_email`, with per-send idempotency on `(campaign_id, subscriber_id)`. A third attempt lands on the DLQ. Every message carries `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058) plus a signed one-click link.

## Auth

Owner dashboard: signed session cookie from an owner password hash. No default credentials. Auth fails closed when secrets are unset. API and MCP: scoped keys, stored hashed, `send_campaign` needs a single-use owner confirmation token. Picked over Cloudflare Access for the owner dashboard because this is one operator, not per-user billing, and it avoids an Access change during cutover; over Sign in with Cloudflare because there is no per-user cost to bill.

## What it deliberately does not do

No per-user inference. No host-pays-per-user compute. No Mailgun unless a gate proves `send_email` cannot do bulk.

## Known seams, said plainly

- Alchemy 0.87 cannot express the `send_email` binding: binding serialization hits an unsupported-type assertion. `scripts/patch-send-email.mjs` still asserts the binding and, while the binding is missing, `sendMail` falls back to the Email Sending REST API (`POST .../email/sending/send_raw`) with the same MIME. Sending fails loudly with no delivery channel, never silently. Emails leave from `newsletter@optkit.com` (subdomain enabled, DKIM/SPF/DMARC in DNS records that exist).
- Turnstile verifies when `TURNSTILE_SECRET` is set. Set it, or the embed form accepts without it.
- `bun.lock` and vendored packages reflect the registry footgun: `@cloudflare/*` must resolve to the public registry.

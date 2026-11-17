import alchemy from "alchemy";
import { D1Database, Queue, Worker } from "alchemy/cloudflare";
import { FileSystemStateStore } from "alchemy/state";

const projectName = "optkit";

const project = await alchemy(projectName, {
  password: process.env.ALCHEMY_PASSWORD!,
  stateStore: (scope) =>
    scope.local ? new FileSystemStateStore(scope) : new FileSystemStateStore(scope),
});

const isProduction = !project.stage || project.stage === "production" || project.stage === "runner";
const resourcePrefix = isProduction ? projectName : `${projectName}-${project.stage}`;

const DB = await D1Database(`${projectName}-db`, {
  name: `${projectName}-database`,
  migrationsDir: "migrations",
  adopt: true,
});

const CAMPAIGN_QUEUE = await Queue(`${projectName}-campaign-queue`, {
  name: `${projectName}-campaign-queue`,
  adopt: true,
});

const CAMPAIGN_DLQ = await Queue(`${projectName}-campaign-dlq`, {
  name: `${projectName}-campaign-dlq`,
  adopt: true,
});

const INBOX_QUEUE = await Queue(`${projectName}-inbox-queue`, {
  name: `${projectName}-inbox-queue`,
  adopt: true,
});

export const OPTKIT = await Worker(`${resourcePrefix}-worker`, {
  name: `${resourcePrefix}-worker`,
  entrypoint: "./src/index.ts",
  adopt: true,
  url: true,
  ...(isProduction ? { domains: ["optkit.com"] } : {}),
  bindings: {
    DB,
    CAMPAIGN_QUEUE,
    CAMPAIGN_DLQ,
    INBOX_QUEUE,
    SENDER_EMAIL: process.env.SENDER_EMAIL || "newsletter@optkit.com",
    FROM_NAME: "optkit",
    OWNER_PASSWORD_HASH: alchemy.secret(process.env.OWNER_PASSWORD_HASH || ""),
    SESSION_SECRET: alchemy.secret(process.env.SESSION_SECRET || ""),
    SIGNING_SECRET: alchemy.secret(process.env.SIGNING_SECRET || ""),
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_PERSONAL_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "",
    EMAIL_API_TOKEN: alchemy.secret(process.env.EMAIL_API_TOKEN || ""),
    TURNSTILE_SECRET: alchemy.secret(process.env.TURNSTILE_SECRET || ""),
    TURNSTILE_SITEKEY: process.env.TURNSTILE_SITEKEY || "",
    TEST_INBOX_URL: process.env.TEST_INBOX_URL || "",
  },
});

console.log({ url: OPTKIT.url });

await project.finalize();

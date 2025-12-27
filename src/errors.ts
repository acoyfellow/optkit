import { Schema } from "effect";

export class InvalidEmail extends Schema.TaggedError<InvalidEmail>()(
  "InvalidEmail",
  { email: Schema.String }
) { }

export class AlreadySubscribed extends Schema.TaggedError<AlreadySubscribed>()(
  "AlreadySubscribed",
  { email: Schema.String }
) { }

export class CampaignNotFound extends Schema.TaggedError<CampaignNotFound>()(
  "CampaignNotFound",
  { campaignId: Schema.String }
) { }

export class EmailSendError extends Schema.TaggedError<EmailSendError>()(
  "EmailSendError",
  {
    email: Schema.String,
    cause: Schema.optional(Schema.Defect)
  }
) { }

export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
  "DatabaseError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect)
  }
) { }


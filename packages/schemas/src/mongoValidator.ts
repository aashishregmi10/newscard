/**
 * MongoDB $jsonSchema validators.  Spec Ch. 3.14.
 *
 * MongoDB is permissive by default, which is a liability at speed. Every
 * collection carries a validator with validationAction: "error" so an invalid
 * write fails loudly, rather than producing a card that renders as a blank
 * rectangle three days later.
 *
 * These are written out explicitly rather than machine-generated from Zod. A
 * generic converter has to handle refinements, defaults, and unions it cannot
 * express in $jsonSchema, and the failure mode is a validator that silently
 * accepts everything. Explicit is longer and correct; `scripts/check-schema-drift.ts`
 * asserts the required-key lists here match the Zod objects.
 */

export interface MongoValidator {
  readonly $jsonSchema: Record<string, unknown>;
}

export const articleValidator: MongoValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'slug',
      'status',
      'language',
      'categoryId',
      'sourceId',
      'headline',
      'summary',
      'summaryWordCount',
      'summaryCharCount',
      'publisherUrl',
      'sourceName',
      'categorySlug',
      'categoryLabel',
      'authoredBy',
      'draftSource',
    ],
    properties: {
      slug: { bsonType: 'string', pattern: '^[a-z0-9-]{8,120}$' },
      status: {
        enum: ['draft', 'in_review', 'approved', 'scheduled', 'published', 'spiked', 'retracted'],
      },
      language: { enum: ['ne', 'en'] },
      headline: { bsonType: 'string', minLength: 10, maxLength: 90 },
      // Safety rail, NOT the editorial limit. The real limit is in
      // config.summaryLimits because Gate 2 may change it.
      summary: { bsonType: 'string', minLength: 40, maxLength: 1200 },
      publisherUrl: { bsonType: 'string', pattern: '^https://' },
      draftSource: { enum: ['human', 'llm_assisted'] },
      image: {
        bsonType: ['object', 'null'],
        required: ['credit', 'licence'],
        properties: {
          credit: { bsonType: 'string', minLength: 1 },
          // An unrecognised licence must never be publishable.
          licence: { enum: ['publisher_licensed', 'agency', 'cc_by', 'own'] },
        },
      },
    },
  },
};

export const sourceValidator: MongoValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['slug', 'displayName', 'homepageUrl', 'language', 'licence', 'ingest', 'isActive'],
    properties: {
      slug: { bsonType: 'string', pattern: '^[a-z0-9-]{2,64}$' },
      language: { enum: ['ne', 'en'] },
      licence: {
        bsonType: 'object',
        required: ['status'],
        properties: { status: { enum: ['agreed', 'pending', 'refused', 'unknown'] } },
      },
      ingest: {
        bsonType: 'object',
        required: ['method', 'pollIntervalMin'],
        properties: {
          method: { enum: ['rss', 'api', 'manual'] },
          // Politeness clamp lives in code AND here, so a direct database edit
          // cannot configure a 1-minute poll against a publisher.
          pollIntervalMin: { bsonType: 'int', minimum: 5 },
        },
      },
    },
  },
};

export const categoryValidator: MongoValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['slug', 'label', 'order', 'isActive'],
    properties: {
      slug: { bsonType: 'string', pattern: '^[a-z0-9-]{2,32}$' },
      label: {
        bsonType: 'object',
        required: ['ne', 'en'],
        properties: { ne: { bsonType: 'string' }, en: { bsonType: 'string' } },
      },
    },
  },
};

export const deviceValidator: MongoValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['deviceId', 'tokenHash', 'platform', 'appVersion', 'langPrefs', 'notif', 'lastSeenAt'],
    properties: {
      platform: { enum: ['android', 'ios'] },
      tokenHash: { bsonType: 'string', minLength: 64, maxLength: 64 },
      notif: {
        bsonType: 'object',
        required: ['enabled', 'channels', 'dailyCap', 'sentToday'],
        properties: {
          // The ceiling is a product decision expressed in the database, so it
          // holds even against a direct write.
          dailyCap: { bsonType: 'int', minimum: 0, maximum: 3 },
          sentToday: { bsonType: 'int', minimum: 0 },
        },
      },
    },
  },
};

export const staffValidator: MongoValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['email', 'name', 'role', 'languages', 'isActive', 'passwordHash'],
    properties: {
      role: { enum: ['author', 'reviewer', 'admin'] },
      languages: { bsonType: 'array', minItems: 1, items: { enum: ['ne', 'en'] } },
    },
  },
};

export const COLLECTION_VALIDATORS = {
  articles: articleValidator,
  sources: sourceValidator,
  categories: categoryValidator,
  devices: deviceValidator,
  staff: staffValidator,
} as const;

export type CollectionName = keyof typeof COLLECTION_VALIDATORS;

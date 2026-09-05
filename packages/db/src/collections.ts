import type { Collection, Db, ObjectId } from 'mongodb';
import type {
  Article,
  Category,
  Device,
  Notification,
  ReadEvent,
  Source,
  Staff,
  AuditRecord,
  AppConfig,
} from '@newscard/schemas';

/**
 * Typed collection accessors.
 *
 * The Zod types describe the API/domain shape, where ids are hex strings. In
 * MongoDB the same fields are ObjectId, so the document types below swap those
 * fields rather than pretending the two are identical — which is exactly the
 * kind of quiet mismatch that produces a query matching nothing.
 */

/**
 * Every document carries _id and timestamps (Ch. 3.1). They are omitted from the
 * Zod objects to avoid repeating them in nine schemas, so they are added back
 * here — otherwise consumers see them as missing and reach for `any`.
 */
type WithId<T> = T & { _id: ObjectId; createdAt: Date; updatedAt: Date };
type IdFieldsAsObjectId<T, K extends keyof T> = Omit<T, K> & { [P in K]: ObjectId };

/**
 * `reviewedBy` and `clusterId` are Omitted before being re-added as ObjectId.
 * Intersecting instead of omitting would produce `string & ObjectId`, a type
 * nothing can satisfy — and the resulting error appears far from its cause.
 */
export type ArticleDoc = WithId<
  Omit<
    IdFieldsAsObjectId<Article, 'categoryId' | 'sourceId' | 'authoredBy'>,
    'reviewedBy' | 'clusterId'
  > & {
    reviewedBy: ObjectId | null;
    clusterId: ObjectId | null;
  }
>;
export type SourceDoc = WithId<Source>;
export type CategoryDoc = WithId<Category>;
export type DeviceDoc = WithId<Device>;
export type StaffDoc = WithId<Staff>;
export type NotificationDoc = WithId<
  Omit<Notification, 'articleId' | 'createdBy'> & {
    articleId: ObjectId | null;
    createdBy: ObjectId | null;
  }
>;
export type ReadEventDoc = WithId<Omit<ReadEvent, 'articleId'> & { articleId: ObjectId }>;
export type AuditDoc = WithId<AuditRecord>;
export type ConfigDoc = WithId<AppConfig & { _key: 'singleton' }>;

export interface Collections {
  articles: Collection<ArticleDoc>;
  sources: Collection<SourceDoc>;
  categories: Collection<CategoryDoc>;
  devices: Collection<DeviceDoc>;
  staff: Collection<StaffDoc>;
  notifications: Collection<NotificationDoc>;
  readEvents: Collection<ReadEventDoc>;
  audit: Collection<AuditDoc>;
  config: Collection<ConfigDoc>;
}

export function collections(db: Db): Collections {
  return {
    articles: db.collection<ArticleDoc>('articles'),
    sources: db.collection<SourceDoc>('sources'),
    categories: db.collection<CategoryDoc>('categories'),
    devices: db.collection<DeviceDoc>('devices'),
    staff: db.collection<StaffDoc>('staff'),
    notifications: db.collection<NotificationDoc>('notifications'),
    readEvents: db.collection<ReadEventDoc>('readEvents'),
    audit: db.collection<AuditDoc>('audit'),
    config: db.collection<ConfigDoc>('config'),
  };
}

export const COLLECTION_NAMES = [
  'articles',
  'sources',
  'categories',
  'devices',
  'staff',
  'notifications',
  'readEvents',
  'audit',
  'config',
  'bookmarks',
] as const;

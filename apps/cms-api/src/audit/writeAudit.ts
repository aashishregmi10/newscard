import { collections, getDb } from '@newscard/db';

/**
 * Append-only audit trail.  Spec Ch. 5.8.
 *
 * There is deliberately no update and no delete path in this module. Every state
 * transition, every change to a published article, and every permission change
 * writes one record and it stays written.
 *
 * `actorEmail` is denormalised so the trail stays readable after an account is
 * deactivated — which is why staff are deactivated rather than deleted.
 */

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorEmail: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await collections(getDb()).audit.insertOne({
      ...input,
      at: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  } catch (e) {
    // Never let an audit failure roll back or fail the action it describes.
    // A missing audit line is bad; a publish that fails because logging broke
    // is worse, and the error is visible in the logs either way.
    console.error('audit write failed', { action: input.action, entityId: input.entityId }, e);
  }
}

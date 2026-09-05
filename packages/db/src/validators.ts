import type { Db } from 'mongodb';
import { COLLECTION_VALIDATORS } from '@newscard/schemas';

/**
 * Apply the $jsonSchema validators.  Spec Ch. 3.14.
 *
 * MongoDB is permissive by default, which is a liability at speed. With
 * validationAction: "error" an invalid write fails loudly at the point of the
 * bug, rather than producing a card that renders as a blank rectangle three days
 * later with no obvious cause.
 */

export interface ValidatorResult {
  collection: string;
  action: 'created' | 'updated';
}

export async function applyValidators(db: Db): Promise<ValidatorResult[]> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const results: ValidatorResult[] = [];

  for (const [name, validator] of Object.entries(COLLECTION_VALIDATORS)) {
    if (existing.has(name)) {
      // collMod updates the validator on a collection that already holds data.
      await db.command({
        collMod: name,
        validator,
        validationAction: 'error',
        validationLevel: 'strict',
      });
      results.push({ collection: name, action: 'updated' });
    } else {
      await db.createCollection(name, {
        validator,
        validationAction: 'error',
        validationLevel: 'strict',
      });
      results.push({ collection: name, action: 'created' });
    }
  }

  return results;
}

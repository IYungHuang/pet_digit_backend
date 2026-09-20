import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type IndexDefinition = {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order: string }>;
};

describe('production Firestore indexes', () => {
  it('declares only composite indexes required by Firestore', () => {
    const config = JSON.parse(
      readFileSync(resolve(__dirname, '../../firestore.indexes.json'), 'utf8'),
    ) as { indexes: IndexDefinition[] };

    expect(config.indexes).toEqual([
      {
        collectionGroup: 'clientRequests',
        queryScope: 'COLLECTION_GROUP',
        fields: [
          { fieldPath: 'state', order: 'ASCENDING' },
          { fieldPath: 'leaseUntil', order: 'ASCENDING' },
          { fieldPath: '__name__', order: 'ASCENDING' },
        ],
      },
    ]);
  });
});

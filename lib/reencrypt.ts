import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { currentKeyId, decryptCredentials, encryptCredentials } from '@/lib/crypto';
/** One transaction: corrupt ciphertext/missing read keys roll back every update. No plaintext logs. */
export async function reencrypt() {
  const prefix = 'v1:' + currentKeyId() + ':';
  return getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('socialmint-reencrypt',0))`);
    let count = 0;
    // Static identifiers only. Row locks serialize with refresh/disconnect/other rotations.
    for (const [table, pk, column] of [
      ['channels','id','credentials_enc'], ['webhook_endpoints','id','secret_enc'], ['oauth_states','state','code_verifier'],
    ]) {
      const rows = await tx.execute(sql`select ${sql.identifier(pk)} as id, ${sql.identifier(column)} as value from ${sql.identifier(table)} where ${sql.identifier(column)} <> '' for update`);
      for (const row of rows) {
        const old = String(row.value);
        const plain = decryptCredentials(old); // Validate even already-current records.
        if (old.startsWith(prefix)) continue;
        await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${encryptCredentials(plain)} where ${sql.identifier(pk)} = ${row.id}`);
        count++;
      }
    }
    return {count};
  });
}

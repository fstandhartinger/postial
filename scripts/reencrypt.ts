import { reencrypt } from '../lib/reencrypt';
reencrypt().then(result => { console.log('Re-encryption complete', result); process.exit(0); })
  .catch(() => { console.error('Re-encryption failed; transaction rolled back. Check read keys and ciphertext integrity.'); process.exit(1); });

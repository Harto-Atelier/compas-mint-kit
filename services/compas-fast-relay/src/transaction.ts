import { keccak256, Transaction } from 'ethers';

export interface BroadcastTransaction {
  rawTx: string;
  expectedHash: string;
  routeIds?: string[];
}

const HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const HEX_RE = /^0x(?:[a-fA-F0-9]{2})+$/;

export function validateSignedRawTransaction(rawTx: unknown): string {
  if (typeof rawTx !== 'string' || !HEX_RE.test(rawTx)) {
    throw new Error('rawTx must be a 0x-prefixed hex string of signed transaction bytes');
  }
  let tx: Transaction;
  try {
    tx = Transaction.from(rawTx);
  } catch {
    throw new Error('rawTx must parse as a signed Ethereum transaction');
  }
  if (!tx.signature) {
    throw new Error('rawTx must be an already-signed transaction');
  }
  return rawTx;
}

export function validateExpectedHash(rawTx: string, expectedHash: unknown): string {
  if (typeof expectedHash !== 'string' || !HASH_RE.test(expectedHash)) {
    throw new Error('expectedHash must be a 32-byte 0x-prefixed transaction hash');
  }
  const computed = keccak256(rawTx);
  if (computed.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error('expectedHash does not match computed raw transaction hash');
  }
  return computed;
}

export function assertNoSigningMaterial(value: unknown): void {
  scanForSigningMaterial(value, '$');
}

function scanForSigningMaterial(value: unknown, path: string): void {
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSigningMaterial(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (/privatekey|secretkey|seedphrase|mnemonic|signingkey/i.test(key)) {
      throw new Error(`payload contains forbidden signing material at ${path}.${key}`);
    }
    scanForSigningMaterial(nested, `${path}.${key}`);
  }
}

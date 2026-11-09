/** Recent retry protection, bounded independently for each browser identity. */
export const RECEIPT_LIMIT = 64;
export interface Receipt {
  requestId: string;
  signature: string;
  response: Record<string, unknown>;
}

export function rememberReceipt(receipts: Receipt[], receipt: Receipt): Receipt[] {
  return [...receipts.slice(-(RECEIPT_LIMIT - 1)), receipt];
}

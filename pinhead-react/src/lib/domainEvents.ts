// redesign/v2 — domain events producer (ADR-0004)
//
// Thin helper that inserts into the domain_events outbox. Callers must
// wrap the business write and this call in the same logical flow — the
// true transactional guarantee lives in a server-side RPC, but for MVP
// we accept a tiny window where the business row is committed but the
// event is not. Consumer dedupe via idempotency_key covers replays.
//
// Uses app-generated idempotency_key so retries on network flakiness
// don't double-fire. Key format: <event_type>:<aggregate_id>:<suffix>.

import { supabase } from './supabase';

export interface EmitEventInput {
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload?: Record<string, unknown>;
  idempotency_suffix?: string;
}

export async function emitDomainEvent(input: EmitEventInput): Promise<void> {
  const { event_type, aggregate_type, aggregate_id, payload = {}, idempotency_suffix } = input;

  const idempotency_key = idempotency_suffix
    ? `${event_type}:${aggregate_id}:${idempotency_suffix}`
    : null;

  try {
    const { error } = await supabase.from('domain_events').insert({
      event_type,
      aggregate_type,
      aggregate_id,
      payload,
      idempotency_key,
    });
    if (error && import.meta.env?.DEV) {
      console.warn('[domainEvents] emit failed:', error.message);
    }
  } catch (err) {
    // Event emission is best-effort from the client. Business rows are
    // already committed by this point, so we log and move on.
    if (import.meta.env?.DEV) console.warn('[domainEvents] emit threw:', err);
  }
}

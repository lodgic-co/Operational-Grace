/**
 * OG outbound domain event publishing (Phase 1).
 *
 * Publishes domain events to SC's HTTP ingest endpoint after a transaction commits.
 * Transport-neutral at the interface level; HTTP POST is the Phase 1 delivery mechanism.
 *
 * Must only be called after the owning transaction has committed.
 * Fire-and-forget with local catch: event delivery failure must not fail the mutation response.
 */

export interface ScIngestEndpointConfig {
  scIngestUrl: string;
  scIngestSecret: string;
}

interface ScIngestBody {
  source_event_id: string;
  source_service: 'operational-grace';
  event_type: string;
  organisation_uuid: string;
  property_uuid: string;
  mode: string;
  aot_uuid?: string | null;
  effective_from_date?: string | null;
  effective_to_date?: string | null;
  payload: Record<string, unknown>;
}

async function postToScIngest(
  cfg: ScIngestEndpointConfig,
  body: ScIngestBody,
): Promise<void> {
  const response = await fetch(cfg.scIngestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sc-ingest-secret': cfg.scIngestSecret,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`SC ingest returned ${response.status}`);
  }
}

// ─── ReservationStayEventPayload ──────────────────────────────────────────────

export interface StayEventInput {
  aot_uuid: string;
  effective_from_date: string;
  effective_to_date: string;
}

export interface PublishReservationCreatedInput {
  reservationUuid: string;
  organisationUuid: string;
  propertyUuid: string;
  mode: string;
  stays: StayEventInput[];
  cfg: ScIngestEndpointConfig;
}

/**
 * Publishes one event per unique (aot_uuid, effective_from_date, effective_to_date)
 * tuple in the reservation stays.
 *
 * source_event_id is deterministic: `reservation_created:{reservationUuid}:{aotUuid}`.
 * Idempotent on re-delivery due to SC's ingest uniqueness constraint.
 */
export async function PublishReservationCreated(
  input: PublishReservationCreatedInput,
): Promise<void> {
  const { reservationUuid, organisationUuid, propertyUuid, mode, stays, cfg } = input;

  const seen = new Map<string, StayEventInput>();
  for (const stay of stays) {
    const key = stay.aot_uuid;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, stay);
    } else {
      const from = existing.effective_from_date < stay.effective_from_date
        ? existing.effective_from_date
        : stay.effective_from_date;
      const to = existing.effective_to_date > stay.effective_to_date
        ? existing.effective_to_date
        : stay.effective_to_date;
      seen.set(key, { aot_uuid: stay.aot_uuid, effective_from_date: from, effective_to_date: to });
    }
  }

  const publishes = [...seen.values()].map((stay) =>
    postToScIngest(cfg, {
      source_event_id: `reservation_created:${reservationUuid}:${stay.aot_uuid}`,
      source_service: 'operational-grace',
      event_type: 'reservation_created',
      organisation_uuid: organisationUuid,
      property_uuid: propertyUuid,
      mode,
      aot_uuid: stay.aot_uuid,
      effective_from_date: stay.effective_from_date,
      effective_to_date: stay.effective_to_date,
      payload: { reservation_uuid: reservationUuid },
    }).catch((err: unknown) => {
      console.error('[og-events] reservation_created publish failed (non-fatal)', { reservationUuid, aot_uuid: stay.aot_uuid, err });
    }),
  );

  await Promise.allSettled(publishes);
}

// ─── PublishHoldCreated ───────────────────────────────────────────────────────

export interface PublishHoldCreatedInput {
  holdUuid: string;
  organisationUuid: string;
  propertyUuid: string;
  mode: string;
  aotUuid: string;
  effectiveFromDate: string;
  effectiveToDate: string;
  cfg: ScIngestEndpointConfig;
}

/**
 * Publishes a hold_created event.
 * source_event_id is deterministic: `hold_created:{holdUuid}`.
 */
export async function PublishHoldCreated(
  input: PublishHoldCreatedInput,
): Promise<void> {
  const { holdUuid, organisationUuid, propertyUuid, mode, aotUuid, effectiveFromDate, effectiveToDate, cfg } = input;

  await postToScIngest(cfg, {
    source_event_id: `hold_created:${holdUuid}`,
    source_service: 'operational-grace',
    event_type: 'hold_created',
    organisation_uuid: organisationUuid,
    property_uuid: propertyUuid,
    mode,
    aot_uuid: aotUuid,
    effective_from_date: effectiveFromDate,
    effective_to_date: effectiveToDate,
    payload: { hold_uuid: holdUuid },
  }).catch((err: unknown) => {
    console.error('[og-events] hold_created publish failed (non-fatal)', { holdUuid, err });
  });
}

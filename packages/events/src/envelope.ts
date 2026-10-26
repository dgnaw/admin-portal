import { randomUUID } from 'node:crypto';
import type { TopicName } from './topics';

export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  tenantId: string;
  productCode: string;
  actorType: 'user' | 'service' | 'system';
  actorId: string;
  payload: T;
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

export interface BuildEnvelopeInput<T> {
  eventType: string;
  tenantId: string;
  productCode?: string;
  actorType: EventEnvelope['actorType'];
  actorId: string;
  payload: T;
  occurredAt?: Date;
}

export function productCodeFromTenantId(tenantId: string, separator = '_'): string {
  const idx = tenantId.indexOf(separator);
  if (idx <= 0) {
    throw new EnvelopeError(`tenant_id khong hop le: "${tenantId}" (can dang <SanPham>${separator}<Tenant>)`);
  }
  return tenantId.slice(0, idx);
}

export function buildEnvelope<T>(input: BuildEnvelopeInput<T>): EventEnvelope<T> {
  if (!input.tenantId) {
    throw new EnvelopeError('Moi su kien bat buoc mang tenant_id (ADR-21)');
  }
  if (!input.actorId) {
    throw new EnvelopeError('Moi su kien bat buoc mang actor (ADR-8)');
  }
  const productCode = input.productCode ?? productCodeFromTenantId(input.tenantId);
  if (!productCode) {
    throw new EnvelopeError('Moi su kien bat buoc mang ma San pham (ADR-21)');
  }
  return {
    eventId: randomUUID(),
    eventType: input.eventType,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    tenantId: input.tenantId,
    productCode,
    actorType: input.actorType,
    actorId: input.actorId,
    payload: input.payload,
  };
}

export function assertEnvelope(value: unknown): asserts value is EventEnvelope {
  const e = value as Partial<EventEnvelope> | null;
  for (const field of ['eventId', 'eventType', 'occurredAt', 'tenantId', 'productCode', 'actorId'] as const) {
    if (!e || typeof e[field] !== 'string' || !e[field]) {
      throw new EnvelopeError(`Su kien thieu truong bat buoc: ${field}`);
    }
  }
}

export function partitionKeyOf(envelope: EventEnvelope): string {
  return envelope.tenantId;
}

export type { TopicName };

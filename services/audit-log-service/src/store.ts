import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import type { EventEnvelope } from '@platform/events';
import { config } from './config';

const pool = new Pool({ connectionString: config.databaseUrl });

export interface AuditQuery {
  tenantId?: string;
  actorId?: string;
  eventType?: string;
  limit?: number;
}

@Injectable()
export class AuditStore {
  async record(envelope: EventEnvelope): Promise<boolean> {
    const res = await pool.query(
      `INSERT INTO audit_events
         (event_id, event_type, occurred_at, tenant_id, product_code, actor_type, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        envelope.eventId, envelope.eventType, envelope.occurredAt, envelope.tenantId,
        envelope.productCode, envelope.actorType, envelope.actorId,
        JSON.stringify(envelope.payload ?? {}),
      ],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async search(q: AuditQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.tenantId) add('tenant_id = ?', q.tenantId);
    if (q.actorId) add('actor_id = ?', q.actorId);
    if (q.eventType) add('event_type = ?', q.eventType);
    params.push(Math.min(q.limit ?? 100, 500));

    const res = await pool.query(
      `SELECT event_id, event_type, occurred_at, recorded_at, tenant_id, product_code,
              actor_type, actor_id, payload
         FROM audit_events
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY occurred_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  async close() {
    await pool.end();
  }
}

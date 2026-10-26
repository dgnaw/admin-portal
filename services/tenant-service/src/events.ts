import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TOPICS, buildEnvelope, createProducer, ensureTopics, type EventProducer } from '@platform/events';
import { config } from './config';

export interface ActorContext {
  actorType: 'user' | 'service' | 'system';
  actorId: string;
}

@Injectable()
export class EventBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventBus.name);
  private producer: EventProducer | null = null;

  async onModuleInit() {
    const options = { brokers: config.kafkaBrokers, clientId: 'tenant-service' };
    const created = await ensureTopics(options);
    if (created.length) this.logger.log(`tao topic: ${created.join(', ')}`);
    this.producer = createProducer(options);
    await this.producer.connect();
  }

  async onModuleDestroy() {
    await this.producer?.disconnect();
  }

  async configUpdated(tenantId: string, actor: ActorContext, payload: Record<string, unknown>) {
    await this.producer?.publish(
      TOPICS.tenantConfigUpdated,
      buildEnvelope({ eventType: 'tenant.config.updated', tenantId, ...actor, payload }),
    );
  }

  async audit(tenantId: string, actor: ActorContext, action: string, payload: Record<string, unknown>) {
    await this.producer?.publish(
      TOPICS.auditActivityRecorded,
      buildEnvelope({ eventType: action, tenantId, ...actor, payload }),
    );
  }
}

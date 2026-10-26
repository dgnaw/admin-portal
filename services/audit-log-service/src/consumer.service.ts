import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TOPICS, createConsumer, ensureTopics, type EventConsumer } from '@platform/events';
import { config } from './config';
import { AuditStore } from './store';

@Injectable()
export class AuditConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditConsumer.name);
  private consumer: EventConsumer | null = null;

  constructor(@Inject(AuditStore) private readonly store: AuditStore) {}

  async onModuleInit() {
    const base = { brokers: config.kafkaBrokers, clientId: 'audit-log-service' };
    await ensureTopics(base);
    this.consumer = createConsumer({
      ...base,
      groupId: config.groupId,
      topics: [TOPICS.auditActivityRecorded],
      onInvalid: (raw, err) => this.logger.warn(`bo qua su kien khong hop le: ${err.message} | ${raw}`),
    });
    await this.consumer.start(async (envelope) => {
      const inserted = await this.store.record(envelope);
      if (!inserted) this.logger.debug(`su kien trung, bo qua: ${envelope.eventId}`);
    });
    this.logger.log(`dang lang nghe ${TOPICS.auditActivityRecorded}`);
  }

  async onModuleDestroy() {
    await this.consumer?.stop();
  }
}

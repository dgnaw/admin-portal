import { type EachMessagePayload } from 'kafkajs';
import { assertEnvelope, type EventEnvelope } from './envelope';
import { createKafka, type KafkaOptions } from './producer';
import type { TopicName } from './topics';

export interface ConsumerOptions extends KafkaOptions {
  groupId: string;
  topics: TopicName[];
  fromBeginning?: boolean;
  onInvalid?: (raw: string | undefined, error: Error) => void;
}

export interface EventConsumer {
  start(handler: (envelope: EventEnvelope, meta: EachMessagePayload) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

export function createConsumer(options: ConsumerOptions): EventConsumer {
  const consumer = createKafka(options).consumer({ groupId: options.groupId });

  return {
    async start(handler) {
      await consumer.connect();
      for (const topic of options.topics) {
        await consumer.subscribe({ topic, fromBeginning: options.fromBeginning ?? true });
      }
      await consumer.run({
        eachMessage: async (payload) => {
          const raw = payload.message.value?.toString();
          let envelope: EventEnvelope;
          try {
            envelope = JSON.parse(raw ?? '');
            assertEnvelope(envelope);
          } catch (err) {
            options.onInvalid?.(raw, err as Error);
            return;
          }
          await handler(envelope, payload);
        },
      });
    },
    async stop() {
      await consumer.disconnect();
    },
  };
}

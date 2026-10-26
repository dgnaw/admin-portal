import { Kafka, Partitioners, logLevel, type Producer } from 'kafkajs';
import { assertEnvelope, partitionKeyOf, type EventEnvelope } from './envelope';
import { ALL_TOPICS, TOPIC_CONFIG, type TopicName } from './topics';

export interface KafkaOptions {
  brokers: string[];
  clientId: string;
  logLevel?: logLevel;
}

export interface EventProducer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(topic: TopicName, envelope: EventEnvelope): Promise<void>;
}

export function createKafka(options: KafkaOptions): Kafka {
  return new Kafka({
    clientId: options.clientId,
    brokers: options.brokers,
    logLevel: options.logLevel ?? logLevel.ERROR,
  });
}

export function createProducer(options: KafkaOptions): EventProducer {
  const kafka = createKafka(options);
  let producer: Producer | null = null;

  return {
    async connect() {
      producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
      await producer.connect();
    },
    async disconnect() {
      await producer?.disconnect();
      producer = null;
    },
    async publish(topic, envelope) {
      if (!producer) throw new Error('@platform/events: producer chua connect()');
      assertEnvelope(envelope);
      await producer.send({
        topic,
        messages: [{ key: partitionKeyOf(envelope), value: JSON.stringify(envelope) }],
      });
    },
  };
}

export async function ensureTopics(options: KafkaOptions): Promise<string[]> {
  const admin = createKafka(options).admin();
  await admin.connect();
  try {
    const existing = new Set(await admin.listTopics());
    const missing = ALL_TOPICS.filter((t) => !existing.has(t));
    if (missing.length) {
      await admin.createTopics({
        waitForLeaders: true,
        topics: missing.map((topic) => ({
          topic,
          numPartitions: TOPIC_CONFIG[topic].partitions,
          replicationFactor: 1,
          configEntries: [
            { name: 'retention.ms', value: String(TOPIC_CONFIG[topic].retentionMs) },
          ],
        })),
      });
    }
    return missing;
  } finally {
    await admin.disconnect();
  }
}

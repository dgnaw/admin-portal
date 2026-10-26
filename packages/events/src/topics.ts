export const TOPICS = {
  tenantConfigUpdated: 'tenant.config.updated',
  auditActivityRecorded: 'audit.activity.recorded',
  subscriptionUsageReported: 'subscription.usage.reported',
  subscriptionQuotaUpdated: 'subscription.quota.updated',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

export const ALL_TOPICS: TopicName[] = Object.values(TOPICS);

export const TOPIC_CONFIG: Record<TopicName, { partitions: number; retentionMs: number }> = {
  [TOPICS.tenantConfigUpdated]: { partitions: 6, retentionMs: 7 * 24 * 3600 * 1000 },
  [TOPICS.auditActivityRecorded]: { partitions: 6, retentionMs: 30 * 24 * 3600 * 1000 },
  [TOPICS.subscriptionUsageReported]: { partitions: 12, retentionMs: 7 * 24 * 3600 * 1000 },
  [TOPICS.subscriptionQuotaUpdated]: { partitions: 6, retentionMs: 7 * 24 * 3600 * 1000 },
};

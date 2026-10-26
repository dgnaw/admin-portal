export const config = {
  port: Number(process.env.PORT ?? 3102),
  databaseUrl: process.env.AUDIT_DB_URL ?? 'postgres://audit_writer:audit_writer@localhost:5437/audit',
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  groupId: process.env.AUDIT_GROUP_ID ?? 'audit-log-service',
  keycloakUrl: process.env.KEYCLOAK_URL ?? 'http://localhost:8080',
  realms: (process.env.PRODUCT_REALMS ?? 'Blegal,AIHub,LDM').split(',').concat(process.env.PLATFORM_REALM ?? 'Platform'),
};

export const issuers = () => config.realms.map((r) => `${config.keycloakUrl}/realms/${r}`);

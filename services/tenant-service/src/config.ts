export const config = {
  port: Number(process.env.PORT ?? 3101),
  databaseUrl: process.env.TENANT_DB_URL ?? 'postgres://tenant:tenant@localhost:5436/tenant',
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  keycloakUrl: process.env.KEYCLOAK_URL ?? 'http://localhost:8080',
  productRealms: (process.env.PRODUCT_REALMS ?? 'Blegal,AIHub,LDM').split(','),
  separator: '_',
};

export const issuers = () =>
  config.productRealms
    .concat(process.env.PLATFORM_REALM ?? 'Platform')
    .map((r) => `${config.keycloakUrl}/realms/${r}`);

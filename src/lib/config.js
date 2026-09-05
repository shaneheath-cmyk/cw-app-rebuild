import { resolve } from 'node:path';

export function getConfig(environment = process.env) {
  const dataDirectory = resolve(environment.CW_DATA_DIR || './data');
  const storageRoot = resolve(environment.CW_STORAGE_ROOT || './storage');
  return {
    port: Number(environment.PORT || 4173),
    bindHost: environment.CW_BIND_HOST || '127.0.0.1',
    dataDirectory,
    storageRoot,
    databaseUrl: environment.DATABASE_URL || '',
    publicOrigin: environment.CW_PUBLIC_ORIGIN || `http://localhost:${environment.PORT || 4173}`,
    bootstrapAdminEmail: environment.CW_BOOTSTRAP_ADMIN_EMAIL || '',
    bootstrapAdminPassword: environment.CW_BOOTSTRAP_ADMIN_PASSWORD || '',
    stripeSecretKey: environment.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: environment.STRIPE_WEBHOOK_SECRET || '',
    stripePrices: {
      'cw-membership-monthly': environment.STRIPE_PRICE_MEMBERSHIP_MONTHLY || '',
      'title-beneath-black-trees-digital': environment.STRIPE_PRICE_BENEATH_BLACK_TREES_DIGITAL || '',
    },
  };
}

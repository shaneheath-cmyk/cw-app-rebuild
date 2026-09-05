import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export const products = {
  'cw-membership-monthly': { mode: 'subscription', amount: 1995, currency: 'aud', entitlement: 'membership' },
  'title-beneath-black-trees-digital': { mode: 'payment', amount: 1495, currency: 'aud', entitlement: 'digital-beneath-black-trees' },
};

export function stripeMode(secretKey) {
  if (secretKey.startsWith('sk_live_')) return 'live';
  if (secretKey.startsWith('sk_test_')) return 'test';
  return 'unconfigured';
}

export async function createCheckout({ productCode, config }) {
  const product = products[productCode];
  if (!product) throw new Error('Unknown or unavailable product.');
  if (stripeMode(config.stripeSecretKey) !== 'live') throw new Error('Live Stripe Checkout has not been configured.');
  const price = config.stripePrices?.[productCode];
  if (!price || !price.startsWith('price_')) throw new Error('An approved live Stripe price is required for this product.');

  const params = new URLSearchParams({
    mode: product.mode,
    success_url: `${config.publicOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.publicOrigin}/?checkout=cancelled`,
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    'metadata[product_code]': productCode,
  });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': randomUUID() },
    body: params,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'Stripe Checkout could not be created.');
  return { id: payload.id, url: payload.url };
}

export function verifyWebhook(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const fields = signature.split(',').map((part) => part.split('='));
  const timestamp = fields.find(([key]) => key === 't')?.[1];
  const candidates = fields.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || !candidates.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return candidates.some((candidate) => candidate.length === expected.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(expected)));
}

export async function applyStripeEvent({ store, event }) {
  return store.update((state) => {
    if (state.stripeEvents.some((item) => item.id === event.id)) return { repeated: true };
    state.stripeEvents.push({ id: event.id, type: event.type, receivedAt: new Date().toISOString() });
    const session = event.data?.object;
    if (!session || !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return { repeated: false, ignored: true };
    if (session.payment_status !== 'paid') return { repeated: false, ignored: true };
    const product = products[session.metadata?.product_code];
    if (!product) return { repeated: false, ignored: true };
    const orderId = `order-${randomUUID()}`;
    state.orders.push({ id: orderId, stripeSessionId: session.id, customerEmail: session.customer_details?.email || session.customer_email || '', productCode: session.metadata.product_code, amount: session.amount_total, currency: session.currency, status: 'paid', createdAt: new Date().toISOString() });
    state.entitlements.push({ id: `entitlement-${randomUUID()}`, orderId, kind: product.entitlement, status: 'active', createdAt: new Date().toISOString() });
    state.auditEvents.push({ id: randomUUID(), type: 'commerce.fulfilled', subjectId: orderId, at: new Date().toISOString(), actor: 'stripe-webhook' });
    return { repeated: false, orderId };
  });
}

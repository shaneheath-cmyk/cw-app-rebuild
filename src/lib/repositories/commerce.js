import { randomUUID } from 'node:crypto';
import { one } from './base.js';
import { int, text, uuid } from '../sql.js';

export function commerce(databaseUrl) { return {
  recordStripeEvent: async ({ event, product }) => {
    const session = event.data?.object;
    const eventId = String(event.id || '');
    if (!eventId) throw new Error('Stripe event id is required.');
    const orderId = randomUUID(); const entitlementId = randomUUID(); const auditId = randomUUID();
    const eligible = session && ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && session.payment_status === 'paid' && product;
    const sql = eligible
      ? `begin; with inserted as (insert into commerce_event (stripe_event_id,event_type) values (${text(eventId)},${text(event.type)}) on conflict do nothing returning stripe_event_id), ordered as (insert into customer_order (id,stripe_session_id,customer_email,product_code,amount_cents,currency,status) select ${uuid(orderId)},${text(String(session.id))},${text(session.customer_details?.email || session.customer_email || '')},${text(session.metadata.product_code)},${int(session.amount_total)},${text(session.currency)},'paid' from inserted returning id), entitled as (insert into entitlement (id,order_id,kind,status) select ${uuid(entitlementId)},id,${text(product.entitlement)},'active' from ordered), audited as (insert into audit_event (id,type,subject_id,actor_id,actor_label) select ${uuid(auditId)},'commerce.fulfilled',id,null,'stripe-webhook' from ordered) select row_to_json(x) from (select exists(select 1 from inserted) as inserted, (select id from ordered) as "orderId") x; commit;`
      : `begin; with inserted as (insert into commerce_event (stripe_event_id,event_type) values (${text(eventId)},${text(event.type)}) on conflict do nothing returning stripe_event_id) select row_to_json(x) from (select exists(select 1 from inserted) as inserted) x; commit;`;
    const result = await one(databaseUrl, sql);
    if (!result?.inserted) return { repeated: true };
    return eligible ? { repeated: false, orderId: result.orderId } : { repeated: false, ignored: true };
  },
  insertOrderWithEntitlement: () => { throw new Error('Use recordStripeEvent for idempotent Stripe fulfilment.'); },
}; }

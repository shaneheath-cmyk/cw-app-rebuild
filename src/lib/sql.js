import { randomBytes } from 'node:crypto';

function tagFor(value) {
  if (typeof value !== 'string') throw new TypeError('Expected text value.');
  for (;;) {
    const tag = `v${randomBytes(8).toString('hex')}`;
    if (!value.includes(`$${tag}$`)) return tag;
  }
}

export function text(value) { const tag = tagFor(value); return `$${tag}$${value}$${tag}$`; }
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new TypeError('Expected UUID.');
  return text(value);
}
export function int(value) { if (!Number.isSafeInteger(value)) throw new TypeError('Expected safe integer.'); return String(value); }
export function timestamp(value) { if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || !/^\d{4}-\d\d-\d\dT/.test(value)) throw new TypeError('Expected ISO-8601 timestamp.'); return `${text(value)}::timestamptz`; }
export function textArray(values) { if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) throw new TypeError('Expected text array.'); return `array[${values.map(text).join(', ')}]::text[]`; }
export function nullable(emitter, value) { if (value === null || value === undefined) return 'null'; if (typeof emitter !== 'function') throw new TypeError('Expected SQL emitter.'); return emitter(value); }

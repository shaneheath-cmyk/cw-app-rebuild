import { many } from './base.js';
export function works(databaseUrl) { return { listWorks: () => many(databaseUrl, 'select row_to_json(w) from (select id,title,author,status,formats,digital_product_code as "digitalProductCode",kdp_url as "kdpUrl",hardcover_display_price_cents as "hardcoverDisplayPrice" from catalogue_work order by created_at desc) w;') }; }

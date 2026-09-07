const catalogue = document.querySelector('#catalogue');
const dialog = document.querySelector('#message');
const message = document.querySelector('#message-content');
let checkoutReady = false;

function show(title, detail) {
  message.replaceChildren();
  const heading = document.createElement('p');
  heading.className = 'eyebrow';
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = detail;
  message.append(heading, body);
  dialog.showModal();
}

function money(cents) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function verifiedStorefront(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && /(^|\.)amazon\./i.test(parsed.hostname) ? parsed.href : '';
  } catch { return ''; }
}

async function loadLibrary() {
  const response = await fetch('/api/library');
  const { works } = await response.json();
  catalogue.innerHTML = works.map((work) => {
    const storefront = verifiedStorefront(work.kdpUrl);
    const kdp = storefront ? `<a class="outline" href="${escapeHtml(storefront)}" rel="noopener noreferrer">Hardcover ${money(work.hardcoverDisplayPrice)}</a>` : '';
    const digital = Number.isSafeInteger(work.digitalPriceCents) ? `Digital ${money(work.digitalPriceCents)}` : 'Digital unavailable';
    return `<article class="card"><p>${escapeHtml(work.author)}</p><h3>${escapeHtml(work.title)}</h3><p class="formats">${work.formats.map(escapeHtml).join(' / ')}</p><div class="card-actions"><button class="button" data-checkout="${escapeHtml(work.digitalProductCode)}" ${work.digitalPriceCents === null ? 'disabled' : ''}>${digital}</button>${kdp}</div></article>`;
  }).join('');
}

document.addEventListener('click', async (event) => {
  const checkout = event.target.closest('[data-checkout]');
  if (checkout) {
    if (!checkoutReady) {
      show('Checkout not available', 'Live Stripe Checkout has not been configured.');
      return;
    }
    checkout.disabled = true;
    try {
      const response = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productCode: checkout.dataset.checkout }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      window.location.assign(payload.url);
    } catch (error) {
      show('Checkout not available', error.message);
      checkout.disabled = false;
    }
    return;
  }
  if (event.target.closest('[data-action="library"]')) show('My Library', 'Reader accounts and verified post-payment entitlements are the next connected view. The checkout success page will not grant access by itself.');
  if (event.target.closest('.close')) dialog.close();
});

async function boot() {
  const health = await fetch('/api/health').then((response) => response.json());
  checkoutReady = health.stripeMode === 'live';
  await loadLibrary();
}

boot().catch(() => show('Library unavailable', 'The catalogue could not be loaded. Please try again shortly.'));

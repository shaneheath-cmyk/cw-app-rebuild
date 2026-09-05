const identity = document.querySelector('#identity');
const queue = document.querySelector('#operations-list');
const depositForm = document.querySelector('#deposit-form');
const depositMessage = document.querySelector('#deposit-message');

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
async function responseJson(response) { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Request failed.'); return payload; }
async function loadOperations() { const data = await responseJson(await fetch('/api/operations')); queue.innerHTML = data.deposits.length ? data.deposits.map((deposit) => `<article class="queue-row"><strong>${escapeHtml(deposit.intendedTitle || deposit.filename)}</strong><span>${escapeHtml(deposit.status)}</span><small>${escapeHtml(deposit.sha256.slice(0, 16))}...</small></article>`).join('') : '<p class="quiet">No deposits are currently in custody.</p>'; }
async function start() { try { const { user } = await responseJson(await fetch('/api/auth/me')); identity.textContent = `${user.email} · ${user.roles.join(', ')}`; await loadOperations(); } catch { window.location.assign('/login.html'); } }
depositForm.addEventListener('submit', async (event) => { event.preventDefault(); depositMessage.textContent = 'Staging source...'; try { const fields = new FormData(depositForm); const { deposit } = await responseJson(await fetch('/api/deposits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(fields)) })); depositMessage.textContent = `Staged as ${deposit.id}. A literary-assistant retrieval is required before parsing.`; depositForm.reset(); await loadOperations(); } catch (error) { depositMessage.textContent = error.message; } });
document.querySelector('#sign-out').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.assign('/'); });
start();

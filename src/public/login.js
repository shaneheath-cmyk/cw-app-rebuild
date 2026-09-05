const form = document.querySelector('#login-form');
const message = document.querySelector('#form-message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = 'Signing in...';
  const fields = new FormData(form);
  const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: fields.get('email'), password: fields.get('password') }) });
  const payload = await response.json();
  if (!response.ok) { message.textContent = payload.error || 'Sign in failed.'; return; }
  const next = new URLSearchParams(window.location.search).get('next');
  window.location.assign(next === '/studio.html' ? next : '/studio.html');
});

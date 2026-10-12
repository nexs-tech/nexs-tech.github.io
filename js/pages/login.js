(async () => {
  const cap = await captcha($('#cap'));
  const msg = $('#msg');
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const go = $('#go'); go.disabled = true; msg.textContent = '';
    try {
      await Api.post('/auth/login', { email: $('#email').value, password: $('#password').value, turnstile: cap.token() });
      location.href = 'dashboard.html';
    } catch (err) {
      msg.textContent = humanErr(err); msg.style.color = 'var(--warn)'; cap.reset(); go.disabled = false;
    }
  });
})();

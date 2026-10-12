(async () => {
  const cap = await captcha($('#cap'));
  const msg = $('#msg');
  $('#signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const go = $('#go'); go.disabled = true; msg.textContent = '';
    try {
      const r = await Api.post('/auth/signup', { name: $('#name').value, email: $('#email').value,
        password: $('#password').value, turnstile: cap.token() });
      msg.textContent = r.message; msg.style.color = 'var(--good)';
      e.target.reset(); cap.reset();
    } catch (err) {
      msg.textContent = humanErr(err); msg.style.color = 'var(--warn)'; cap.reset();
    }
    go.disabled = false;
  });
})();

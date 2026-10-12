(async () => {
  const p = new URLSearchParams(location.search), ref = p.get('ref');
  const show = id => ['payBox', 'doneBox', 'errBox'].forEach(x => $('#' + x).style.display = x === id ? 'block' : 'none');
  await getConfig();
  const load = async () => {
    try { return await Api.get('/public/requests/' + encodeURIComponent(ref || 'x')); } catch { return null; }
  };
  let req = await load();
  $('#statusLine').textContent = '';
  if (p.get('done')) {
    // Never trust the redirect. Only the webhook marks a request paid.
    $('#statusLine').textContent = 'Confirming your payment...';
    for (let i = 0; i < 12 && req && req.status === 'open'; i++) { await new Promise(r => setTimeout(r, 2500)); req = await load(); }
    $('#statusLine').textContent = '';
    if (req && req.status === 'paid') return show('doneBox');
    $('#errBox').querySelector('p').textContent = 'We have not received confirmation yet. If you were charged, the recipient will see it shortly. Keep your receipt email.';
    return show('errBox');
  }
  if (!req || req.status !== 'open') return show('errBox');
  $('#statusLine').textContent = `Paying ${req.to}`;
  $('#payAmount').textContent = money(req.amount, req.currency);
  $('#payReason').textContent = req.reason;
  $('#payRef').textContent = ref;
  show('payBox');
  $('#payBtn').insertAdjacentHTML('beforebegin', '<div id="cap" style="margin-bottom:14px"></div>');
  const cap = await captcha($('#cap'));
  $('#payBtn').addEventListener('click', async () => {
    const email = $('#payerEmail').value.trim(), name = $('#payerName').value.trim();
    if (!email || !name) return toast('Fill in your details');
    $('#payBtn').disabled = true;
    try {
      const r = await Api.post(`/public/requests/${encodeURIComponent(ref)}/pay`, { email, name, turnstile: cap.token() });
      location.href = r.url;                       // Paystack hosted checkout
    } catch (e) { toast(humanErr(e)); cap.reset(); $('#payBtn').disabled = false; }
  });
})();

(async () => {
  const me = await requireUser();
  _cfg.plans.forEach(p => $$(`[data-price="${p.plan}"]`).forEach(el => el.textContent = money(p.price)));
  const cur = $('[data-current]');
  if (me.plan !== 'free') cur.disabled = false, cur.textContent = 'Switch to Everyday after expiry';
  $$('[data-plan]').forEach(btn => {
    if (btn.dataset.plan === me.plan) btn.textContent = 'Extend 30 days';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { const r = await Api.post('/plan/checkout', { plan: btn.dataset.plan }); location.href = r.url; }
      catch (e) { toast(humanErr(e)); btn.disabled = false; }
    });
  });
  if (new URLSearchParams(location.search).get('done')) toast('Payment received. Your plan updates as soon as Paystack confirms.');
})();

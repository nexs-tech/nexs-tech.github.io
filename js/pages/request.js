(async () => {
  const me = await requireUser();
  $$('.cur').forEach(el => el.textContent = _cfg.fees.currency);
  const amt = $('#amount');
  const preview = () => {
    const m = parseMajor(amt.value), fee = previewFee(m, 'receive', me.discountBps);
    $('#feePreview').innerHTML = `Protection fee: <b>${esc(money(fee))}</b> · You receive: <b>${esc(money(Math.max(0, m - fee)))}</b>`
      + (me.discountBps ? ' <span style="color:var(--good)">· Pro discount applied</span>' : '');
  };
  amt.addEventListener('input', preview); preview();
  $('#reqForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await Api.post('/requests', { amount: amt.value, reason: $('#reason').value, payerHint: $('#payerHint').value });
      const fee = previewFee(r.amount, 'receive', me.discountBps);
      $('#payLink').value = r.link; $('#refCode').value = r.ref;
      $('#netAmt').value = `${money(r.amount)} gross, about ${money(r.amount - fee)} net`;
      $('#resultPane').style.display = 'block';
      toast('Payment link created');
    } catch (err) { toast(humanErr(err)); }
  });
  $('#copyLink').onclick = () => { navigator.clipboard.writeText($('#payLink').value); toast('Link copied'); };
})();

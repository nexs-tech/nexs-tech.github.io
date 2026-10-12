(async () => {
  const me = await requireUser();
  $$('.cur').forEach(el => el.textContent = _cfg.fees.currency);
  const amtEl = $('#wdAmount');
  const upd = () => {
    const a = parseMajor(amtEl.value), fee = previewFee(a, 'withdraw', me.discountBps);
    $('#wdFee').innerHTML = `Fee: <b>${esc(money(fee))}</b> · You receive: <b>${esc(money(Math.max(0, a - fee)))}</b>`
      + (me.discountBps ? ' <span style="color:var(--good)">· Pro</span>' : '');
  };
  amtEl.addEventListener('input', upd); upd();
  const { items: accts } = await Api.get('/payout-accounts');
  $('#storedBank').innerHTML = accts.map(a => `<option value="${esc(a.id)}">${esc(a.bank_name)} ****${esc(a.account_last4)}${new Date(a.usable_after) > new Date() ? ' (unlocking)' : ''}</option>`).join('')
    || '<option value="">No payout account yet</option>';
  const load = async () => {
    const { items } = await Api.get('/withdrawals');
    $('#wdList').innerHTML = items.map(w => `<tr><td>${esc(new Date(w.created_at).toLocaleDateString())}</td>
      <td class="amount">${esc(money(w.amount))}</td><td>${esc(money(w.fee))}</td>
      <td>${esc(w.payout_accounts?.bank_name || '')} ****${esc(w.payout_accounts?.account_last4 || '')}</td>
      <td><span class="badge ${w.status === 'pending_review' || w.status === 'processing' ? 'warn' : ''}">${esc(w.status.replace('_', ' '))}</span></td></tr>`).join('')
      || '<tr><td colspan="5" style="color:var(--mist)">No withdrawal requests yet</td></tr>';
  };
  await load();
  let idem = uuid();
  $('#wdForm').addEventListener('submit', async e => {
    e.preventDefault();
    const payoutId = $('#storedBank').value;
    if (!payoutId) return toast('Add a payout account in Settings first');
    try {
      await withStepUp(() => Api.post('/withdrawals', { amount: amtEl.value, payoutId }, idem));
      toast('Withdrawal submitted for verification'); idem = uuid();
      e.target.reset(); upd(); load();
      Object.assign(me, await Api.get('/me'));
    } catch (err) { toast(humanErr(err)); }
  });
})();

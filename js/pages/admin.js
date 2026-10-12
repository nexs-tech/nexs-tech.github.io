(async () => {
  await requireUser();
  const act = async (id, what, body) => {
    try {
      const r = await withStepUp(() => Api.post(`/admin/withdrawals/${id}/${what}`, body || {}));
      toast(`${what}: ${r.status || r.result || 'ok'}`); load();
    } catch (e) { toast(humanErr(e)); }
  };
  async function load() {
    let items;
    try { ({ items } = await withStepUp(() => Api.get('/admin/withdrawals?status=pending_review'))); }
    catch { location.href = 'dashboard.html'; return; }
    const proc = (await Api.get('/admin/withdrawals?status=processing')).items;
    const row = (w, pending) => `<tr><td>${esc(new Date(w.created_at).toLocaleString())}</td>
      <td>${esc(w.profiles?.email)}</td><td class="amount">${esc(money(w.amount, w.currency))}</td><td>${esc(money(w.fee, w.currency))}</td>
      <td>${esc(w.payout_accounts?.account_name)} (${esc(w.payout_accounts?.bank_name)} ****${esc(w.payout_accounts?.account_last4)})</td>
      <td>${pending ? `<button class="btn sm" data-a="approve" data-id="${esc(w.id)}">Approve</button> <button class="btn ghost sm" data-a="reject" data-id="${esc(w.id)}">Reject</button>`
        : `<button class="btn ghost sm" data-a="sync" data-id="${esc(w.id)}">Sync</button>`}</td></tr>`;
    $('#queue').innerHTML = items.map(w => row(w, true)).join('') + proc.map(w => row(w, false)).join('')
      || '<tr><td colspan="6" style="color:var(--mist)">Queue is empty</td></tr>';
    $$('[data-a]').forEach(b => b.onclick = () => {
      if (b.dataset.a === 'approve' && !confirm('Send this payout through Paystack now?')) return;
      act(b.dataset.id, b.dataset.a, b.dataset.a === 'reject' ? { note: prompt('Reason (optional)') || '' } : {});
    });
    const i = await Api.get('/admin/integrity');
    $('#integrity').textContent = i.mismatched.length || i.needsReview.length
      ? `${i.mismatched.length} wallet mismatches, ${i.needsReview.length} payments need manual review (likely duplicate or cancelled-link payments to refund in Paystack).`
      : 'All wallets match the ledger. No payments waiting for review.';
  }
  load();
})();

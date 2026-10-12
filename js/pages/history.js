(async () => {
  await requireUser();
  const label = { receive: 'Inbound', withdraw: 'Withdrawal', withdraw_refund: 'Refund', sub_out: 'SUB-to-SUB', sub_in: 'SUB-to-SUB' };
  const { items } = await Api.get('/history');
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const render = (f = 'all') => {
    const rows = items.filter(h => f === 'all' || (f === 'in' ? h.delta > 0 : h.delta < 0));
    $('#histBody').innerHTML = rows.map(h => {
      const d = new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<tr><td>${esc(d)}</td><td>${esc(label[h.kind] || h.kind)}</td><td>${esc(h.description || h.ref || '')}</td>
        <td class="amount">${esc(money(h.gross))}</td><td>${esc(money(h.fee))}</td>
        <td class="amount ${h.delta >= 0 ? 'in' : 'out'}">${h.delta >= 0 ? '+' : ''}${esc(money(h.delta))}</td>
        <td><span class="badge">${esc(h.status)}</span></td></tr>`;
    }).join('') || '<tr><td colspan="7" style="color:var(--mist)">No transactions yet</td></tr>';
  };
  const month = items.filter(h => new Date(h.created_at) >= monthStart);
  $('#feeTotal').textContent = money(month.reduce((s, h) => s + h.fee, 0));
  $('#wdTotal').textContent = money(month.filter(h => h.kind === 'withdraw' || h.kind === 'withdraw_refund').reduce((s, h) => s + h.fee, 0));
  seg('#txFilter', render); render();
})();

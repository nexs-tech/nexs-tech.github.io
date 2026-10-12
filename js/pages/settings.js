(async () => {
  let me = await requireUser();
  $('#setName').value = me.name; $('#setEmail').value = me.email;
  $('#setPlan').value = me.isPro ? me.plan : 'Everyday (free)';
  $('#logout').onclick = async () => { await Api.post('/auth/logout').catch(() => {}); location.href = 'login.html'; };

  const mfaBox = $('#mfaBox');
  const drawMfa = () => {
    if (me.mfaFactors.length) { mfaBox.innerHTML = '<div class="chk"><i data-ic="check"></i>Two-step login is on</div>'; hydrateIcons(); return; }
    mfaBox.innerHTML = '<p class="sub">Required for withdrawals, bank changes and large transfers.</p><button class="btn sm" id="mfaStart" style="margin-top:12px">Turn on two-step login</button>';
    $('#mfaStart').onclick = async () => {
      try {
        const r = await Api.post('/mfa/enroll');
        mfaBox.innerHTML = `<p class="sub">Scan with an authenticator app, then enter the code.</p>
          <div class="qr"><img alt="QR code" src="${esc(r.qr)}"></div>
          <p class="mono">${esc(r.secret)}</p>
          <div class="field" style="margin-top:12px"><input id="mfaIn" inputmode="numeric" maxlength="6" placeholder="123456"></div>
          <button class="btn sm" id="mfaGo">Confirm</button>`;
        $('#mfaGo').onclick = async () => {
          try { await Api.post('/mfa/verify', { factorId: r.factorId, code: $('#mfaIn').value.trim() });
            me = await Api.get('/me'); drawMfa(); toast('Two-step login is on'); }
          catch (e) { toast(humanErr(e)); }
        };
      } catch (e) { toast(humanErr(e)); }
    };
  };
  drawMfa();

  const drawPayouts = async () => {
    const { items } = await Api.get('/payout-accounts');
    $('#payBody').innerHTML = items.map(a => `<tr><td>${esc(a.bank_name)}</td><td>****${esc(a.account_last4)}</td><td>${esc(a.account_name)}</td>
      <td>${a.is_default ? '<span class="badge">Default</span> ' : ''}${new Date(a.usable_after) > new Date() ? '<span class="badge warn">Unlocks ' + esc(new Date(a.usable_after).toLocaleString()) + '</span> ' : ''}
      <button class="btn ghost sm" data-rm="${esc(a.id)}">Remove</button></td></tr>`).join('')
      || '<tr><td colspan="4" style="color:var(--mist)">No payout accounts yet</td></tr>';
    $$('[data-rm]').forEach(b => b.onclick = async () => {
      try { await withStepUp(() => Api.del('/payout-accounts/' + b.dataset.rm)); drawPayouts(); } catch (e) { toast(humanErr(e)); }
    });
  };
  await drawPayouts();
  const { items: banks } = await Api.get('/banks');
  $('#bankSel').innerHTML = banks.map(b => `<option value="${esc(b.code)}">${esc(b.name)}</option>`).join('');
  $('#addBank').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await withStepUp(() => Api.post('/payout-accounts', { bankCode: $('#bankSel').value, accountNumber: $('#acctNo').value.trim() }));
      e.target.reset(); toast('Account verified and added'); drawPayouts();
    } catch (err) { toast(humanErr(err)); }
  });
})();

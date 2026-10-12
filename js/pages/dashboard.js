(async () => {
  const me = await requireUser();
  const cur = _cfg.fees.currency;
  $$('.cur').forEach(el => el.textContent = cur);
  const initials = me.name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
  $('#greetName').textContent = me.name.split(' ')[0] || 'there';
  $('#avatar').textContent = initials;
  $('#cardHolder').textContent = me.name;
  $('#planName').textContent = 'Union ' + me.plan[0].toUpperCase() + me.plan.slice(1);
  $('#curSym').textContent = '';
  $('#bal').textContent = money(me.balance);
  $('#delta').textContent = '';
  $('.kpis').innerHTML = `<div>Available<b>${esc(money(me.balance))}</b></div>
    <div>Daily limit left<b>${esc(money(Math.max(0, me.dailyLimit - me.dailyUsed)))}</b></div>
    <div>Your SUB tag<b>@${esc(me.tag)}</b></div>`;

  /* card (cosmetic freeze flag stored server side) */
  const vc = $('#vcard'), reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (!reduce) {
    vc.addEventListener('pointermove', e => {
      const r = vc.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      vc.style.transform = `rotateY(${(x - .5) * 22}deg) rotateX(${(.5 - y) * 22}deg) scale(1.03)`;
      vc.style.setProperty('--mx', x * 100 + '%'); vc.style.setProperty('--my', y * 100 + '%');
    });
    vc.addEventListener('pointerleave', () => { vc.style.transform = ''; vc.style.setProperty('--mx', '50%'); vc.style.setProperty('--my', '30%'); });
  }
  let frozen = me.cardFrozen;
  const paint = () => { vc.classList.toggle('locked', frozen); $('#freezeTxt').textContent = frozen ? 'Unfreeze card' : 'Freeze card'; };
  paint();
  $('#freeze').onclick = async () => {
    try { await Api.post('/card', { frozen: !frozen }); frozen = !frozen; paint(); toast(frozen ? 'Card frozen' : 'Card active'); }
    catch (e) { toast(humanErr(e)); }
  };

  /* safety panel – real interactive progress from account state */
  const mfa = (me.mfaFactors || []).length > 0;
  const hasPayout = !!me.hasPayout;
  const isPro = !!(me.isPro || (me.plan && me.plan !== 'free'));
  const cardOk = !me.cardFrozen;
  const accountOk = !me.accountFrozen;
  const balanceMinor = me.balance || 0;
  const hasBalance = balanceMinor > 0;

  // Weighted real score (0–100)
  let score = 20; // baseline for existing session
  if (mfa) score += 30;
  if (hasPayout) score += 25;
  if (isPro) score += 10;
  if (cardOk) score += 5;
  if (accountOk) score += 5;
  if (hasBalance && hasPayout) score += 5; // ready to withdraw path
  score = Math.min(100, score);

  const chk = (ok, t, href) =>
    `<div class="chk ${ok ? '' : 'todo'}" data-ok="${ok ? 1 : 0}">
      <i data-ic="${ok ? 'check' : 'alert'}"></i>
      ${href && !ok ? `<a href="${href}">${esc(t)}</a>` : esc(t)}
    </div>`;

  const checksEl = $('#safetyChecks') || $('.checks');
  checksEl.innerHTML =
    chk(mfa, mfa ? 'Two-step login is on' : 'Turn on two-step login', 'settings.html') +
    chk(hasPayout, hasPayout ? 'Payout account verified' : 'Add a payout account', 'settings.html') +
    chk(cardOk, cardOk ? 'Virtual card active' : 'Card is frozen — unfreeze when ready') +
    chk(accountOk, accountOk ? 'Account in good standing' : 'Account restricted — contact support') +
    chk(isPro, isPro ? 'Pro plan active' : 'Upgrade for higher limits & lower fees', 'pro.html');
  hydrateIcons();

  const circ = 2 * Math.PI * 52; // ≈ 326.73
  const arc = $('#gArc');
  if (arc) {
    arc.setAttribute('stroke-dasharray', circ.toFixed(2));
    arc.style.strokeDashoffset = circ;
    requestAnimationFrame(() => {
      setTimeout(() => { arc.style.strokeDashoffset = (circ * (1 - score / 100)).toFixed(2); }, 60);
    });
  }
  const scoreNum = $('#scoreNum') || $('.ring .t');
  if (scoreNum) scoreNum.innerHTML = `<div>${score}<small>out of 100</small></div>`;

  const openItems = [];
  if (!mfa) openItems.push('enable MFA');
  if (!hasPayout) openItems.push('add a payout account');
  if (!isPro) openItems.push('consider Pro for higher limits');
  const hint = $('#scoreHint');
  if (hint) {
    if (openItems.length) {
      hint.textContent = 'Improve score: ' + openItems.join(' · ') + '.';
    } else {
      hint.textContent = 'Strong posture. Remember to withdraw idle balances to your bank.';
    }
  }
  const sub = $('#scoreSub');
  if (sub) sub.textContent = 'Updated just now · based on MFA, payout & plan';

  $('#limTxt').textContent = `${money(me.dailyUsed)} of ${money(me.dailyLimit)}`;
  $('#limFill').style.width = Math.min(100, (me.dailyLimit ? me.dailyUsed / me.dailyLimit * 100 : 0)) + '%';

  // Interactive note when user has balance but weak withdrawal path
  if (hasBalance && !hasPayout) {
    toast('You have a balance. Add a payout account so you can move it to your bank.');
  } else if (hasBalance && balanceMinor > 5000000) { // > ~50k minor units example
    // soft prompt only; exact threshold can be tuned server-side later
  }

  /* recent activity */
  const { items } = await Api.get('/history');
  $('#tx').innerHTML = items.slice(0, 5).map(t => `
    <div class="t"><div class="ic">${esc((t.description || '?')[0].toUpperCase())}</div>
      <div><div class="n">${esc(t.description)}</div>
      <div class="d">${esc(t.kind.replace('_', ' '))}${t.fee ? ' · fee ' + esc(money(t.fee)) : ''}</div></div>
      <div class="a ${t.delta > 0 ? 'in' : ''}">${t.delta > 0 ? '+' : ''}${esc(money(t.delta))}</div></div>`).join('')
    || '<p class="sub">No activity yet. Create a payment request to get started.</p>';
})();

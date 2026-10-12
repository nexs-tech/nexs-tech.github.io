(async () => {
  const me = await requireUser();
  $$('.cur').forEach(el => el.textContent = _cfg.fees.currency);
  let idem = uuid();                                // one key per intended transfer, so retries cannot double send
  $('#subForm').addEventListener('submit', async e => {
    e.preventDefault();
    const amount = $('#subAmt').value, recipient = $('#recipient').value;
    try {
      const who = await Api.post('/transfers/lookup', { recipient });
      if (!confirm(`Send ${money(parseMajor(amount))} to ${who.name} (@${who.tag})?`)) return;
      await withStepUp(() => Api.post('/transfers', { recipient, amount, note: $('#subNote').value }, idem));
      toast('Transfer sent'); e.target.reset(); idem = uuid();
    } catch (err) { toast(humanErr(err)); }
  });
})();

/* QA Wrap — options page: the optional passphrase lock (PBKDF2 here, keys held by the worker). */
const ITERS = 600000;
const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pass, salt, iters) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, km, 256));
}

/** @param {{send: Function, t: Function, changed: () => void, unreadable?: () => boolean, werr?: (res: any) => string}} deps */
export function wireVault({ send, t, changed, unreadable = () => false, werr = (res) => String(res?.error ?? '') }) {
  const $ = (id) => document.getElementById(id);
  let st = { pass: false, locked: false, salt: '', iters: 0 };
  const say = (text, err) => {
    $('vault-state').textContent = text;
    $('vault-state').classList.toggle('err', !!err);
  };
  function paint() {
    $('vault-set').hidden = st.locked;
    $('vault-unlock').hidden = !st.locked;
    $('vault-lock').hidden = $('vault-remove').hidden = !st.pass || st.locked;
    $('vault-set-btn').textContent = t(st.pass ? 'options.vault.change' : 'options.vault.set');
    $('vault-mode').textContent = t(unreadable() ? 'options.vault.unreadable' : st.locked ? 'options.vault.modeLocked' : st.pass ? 'options.vault.modeOn' : 'options.vault.modeOff');
  }
  const run = async (msg, ok) => {
    const res = await send(msg);
    if (!res.ok) {
      say(werr(res), true);
      if (res.code === 'VAULT_REKEY') {
        // r10-02-2: the passphrase was right but its record is too weak to keep. The vault is open, so refresh what the
        // page believes, show the set form, and ask for a new passphrase there.
        const again = await send({ type: 'UQA_VAULT_STATE' });
        if (again.ok) { st = again.result; paint(); }
        $('vault-pass')?.focus();
      }
      return;
    }
    st = res.result;
    paint();
    say(ok ? t(ok) : '');
    changed();
  };
  $('vault-set-btn').onclick = async () => {
    const a = $('vault-pass').value;
    if (a.length < 8) return say(t('options.vault.short'), true);
    if (a !== $('vault-pass2').value) return say(t('options.vault.mismatch'), true);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const idle = Math.min(1440, Math.max(1, Number($('vault-idle').value) || 30));
    say(t('options.vault.working'));
    const key = await derive(a, salt, ITERS);
    $('vault-pass').value = $('vault-pass2').value = '';
    await run({ type: 'UQA_VAULT_PASS', key, salt: b64(salt), iters: ITERS, idle }, 'options.vault.isSet');
  };
  $('vault-unlock-btn').onclick = async () => {
    const pw = $('vault-unlock-pass').value;
    if (!pw) return;
    say(t('options.vault.working'));
    const key = await derive(pw, unb(st.salt), st.iters);
    $('vault-unlock-pass').value = '';
    await run({ type: 'UQA_VAULT_UNLOCK', key }, 'options.vault.isOpen');
  };
  $('vault-lock').onclick = () => run({ type: 'UQA_VAULT_LOCK' }, 'options.vault.isLocked');
  $('vault-remove').onclick = () => confirm(t('options.vault.removeConfirm')) && run({ type: 'UQA_VAULT_PASS', key: null }, 'options.vault.isRemoved');
  $('vault-forget').onclick = () => confirm(t('options.vault.forgetConfirm')) && run({ type: 'UQA_VAULT_FORGET' }, 'options.vault.isForgotten');
  return run({ type: 'UQA_VAULT_STATE' });
}

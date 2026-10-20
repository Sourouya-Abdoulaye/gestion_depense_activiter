/* ---------------------------------------------------------------------------
 * Mon Commerce — écran de verrouillage (L6)
 *
 * Plein écran, affiché avant l'interface et à chaque reverrouillage. Le PIN est
 * vérifié par PBKDF2 (src/services/lock.js). Après cinq échecs, une attente
 * croissante ralentit les tentatives ; aucune donnée n'est révélée pendant ce
 * temps.
 * ------------------------------------------------------------------------- */

import { html, element, qs } from './dom.js';
import { icon } from './icons.js';
import { verifyPin } from '../services/lock.js';

let currentOverlay = null;

/** Retire l'écran de verrouillage s'il est affiché. */
export function removeLockScreen() {
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
  document.documentElement.classList.remove('overflow-hidden');
}

/**
 * Affiche l'écran de verrouillage.
 * @param {{settings: object, reason?: string, onUnlocked: Function}} options
 */
export function showLockScreen({ settings = {}, reason = '', onUnlocked }) {
  removeLockScreen();
  document.documentElement.classList.add('overflow-hidden');

  const overlay = element(html`
    <div id="lock-screen" class="fixed inset-0 z-[100] flex items-center justify-center bg-canvas px-4 py-8" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <div class="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-float">
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-xl bg-brand text-white">${icon('settings', { size: 22 })}</span>
          <div class="min-w-0">
            <p class="text-xs font-semibold uppercase tracking-wide text-muted">Mon Commerce</p>
            <h1 id="lock-title" class="text-lg font-bold text-brand-dark">Application verrouillée</h1>
          </div>
        </div>
        <p class="mt-3 text-sm text-muted">
          ${reason || 'Saisissez votre code PIN pour accéder aux données de votre commerce.'}
        </p>

        <form novalidate class="mt-5 space-y-3">
          <label class="label" for="lock-pin">Code PIN</label>
          <input
            id="lock-pin"
            class="input text-center text-xl tracking-[0.35em]"
            type="password"
            inputmode="numeric"
            autocomplete="off"
            maxlength="12"
            placeholder="••••"
            aria-describedby="lock-feedback"
          />
          <p id="lock-feedback" class="min-h-[1.25rem] text-xs text-danger" role="status" aria-live="polite"></p>
          <button type="submit" class="btn-primary w-full" data-unlock>Déverrouiller</button>
        </form>

        <p class="mt-4 text-xs text-muted">
          Ce code protège l’accès à l’interface sur cet appareil. Il n’est pas transmis et ne peut pas être retrouvé :
          en cas d’oubli, les données restent lisibles uniquement via une sauvegarde restaurée après réinitialisation.
        </p>
        <p class="mt-2 text-xs text-muted" data-attempts hidden></p>
      </div>
    </div>
  `);

  const form = qs('form', overlay);
  const input = qs('#lock-pin', overlay);
  const feedback = qs('#lock-feedback', overlay);
  const button = qs('[data-unlock]', overlay);
  const attemptsSlot = qs('[data-attempts]', overlay);
  let failures = 0;
  let lockoutUntil = 0;
  let countdown = null;

  function updateLockout() {
    if (countdown) clearInterval(countdown);
    const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      button.disabled = false;
      input.disabled = false;
      attemptsSlot.hidden = true;
      input.focus();
      return;
    }
    button.disabled = true;
    input.disabled = true;
    attemptsSlot.hidden = false;
    attemptsSlot.textContent = `Trop de tentatives : nouvelle essai dans ${remaining} s.`;
    countdown = setInterval(updateLockout, 500);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (Date.now() < lockoutUntil) return;
    const pin = input.value.trim();
    if (!pin) {
      feedback.textContent = 'Saisissez votre code PIN.';
      input.focus();
      return;
    }
    button.disabled = true;
    feedback.textContent = 'Vérification…';
    const ok = await verifyPin(pin, settings);
    if (ok) {
      removeLockScreen();
      if (typeof onUnlocked === 'function') onUnlocked();
      return;
    }
    failures += 1;
    input.value = '';
    button.disabled = false;
    if (failures >= 5) {
      lockoutUntil = Date.now() + Math.min(300, 30 * (failures - 4)) * 1000;
      updateLockout();
    } else {
      feedback.textContent = `Code incorrect (${failures} tentative${failures > 1 ? 's' : ''}).`;
      input.focus();
    }
  });

  document.body.append(overlay);
  currentOverlay = overlay;
  setTimeout(() => input.focus(), 50);
  return { element: overlay };
}

/** Force la fermeture (après réinitialisation par exemple). */
export function isLockScreenOpen() {
  return Boolean(currentOverlay);
}

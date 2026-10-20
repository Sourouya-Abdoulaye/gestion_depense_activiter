/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Paramètres & sauvegardes »
 *
 * Identité du commerce, listes de référence, préférences de gestion, sauvegarde
 * et restauration des données locales, informations de stockage et zone de
 * réinitialisation. Aucune donnée n'est envoyée sur Internet.
 * ------------------------------------------------------------------------- */

import { APP_NAME, APP_VERSION, SCHEMA_VERSION, DATE_FORMATS, CURRENCY_SYMBOL, ACCOUNTING_DISCLAIMER } from '../config/constants.js';
import { emptyState } from '../config/defaults.js';
import { html, element, qs, raw, delegate, downloadFile, readTextFile } from '../shared/dom.js';
import { formatStamp } from '../shared/dates.js';
import { createPage } from '../shared/screen.js';
import {
  button,
  confirmDialog,
  inputDialog,
  noticePanel,
  openModal,
  pageHeader,
  runAction,
  sectionCard,
  toast,
} from '../shared/ui.js';
import { icon } from '../shared/icons.js';
import { getState, replaceState, saveSettings, markBackupExported } from '../services/state.js';
import { removeSettingsEntry, saveExpenseCategory, savePaymentMethod, saveProductCategory } from '../services/actions.js';
import { buildBackup, buildBackupFilename, diffBackup, mergeBackup, replaceBackup, validateBackup } from '../services/backup.js';
import { isIndexedDbSupported } from '../database/db.js';
import { decryptBackup, encryptBackup, isEncryptedBackup, passwordStrength } from '../services/crypto.js';
import { createLockSettings, lockIsEnabled, lockSummary, validatePin, verifyPin } from '../services/lock.js';
import {
  backupStatus,
  describeBackupStatus,
  environmentSummary,
  getEnvironmentStatus,
  requestPersistentStorage,
} from '../services/environment.js';
import { clearSnapshots, deleteSnapshot, listSnapshots, saveSnapshot } from '../services/snapshots.js';
import { undoLastOperation, undoableOperations } from '../services/undo.js';
import { applyPurge, buildArchive, dataVolume, planPurge } from '../services/maintenance.js';
import { showLockScreen } from '../shared/lock-screen.js';

export const meta = { path: 'parametres', title: 'Paramètres & sauvegardes' };

/* ------------------------------ listes de valeurs ----------------------- */

function listEditor({ title, description, key, values, label, addAction, removeAction }) {
  const container = element(html`
    <div class="space-y-3">
      <div class="flex flex-wrap gap-2">
        ${values.map(
          (value) => html`
            <span class="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-3 py-1 text-xs text-ink">
              ${value}
              <button type="button" class="text-muted hover:text-danger" data-remove="${value}" aria-label="Retirer ${value}">
                ${raw(icon('close', { size: 12 }))}
              </button>
            </span>
          `,
        )}
      </div>
      <div class="flex flex-wrap gap-2">
        <input type="text" class="input max-w-xs" data-new-value placeholder="${label}" aria-label="${label}" />
        <button type="button" class="btn-ghost" data-add>Ajouter</button>
      </div>
    </div>
  `);

  const input = qs('[data-new-value]', container);
  qs('[data-add]', container).addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
      toast('Saisissez une valeur avant d’ajouter.', 'warning');
      return;
    }
    const result = await runAction(() => addAction(value), { successMessage: `« ${value} » ajouté.` });
    if (result !== null && result !== undefined) input.value = '';
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      qs('[data-add]', container).click();
    }
  });
  delegate(container, 'click', '[data-remove]', async (event, target) => {
    const value = target.dataset.remove;
    const confirmed = await confirmDialog({
      title: `Retirer « ${value} » ?`,
      message: 'Cette valeur ne sera plus proposée dans les formulaires.',
      details: 'Les enregistrements existants qui utilisent cette valeur ne sont pas modifiés.',
      confirmLabel: 'Retirer',
    });
    if (confirmed) await runAction(() => removeAction(key, value), { successMessage: 'Valeur retirée.' });
  });

  return sectionCard({ title, description, content: container });
}

/* ---------------------------- mots de passe ----------------------------- */

const COLLECTION_LABELS = {
  activities: 'Activités',
  products: 'Produits',
  customers: 'Clients',
  suppliers: 'Fournisseurs',
  employees: 'Employés',
  purchases: 'Achats',
  sales: 'Ventes',
  returns: 'Retours',
  expenses: 'Dépenses',
  payments: 'Paiements',
  stockMovements: 'Mouvements de stock',
  cashAccounts: 'Comptes de trésorerie',
  cashMovements: 'Mouvements de trésorerie',
};

/** Demande un mot de passe (facultativement avec confirmation). */
function askPassword({ title, description = '', confirmLabel = 'Valider', withConfirm = false, hint = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const form = element(html`
      <form novalidate class="space-y-3">
        <div>
          <label class="label" for="pwd-main">Mot de passe</label>
          <input id="pwd-main" name="password" class="input" type="password" autocomplete="new-password" />
        </div>
        ${withConfirm
          ? html`
              <div>
                <label class="label" for="pwd-confirm">Confirmer le mot de passe</label>
                <input id="pwd-confirm" name="confirm" class="input" type="password" autocomplete="new-password" />
              </div>
            `
          : ''}
        ${withConfirm ? html`<p class="text-xs text-muted" data-strength>Force : —</p>` : ''}
        <p class="text-xs text-danger" data-feedback aria-live="polite"></p>
        ${hint ? html`<p class="text-xs text-muted">${hint}</p>` : ''}
      </form>
    `);
    const feedback = qs('[data-feedback]', form);
    const strengthSlot = qs('[data-strength]', form);
    const main = qs('[name="password"]', form);
    if (strengthSlot) {
      main.addEventListener('input', () => {
        const strength = passwordStrength(main.value);
        strengthSlot.textContent = `Force : ${strength.label}`;
      });
    }
    openModal({
      title,
      description,
      size: 'sm',
      content: form,
      onClose: () => done(null),
      actions: [
        { label: 'Annuler', variant: 'ghost', onClick: () => done(null) },
        {
          label: confirmLabel,
          variant: 'primary',
          onClick: () => {
            const value = main.value;
            if (value.length < 8) {
              feedback.textContent = 'Utilisez au moins 8 caractères.';
              main.focus();
              return false;
            }
            if (withConfirm && value !== qs('[name="confirm"]', form).value) {
              feedback.textContent = 'Les deux mots de passe ne correspondent pas.';
              return false;
            }
            done(value);
            return true;
          },
        },
      ],
    });
  });
}

/* ------------------------------- sauvegarde ----------------------------- */

/** Dialogue d'export : sauvegarde lisible ou chiffrée (L7). */
function exportBackup() {
  const content = element(html`
    <div class="space-y-3">
      <p class="text-sm text-ink">
        Le fichier contient toutes vos activités, produits, ventes, achats, dépenses et réglages.
        Conservez-le hors de cet appareil (clé USB, e-mail, cloud).
      </p>
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" id="export-encrypt" class="mt-0.5 h-4 w-4 rounded border-line text-brand" />
        <span>
          Chiffrer le fichier avec un mot de passe
          <span class="block text-xs text-muted">Recommandé si le fichier transite par e-mail ou un cloud. Sans le mot de passe, la sauvegarde est définitivement illisible.</span>
        </span>
      </label>
      <div class="hidden space-y-3 rounded-lg border border-line bg-canvas/60 p-3" data-encrypt-fields>
        <div>
          <label class="label" for="export-password">Mot de passe (8 caractères minimum)</label>
          <input id="export-password" class="input" type="password" autocomplete="new-password" />
        </div>
        <div>
          <label class="label" for="export-password-confirm">Confirmer</label>
          <input id="export-password-confirm" class="input" type="password" autocomplete="new-password" />
        </div>
        <p class="text-xs text-muted" data-export-strength>Force : —</p>
      </div>
      <p class="text-xs text-muted">Une sauvegarde n’est jamais envoyée automatiquement sur Internet.</p>
    </div>
  `);
  const encryptToggle = qs('#export-encrypt', content);
  const fields = qs('[data-encrypt-fields]', content);
  const password = qs('#export-password', content);
  const confirmation = qs('#export-password-confirm', content);
  const strengthSlot = qs('[data-export-strength]', content);
  encryptToggle.addEventListener('change', () => {
    fields.classList.toggle('hidden', !encryptToggle.checked);
    if (encryptToggle.checked) password.focus();
  });
  password.addEventListener('input', () => {
    strengthSlot.textContent = `Force : ${passwordStrength(password.value).label}`;
  });

  openModal({
    title: 'Exporter une sauvegarde',
    size: 'md',
    content,
    actions: [
      { label: 'Annuler', variant: 'ghost' },
      {
        label: 'Exporter',
        variant: 'primary',
        onClick: async () => {
          const encrypt = encryptToggle.checked;
          if (encrypt) {
            if (password.value.length < 8) {
              toast('Le mot de passe doit contenir au moins 8 caractères.', 'warning');
              password.focus();
              return false;
            }
            if (password.value !== confirmation.value) {
              toast('Les deux mots de passe ne correspondent pas.', 'warning');
              confirmation.focus();
              return false;
            }
          }
          try {
            const payload = buildBackup(getState());
            const filename = buildBackupFilename(new Date(), { encrypted: encrypt });
            const output = encrypt ? await encryptBackup(payload, password.value) : payload;
            downloadFile(filename, JSON.stringify(output, null, 2), 'application/json');
            await markBackupExported();
            toast(
              encrypt ? `Sauvegarde chiffrée enregistrée : ${filename}` : `Sauvegarde enregistrée : ${filename}`,
              'success',
              { duration: 7000 },
            );
            return true;
          } catch (error) {
            toast(error && error.message ? error.message : 'Export impossible.', 'error', { duration: 7000 });
            return false;
          }
        },
      },
    ],
  });
}

/** Aperçu détaillé avant import (L3) puis application choisie. */
function importBackup(payload) {
  const validation = validateBackup(payload);
  if (!validation.valid) {
    toast(validation.errors[0] || 'Sauvegarde invalide.', 'error', { duration: 7000 });
    return;
  }

  const preview = validation.preview || {};
  const incoming = (validation.normalized && validation.normalized.data) || {};
  const diff = diffBackup(getState(), incoming);
  const counts = preview.counts || {};
  const changedCollections = Object.entries(diff.collections).filter(
    ([, entry]) => entry.total > 0,
  );

  const body = element(html`
    <div class="space-y-3">
      <div class="grid gap-2 text-sm sm:grid-cols-2">
        <p>Application : <strong>${preview.application || APP_NAME}</strong></p>
        <p>Version : <strong>${preview.appVersion || 'inconnue'}</strong></p>
        <p>Exportée le : <strong>${preview.exportedAt ? formatStamp(preview.exportedAt) : '—'}</strong></p>
        <p>Schéma : <strong>${preview.schemaVersion ?? '—'}</strong></p>
      </div>

      <div class="grid gap-2 text-xs sm:grid-cols-4">
        <div class="rounded-lg border border-brand/30 bg-brand-light/60 px-3 py-2"><p class="text-muted">Ajouts</p><p class="text-lg font-bold text-brand-dark">${diff.totals.added}</p></div>
        <div class="rounded-lg border border-line bg-canvas/70 px-3 py-2"><p class="text-muted">Mises à jour</p><p class="text-lg font-bold text-ink">${diff.totals.updated}</p></div>
        <div class="rounded-lg border border-line bg-canvas/70 px-3 py-2"><p class="text-muted">Identiques</p><p class="text-lg font-bold text-ink">${diff.totals.identical}</p></div>
        <div class="rounded-lg border border-warning/30 bg-amber-50 px-3 py-2"><p class="text-muted">Ignorés (plus anciens)</p><p class="text-lg font-bold text-warning">${diff.totals.older}</p></div>
      </div>

      <div class="table-wrap">
        <table class="table table-stack">
          <thead>
            <tr><th>Collection</th><th class="text-right">Fichier</th><th class="text-right">Ajout</th><th class="text-right">Mise à jour</th><th class="text-right">Identiques</th><th class="text-right">Plus anciens</th></tr>
          </thead>
          <tbody>
            ${changedCollections.map(([name, entry]) => html`
              <tr>
                <td data-label="Collection">${COLLECTION_LABELS[name] || name}</td>
                <td data-label="Fichier" class="text-right">${counts[name] ?? entry.total}</td>
                <td data-label="Ajout" class="text-right">${entry.added}</td>
                <td data-label="Mise à jour" class="text-right">${entry.updated}</td>
                <td data-label="Identiques" class="text-right">${entry.identical}</td>
                <td data-label="Plus anciens" class="text-right">${entry.older}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>

      ${diff.settingsChanged.length > 0
        ? html`<p class="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-xs text-muted">
            Réglages modifiés par l’import : ${diff.settingsChanged.slice(0, 8).join(', ')}${diff.settingsChanged.length > 8 ? '…' : ''}.
          </p>`
        : ''}

      ${validation.warnings.length > 0
        ? html`<div class="rounded-lg border border-warning/30 bg-amber-50 px-3 py-2 text-xs text-ink">
            <p class="font-semibold text-warning">Avertissements</p>
            <ul class="mt-1 list-disc space-y-0.5 pl-5">${validation.warnings.map((warning) => html`<li>${warning}</li>`)}</ul>
          </div>`
        : ''}

      <div class="rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-xs text-ink">
        <p class="font-semibold text-danger">Avant de continuer</p>
        <p>
          <strong>Fusionner</strong> ajoute les enregistrements absents, met à jour les plus récents et ignore les versions plus anciennes.
          <strong>Remplacer</strong> efface d’abord les données actuelles de cet appareil (${diff.deletesOnReplace} enregistrement(s) non présents dans le fichier seront supprimés).
        </p>
        <p class="mt-1">Un instantané de sécurité est créé automatiquement : le dernier import pourra être annulé depuis les paramètres.</p>
      </div>
    </div>
  `);

  openModal({
    title: 'Restaurer une sauvegarde',
    size: 'lg',
    content: body,
    actions: [
      { label: 'Annuler', variant: 'ghost' },
      {
        label: 'Fusionner',
        variant: 'primary',
        onClick: async () => {
          const current = getState();
          const { data, stats } = mergeBackup(current, incoming);
          try {
            await saveSnapshot({
              kind: 'before-import',
              label: `Avant fusion — ${preview.exportedAt ? formatStamp(preview.exportedAt) : 'sauvegarde importée'}`,
              data: current,
              meta: { mode: 'merge', source: preview.exportedAt || '' },
            });
          } catch {
            toast('Instantané de sécurité non enregistré (espace insuffisant) : l’import continue.', 'warning', { duration: 7000 });
          }
          const result = await runAction(() => replaceState(data), {
            successMessage: `Fusion terminée : ${stats.added} ajout(s), ${stats.updated} mise(s) à jour, ${stats.ignored} version(s) plus ancienne(s) ignorée(s).`,
          });
          return Boolean(result) || true;
        },
      },
      {
        label: 'Remplacer',
        variant: 'danger',
        onClick: async () => {
          const current = getState();
          const { data } = replaceBackup(current, incoming);
          try {
            await saveSnapshot({
              kind: 'before-import',
              label: `Avant remplacement — ${preview.exportedAt ? formatStamp(preview.exportedAt) : 'sauvegarde importée'}`,
              data: current,
              meta: { mode: 'replace', source: preview.exportedAt || '' },
            });
          } catch {
            toast('Instantané de sécurité non enregistré (espace insuffisant) : le remplacement continue.', 'warning', { duration: 7000 });
          }
          const result = await runAction(() => replaceState(data), {
            successMessage: 'Données remplacées par la sauvegarde.',
          });
          return Boolean(result) || true;
        },
      },
    ],
  });
}

async function pickBackupFile() {
  const input = element('<input type="file" accept="application/json,.json" class="hidden" />');
  document.body.append(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await readTextFile(file));
    } catch (error) {
      toast('Fichier illisible : ce n’est pas un JSON valide.', 'error', { duration: 7000 });
      return;
    }
    if (isEncryptedBackup(payload)) {
      const password = await askPassword({
        title: 'Sauvegarde chiffrée',
        description: 'Ce fichier est protégé par un mot de passe. Il n’est pas enregistré dans le fichier.',
        confirmLabel: 'Déchiffrer',
        hint: 'Un mot de passe perdu ne peut pas être retrouvé : le fichier reste illisible.',
      });
      if (password === null) return;
      try {
        payload = await decryptBackup(payload, password);
      } catch (error) {
        toast(error && error.message ? error.message : 'Déchiffrement impossible.', 'error', { duration: 7000 });
        return;
      }
    }
    importBackup(payload);
  });
  input.click();
}

/* --------------------------- instantanés / annulation -------------------- */

async function undoImport(snapshot) {
  const confirmed = await confirmDialog({
    title: 'Annuler le dernier import ?',
    message: `Les données seront remplacées par l’instantané du ${formatStamp(snapshot.createdAt)}.`,
    details: 'Les modifications enregistrées depuis cet instantané seront perdues. Exportez une sauvegarde avant si nécessaire.',
    confirmLabel: 'Annuler l’import',
  });
  if (!confirmed) return;
  const result = await runAction(() => replaceState(snapshot.data), { successMessage: 'Import annulé : état précédent restauré.' });
  if (result !== null) await deleteSnapshot(snapshot.id);
}

/** Remplit la liste des opérations annulables (L12). */
async function paintUndoJournal(slot) {
  if (!slot) return;
  try {
    const entries = await undoableOperations(8);
    if (!slot.isConnected) return;
    if (entries.length === 0) {
      slot.textContent = 'Aucune opération récente : le journal est vide.';
      return;
    }
    slot.replaceChildren(
      element(html`
        <div class="space-y-3">
          <ul class="divide-y divide-line">
            ${entries.map(
              (entry, index) => html`
                <li class="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-ink">${entry.label}</p>
                    <p class="text-xs text-muted">${formatStamp(entry.createdAt)}${entry.summary ? ` — ${entry.summary}` : ''}</p>
                  </div>
                  ${index === 0 ? html`<button type="button" class="btn-ghost btn-sm" data-undo-last>Annuler cette opération</button>` : ''}
                </li>
              `,
            )}
          </ul>
          <p class="text-xs text-muted">
            Seule la dernière opération peut être annulée. Pour une vente, préférez « Annuler la vente » depuis l’écran des ventes :
            l’historique et les mouvements compensatoires restent alors visibles.
          </p>
        </div>
      `),
    );
    const button = slot.querySelector('[data-undo-last]');
    if (button) {
      button.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: `Annuler « ${entries[0].label} » ?`,
          message: 'Les enregistrements créés seront retirés et les enregistrements modifiés retrouveront leur version précédente.',
          details: 'Cette annulation est immédiate. Exportez une sauvegarde si vous n’êtes pas sûr du résultat.',
          confirmLabel: 'Annuler l’opération',
        });
        if (!confirmed) return;
        await runAction(() => undoLastOperation(), { successMessage: 'Dernière opération annulée.' });
      });
    }
  } catch (error) {
    slot.textContent = 'Journal d’annulation indisponible sur ce navigateur.';
  }
}

/** Remplit la liste des instantanés (chargement asynchrone). */
async function paintSnapshots(slot) {
  if (!slot) return;
  try {
    const snapshots = await listSnapshots();
    if (snapshots.length === 0) {
      slot.textContent = 'Aucun instantané enregistré pour le moment. Un instantané est créé avant chaque import de sauvegarde.';
      return;
    }
    slot.replaceChildren(
      element(html`
        <ul class="divide-y divide-line">
          ${snapshots.map(
            (snapshot) => html`
              <li class="flex flex-wrap items-center justify-between gap-2 py-2">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-ink">${snapshot.label || snapshot.kind}</p>
                  <p class="text-xs text-muted">${formatStamp(snapshot.createdAt)} — ${Object.values(snapshot.counts || {}).reduce((total, count) => total + count, 0)} enregistrement(s)</p>
                </div>
                <div class="flex gap-2">
                  ${snapshot.kind === 'before-import'
                    ? html`<button type="button" class="btn-ghost btn-sm" data-undo-snapshot="${snapshot.id}">Restaurer</button>`
                    : ''}
                  <button type="button" class="btn-ghost btn-sm text-danger" data-delete-snapshot="${snapshot.id}">Supprimer</button>
                </div>
              </li>
            `,
          )}
        </ul>
      `),
    );
    slot.querySelectorAll('[data-undo-snapshot]').forEach((node) => {
      node.addEventListener('click', () => {
        const snapshot = snapshots.find((entry) => entry.id === node.dataset.undoSnapshot);
        if (snapshot) void undoImport(snapshot);
      });
    });
    slot.querySelectorAll('[data-delete-snapshot]').forEach((node) => {
      node.addEventListener('click', async () => {
        await runAction(() => deleteSnapshot(node.dataset.deleteSnapshot), { successMessage: 'Instantané supprimé.' });
      });
    });
  } catch (error) {
    slot.textContent = 'Instantanés indisponibles sur ce navigateur.';
  }
}

/* ----------------------------- réinitialisation ------------------------- */

async function resetAllData() {
  const typed = await inputDialog({
    title: 'Réinitialiser toutes les données',
    description: 'Cette opération est irréversible. Exportez d’abord une sauvegarde si vous souhaitez conserver vos données.',
    label: `Tapez « EFFACER » pour confirmer`,
    placeholder: 'EFFACER',
    confirmLabel: 'Tout effacer',
  });
  if (typed === null) return;
  if (String(typed).trim().toUpperCase() !== 'EFFACER') {
    toast('Confirmation incorrecte : rien n’a été supprimé.', 'warning');
    return;
  }
  const result = await runAction(() => replaceState(emptyState()), { silent: true });
  if (result === null) return;
  await runAction(() => clearSnapshots(), { silent: true });
  await runAction(() => saveSettings({ onboardingDone: true }), { silent: true });
  toast('Toutes les données ont été effacées.', 'success', { duration: 6000 });
  window.location.hash = '#/tableau-de-bord';
}

/* ------------------------------- stockage ------------------------------- */

async function requestPersistence() {
  const granted = await requestPersistentStorage();
  toast(
    granted ? 'Stockage persistant accordé.' : 'Ce navigateur n’a pas accordé le stockage persistant.',
    granted ? 'success' : 'warning',
    { duration: 6000 },
  );
  return granted;
}

async function estimateStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return estimate;
  } catch (error) {
    return null;
  }
}

/* ------------------------------- verrouillage --------------------------- */

/** Demande un code PIN (éventuellement avec confirmation). */
function askPin({ title, description = '', confirmLabel = 'Valider', withConfirm = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const form = element(html`
      <form novalidate class="space-y-3">
        <div>
          <label class="label" for="pin-main">Code PIN (4 à 12 chiffres)</label>
          <input id="pin-main" name="pin" class="input text-center text-lg tracking-[0.3em]" type="password" inputmode="numeric" maxlength="12" autocomplete="off" />
        </div>
        ${withConfirm
          ? html`
              <div>
                <label class="label" for="pin-confirm">Confirmer le code PIN</label>
                <input id="pin-confirm" name="confirm" class="input text-center text-lg tracking-[0.3em]" type="password" inputmode="numeric" maxlength="12" autocomplete="off" />
              </div>
            `
          : ''}
        <p class="text-xs text-danger" data-feedback aria-live="polite"></p>
      </form>
    `);
    const feedback = qs('[data-feedback]', form);
    const main = qs('[name="pin"]', form);
    openModal({
      title,
      description,
      size: 'sm',
      content: form,
      onClose: () => done(null),
      actions: [
        { label: 'Annuler', variant: 'ghost', onClick: () => done(null) },
        {
          label: confirmLabel,
          variant: 'primary',
          onClick: () => {
            const pin = main.value.trim();
            const validation = validatePin(pin);
            if (!validation.valid) {
              feedback.textContent = validation.message;
              main.focus();
              return false;
            }
            if (withConfirm && pin !== qs('[name="confirm"]', form).value.trim()) {
              feedback.textContent = 'Les deux codes ne correspondent pas.';
              return false;
            }
            done(pin);
            return true;
          },
        },
      ],
    });
  });
}

async function enableLock() {
  const pin = await askPin({
    title: 'Activer le verrouillage',
    description: 'Choisissez un code PIN. Il sera demandé à l’ouverture de l’application.',
    confirmLabel: 'Activer',
    withConfirm: true,
  });
  if (pin === null) return;
  try {
    const patch = await createLockSettings(pin);
    await runAction(() => saveSettings(patch), { successMessage: 'Verrouillage activé.' });
  } catch (error) {
    toast(error && error.message ? error.message : 'Activation impossible.', 'error');
  }
}

async function disableLock() {
  const pin = await askPin({ title: 'Désactiver le verrouillage', description: 'Saisissez le code PIN actuel pour confirmer.', confirmLabel: 'Désactiver' });
  if (pin === null) return;
  if (!(await verifyPin(pin, getState().settings || {}))) {
    toast('Code PIN incorrect : le verrouillage reste actif.', 'error');
    return;
  }
  await runAction(
    () => saveSettings({ lockEnabled: false, lockPinHash: '', lockPinSalt: '', lockUpdatedAt: new Date().toISOString() }),
    { successMessage: 'Verrouillage désactivé.' },
  );
}

async function changeLockPin() {
  const current = await askPin({ title: 'Changer le code PIN', description: 'Saisissez d’abord le code actuel.', confirmLabel: 'Continuer' });
  if (current === null) return;
  if (!(await verifyPin(current, getState().settings || {}))) {
    toast('Code PIN actuel incorrect.', 'error');
    return;
  }
  const next = await askPin({ title: 'Nouveau code PIN', confirmLabel: 'Enregistrer', withConfirm: true });
  if (next === null) return;
  try {
    const patch = await createLockSettings(next);
    await runAction(() => saveSettings(patch), { successMessage: 'Code PIN modifié.' });
  } catch (error) {
    toast(error && error.message ? error.message : 'Modification impossible.', 'error');
  }
}

/* --------------------------------- rendu -------------------------------- */

function paint(ctx) {
  const state = getState();
  const settings = state.settings || {};
  const wrapper = element('<div class="space-y-4"></div>');

  wrapper.append(
    pageHeader({
      title: 'Paramètres & sauvegardes',
      subtitle: 'Personnalisez l’application et protégez vos données locales.',
      actions: [
        button({ label: 'Exporter une sauvegarde', iconName: 'download', variant: 'primary', onClick: exportBackup }),
        button({ label: 'Restaurer une sauvegarde', iconName: 'upload', onClick: pickBackupFile }),
      ],
    }),
  );

  wrapper.append(
    noticePanel({
      title: 'Vos données restent sur cet appareil',
      tone: 'info',
      items: [
        `Aucun compte, aucun serveur, aucun envoi automatique : tout est stocké localement dans ${APP_NAME}.`,
        'Effacer les données du navigateur ou changer d’appareil supprime les données : exportez régulièrement une sauvegarde.',
        settings.lastBackupAt ? `Dernière sauvegarde exportée : ${formatStamp(settings.lastBackupAt)}.` : 'Aucune sauvegarde exportée pour le moment.',
      ],
    }),
  );

  /* ------------------------------- identité ----------------------------- */
  const identityForm = element(html`
    <form novalidate class="grid gap-4 sm:grid-cols-2">
      <div class="sm:col-span-2">
        <label class="label" for="set-shop-name">Nom du commerce</label>
        <input id="set-shop-name" name="shopName" class="input" type="text" value="${settings.shopName || ''}" placeholder="Ex. Boutique Awa" />
        <p class="mt-1 text-xs text-muted">Ce nom apparaît sur les reçus et les rapports.</p>
      </div>
      <div class="sm:col-span-2">
        <label class="label" for="set-logo">Logo (facultatif)</label>
        <div class="flex flex-wrap items-center gap-3">
          ${settings.logoDataUrl
            ? html`<img src="${settings.logoDataUrl}" alt="Logo actuel" class="h-12 w-12 rounded-lg border border-line object-contain" />`
            : html`<span class="grid h-12 w-12 place-items-center rounded-lg border border-dashed border-line text-muted">${raw(icon('activity', { size: 20 }))}</span>`}
          <input id="set-logo" name="logo" type="file" accept="image/*" class="text-sm" />
          ${settings.logoDataUrl ? html`<button type="button" class="btn-ghost btn-sm" data-clear-logo>Retirer le logo</button>` : ''}
        </div>
      </div>
      <div>
        <label class="label" for="set-shop-phone">Téléphone (facultatif)</label>
        <input id="set-shop-phone" class="input" type="tel" value="${settings.shopPhone || ''}" placeholder="Ex. +228 90 00 00 00" />
      </div>
      <div>
        <label class="label" for="set-shop-address">Adresse (facultatif)</label>
        <input id="set-shop-address" class="input" type="text" value="${settings.shopAddress || ''}" placeholder="Quartier, ville" />
      </div>
      <div class="sm:col-span-2">
        <label class="label" for="set-shop-tax">Mentions légales / identifiant fiscal (facultatif)</label>
        <input id="set-shop-tax" class="input" type="text" value="${settings.shopTaxId || ''}" placeholder="Ex. RCCM, NIF, numéro de registre" />
      </div>
    </form>
  `);

  qs('#set-shop-name', identityForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ shopName: event.target.value.trim() }), { successMessage: 'Nom du commerce enregistré.' });
  });
  qs('#set-shop-phone', identityForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ shopPhone: event.target.value.trim() }), { successMessage: 'Téléphone enregistré.' });
  });
  qs('#set-shop-address', identityForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ shopAddress: event.target.value.trim() }), { successMessage: 'Adresse enregistrée.' });
  });
  qs('#set-shop-tax', identityForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ shopTaxId: event.target.value.trim() }), { successMessage: 'Mentions légales enregistrées.' });
  });

  const logoInput = qs('#set-logo', identityForm);
  logoInput.addEventListener('change', () => {
    const file = logoInput.files && logoInput.files[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast('Image trop volumineuse (512 Ko maximum).', 'warning', { duration: 6000 });
      logoInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      runAction(() => saveSettings({ logoDataUrl: String(reader.result || '') }), { successMessage: 'Logo enregistré.' });
    };
    reader.onerror = () => toast('Lecture de l’image impossible.', 'error');
    reader.readAsDataURL(file);
  });

  const clearLogo = qs('[data-clear-logo]', identityForm);
  if (clearLogo) {
    clearLogo.addEventListener('click', () => {
      runAction(() => saveSettings({ logoDataUrl: '' }), { successMessage: 'Logo retiré.' });
    });
  }

  wrapper.append(sectionCard({ title: 'Identité du commerce', description: 'Nom, logo, coordonnées et mentions légales repris sur les documents.', content: identityForm }));

  /* --------------------------- modèles de reçus (L13) ------------------- */
  const receiptForm = element(html`
    <form novalidate class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="label" for="set-receipt-template">Modèle de reçu</label>
        <select id="set-receipt-template" class="input">
          <option value="classic" ${settings.receiptTemplate !== 'compact' && settings.receiptTemplate !== 'minimal' ? 'selected' : ''}>Classique — A4, en-tête vert</option>
          <option value="compact" ${settings.receiptTemplate === 'compact' ? 'selected' : ''}>Compact — A5, marges réduites</option>
          <option value="minimal" ${settings.receiptTemplate === 'minimal' ? 'selected' : ''}>Minimal — noir et blanc</option>
        </select>
        <p class="mt-1 text-xs text-muted">S’applique au PDF téléchargé et à l’impression directe du reçu.</p>
      </div>
      <label class="flex items-start gap-2 self-end text-sm">
        <input type="checkbox" id="set-receipt-logo" class="mt-0.5 h-4 w-4 rounded border-line text-brand" ${settings.receiptShowLogo !== false ? 'checked' : ''} />
        <span>
          Afficher le logo sur les reçus
          <span class="block text-xs text-muted">Le logo est repris depuis l’identité du commerce.</span>
        </span>
      </label>
      <div class="sm:col-span-2">
        <label class="label" for="set-receipt-footer">Message de pied de reçu</label>
        <input id="set-receipt-footer" class="input" type="text" maxlength="200" value="${settings.receiptFooter || ''}" placeholder="Ex. Merci de votre visite." />
        <p class="mt-1 text-xs text-muted">Coordonnées et mentions légales sont ajoutées automatiquement sous ce message.</p>
      </div>
    </form>
  `);

  qs('#set-receipt-template', receiptForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ receiptTemplate: event.target.value }), { successMessage: 'Modèle de reçu enregistré.' });
  });
  qs('#set-receipt-logo', receiptForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ receiptShowLogo: event.target.checked }), {
      successMessage: event.target.checked ? 'Logo affiché sur les reçus.' : 'Logo masqué sur les reçus.',
    });
  });
  qs('#set-receipt-footer', receiptForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ receiptFooter: event.target.value.trim() }), { successMessage: 'Message de pied de reçu enregistré.' });
  });

  wrapper.append(
    sectionCard({
      title: 'Modèles de reçus',
      description: 'Choisissez la présentation des reçus remis aux clients.',
      content: receiptForm,
    }),
  );

  /* ----------------------------- préférences ---------------------------- */
  const preferencesForm = element(html`
    <form novalidate class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="label" for="set-date-format">Format des dates</label>
        <select id="set-date-format" class="input">
          ${DATE_FORMATS.map(
            (format) => html`<option value="${format.value}" ${format.value === settings.dateFormat ? 'selected' : ''}>${format.label}</option>`,
          )}
        </select>
      </div>
      <div>
        <label class="label" for="set-threshold">Seuil d’alerte de stock par défaut</label>
        <input id="set-threshold" class="input" type="number" min="0" step="1" value="${settings.defaultAlertThreshold ?? 0}" />
      </div>
      <div>
        <label class="label" for="set-decimals">Affichage des montants</label>
        <select id="set-decimals" class="input">
          <option value="auto" ${settings.moneyDecimals === null || settings.moneyDecimals === undefined ? 'selected' : ''}>Automatique (centimes si nécessaire)</option>
          <option value="0" ${settings.moneyDecimals === 0 ? 'selected' : ''}>Sans centimes (1 500 FCFA)</option>
          <option value="2" ${settings.moneyDecimals === 2 ? 'selected' : ''}>Avec centimes (1 500,00 FCFA)</option>
        </select>
        <p class="mt-1 text-xs text-muted">Affichage uniquement : les calculs conservent leur précision (L15).</p>
      </div>
      <label class="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" id="set-negative-stock" class="mt-0.5 h-4 w-4 rounded border-line text-brand" ${settings.allowNegativeStock ? 'checked' : ''} />
        <span>
          Autoriser les ventes avec un stock insuffisant (stock négatif).
          <span class="block text-xs text-muted">Désactivé par défaut : une vente est refusée si le stock disponible est insuffisant.</span>
        </span>
      </label>
    </form>
  `);

  qs('#set-date-format', preferencesForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ dateFormat: event.target.value }), { successMessage: 'Format des dates enregistré.' });
  });
  qs('#set-threshold', preferencesForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ defaultAlertThreshold: Number(event.target.value) || 0 }), { successMessage: 'Seuil d’alerte enregistré.' });
  });
  qs('#set-decimals', preferencesForm).addEventListener('change', (event) => {
    const raw = event.target.value;
    const value = raw === 'auto' ? null : Number(raw);
    runAction(() => saveSettings({ moneyDecimals: value }), { successMessage: 'Affichage des montants enregistré.' });
  });
  qs('#set-negative-stock', preferencesForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ allowNegativeStock: event.target.checked }), {
      successMessage: event.target.checked ? 'Stock négatif autorisé.' : 'Stock négatif interdit.',
    });
  });

  wrapper.append(sectionCard({ title: 'Préférences de gestion', description: 'Ces réglages influencent les formulaires et les contrôles.', content: preferencesForm }));

  /* --------------------------- sauvegardes (L1/L2) ---------------------- */
  const backupState = backupStatus(settings);
  const reminderOptions = [
    { value: 0, label: 'Jamais (rappel désactivé)' },
    { value: 1, label: 'Chaque jour' },
    { value: 3, label: 'Tous les 3 jours' },
    { value: 7, label: 'Chaque semaine' },
    { value: 14, label: 'Toutes les 2 semaines' },
    { value: 30, label: 'Chaque mois' },
  ];
  const backupForm = element(html`
    <div class="space-y-4">
      <div class="rounded-lg border ${backupState.due ? 'border-warning/40 bg-amber-50' : 'border-line bg-canvas/60'} px-3 py-2 text-sm">
        <p class="font-medium text-ink">${describeBackupStatus(settings)}</p>
        <p class="mt-0.5 text-xs text-muted">
          ${backupState.due
            ? 'Il est temps d’exporter une nouvelle sauvegarde hors de cet appareil.'
            : backupState.reminderDays > 0
              ? `Prochain rappel dans ${backupState.dueIn} jour(s).`
              : 'Le rappel automatique est désactivé.'}
        </p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="set-reminder">Fréquence du rappel</label>
          <select id="set-reminder" class="input">
            ${reminderOptions.map(
              (option) => html`<option value="${option.value}" ${Number(settings.backupReminderDays) === option.value ? 'selected' : ''}>${option.label}</option>`,
            )}
          </select>
        </div>
        <label class="flex items-start gap-2 self-end text-sm">
          <input type="checkbox" id="set-auto-backup" class="mt-0.5 h-4 w-4 rounded border-line text-brand" ${settings.autoBackupOnOpen ? 'checked' : ''} />
          <span>
            Télécharger automatiquement une sauvegarde à l’ouverture
            <span class="block text-xs text-muted">Uniquement lorsque le rappel est échu. Le fichier arrive dans les téléchargements du navigateur.</span>
          </span>
        </label>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary btn-sm" data-export-now>Exporter une sauvegarde maintenant</button>
        <button type="button" class="btn-ghost btn-sm" data-restore-now>Restaurer un fichier</button>
      </div>
      <p class="text-xs text-muted">
        Un seul appareil « maître » par commerce : saisissez les opérations sur un appareil, puis exportez pour archiver.
        La synchronisation multi-appareils n’existe pas encore (L1).
      </p>
    </div>
  `);
  qs('#set-reminder', backupForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ backupReminderDays: Number(event.target.value) || 0 }), { successMessage: 'Fréquence de rappel enregistrée.' });
  });
  qs('#set-auto-backup', backupForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ autoBackupOnOpen: event.target.checked }), {
      successMessage: event.target.checked ? 'Sauvegarde automatique activée.' : 'Sauvegarde automatique désactivée.',
    });
  });
  qs('[data-export-now]', backupForm).addEventListener('click', exportBackup);
  qs('[data-restore-now]', backupForm).addEventListener('click', pickBackupFile);
  wrapper.append(
    sectionCard({
      title: 'Rappels de sauvegarde',
      description: 'Réduisez le risque de perte de données (L2).',
      content: backupForm,
    }),
  );

  /* ---------------------------- verrouillage (L6) ----------------------- */
  const lockActive = lockIsEnabled(settings);
  const lockCard = element(html`
    <div class="space-y-3">
      <div class="rounded-lg border ${lockActive ? 'border-brand/30 bg-brand-light/50' : 'border-line bg-canvas/60'} px-3 py-2 text-sm">
        <p class="font-medium text-ink">${lockSummary(settings)}</p>
        <p class="mt-1 text-xs text-muted">
          Le code est enregistré sous forme de condensat (PBKDF2) dans les paramètres locaux. Il n’est jamais transmis.
          Il protège l’accès à l’interface, pas les fichiers d’IndexedDB pour une personne ayant un accès technique à l’appareil.
        </p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="set-lock-timeout">Reverrouillage après inactivité</label>
          <select id="set-lock-timeout" class="input" ${lockActive ? '' : 'disabled'}>
            ${[0, 1, 5, 15, 30, 60].map(
              (minutes) => html`<option value="${minutes}" ${Number(settings.lockTimeoutMinutes) === minutes ? 'selected' : ''}>
                ${minutes === 0 ? 'Uniquement à l’ouverture' : `${minutes} minute(s)`}
              </option>`,
            )}
          </select>
        </div>
        <label class="flex items-start gap-2 self-end text-sm ${lockActive ? '' : 'opacity-50'}">
          <input type="checkbox" id="set-lock-hidden" class="mt-0.5 h-4 w-4 rounded border-line text-brand" ${settings.lockOnHidden ? 'checked' : ''} ${lockActive ? '' : 'disabled'} />
          <span>Verrouiller dès que l’application passe en arrière-plan</span>
        </label>
      </div>
      <div class="flex flex-wrap gap-2">
        ${lockActive
          ? html`
              <button type="button" class="btn-primary btn-sm" data-lock-now>Verrouiller maintenant</button>
              <button type="button" class="btn-ghost btn-sm" data-lock-change>Changer le code PIN</button>
              <button type="button" class="btn-danger btn-sm" data-lock-disable>Désactiver le verrouillage</button>
            `
          : html`<button type="button" class="btn-primary btn-sm" data-lock-enable>Activer le verrouillage</button>`}
      </div>
    </div>
  `);
  const timeoutSelect = qs('#set-lock-timeout', lockCard);
  if (timeoutSelect) {
    timeoutSelect.addEventListener('change', (event) => {
      runAction(() => saveSettings({ lockTimeoutMinutes: Number(event.target.value) || 0 }), { successMessage: 'Délai de reverrouillage enregistré.' });
    });
  }
  const hiddenToggle = qs('#set-lock-hidden', lockCard);
  if (hiddenToggle) {
    hiddenToggle.addEventListener('change', (event) => {
      runAction(() => saveSettings({ lockOnHidden: event.target.checked }), { successMessage: 'Réglage de verrouillage enregistré.' });
    });
  }
  qs('[data-lock-enable]', lockCard)?.addEventListener('click', enableLock);
  qs('[data-lock-disable]', lockCard)?.addEventListener('click', disableLock);
  qs('[data-lock-change]', lockCard)?.addEventListener('click', changeLockPin);
  qs('[data-lock-now]', lockCard)?.addEventListener('click', () => {
    showLockScreen({ settings: getSettings(), reason: 'Verrouillage demandé depuis les paramètres.', onUnlocked: () => {} });
  });
  wrapper.append(sectionCard({ title: 'Verrouillage de l’application', description: 'Code PIN local, sans compte ni serveur.', content: lockCard }));

  /* --------------------------- instantanés (L3/L12) --------------------- */
  const snapshotSlot = element('<p class="text-xs text-muted">Chargement des instantanés…</p>');
  wrapper.append(
    sectionCard({
      title: 'Instantanés de sécurité',
      description: 'Créés avant chaque import : permet d’annuler un import malheureux.',
      content: snapshotSlot,
    }),
  );
  void paintSnapshots(snapshotSlot);

  /* --------------------------- journal d’annulation ---------------------- */
  const undoSlot = element('<p class="text-xs text-muted">Chargement du journal…</p>');
  wrapper.append(
    sectionCard({
      title: 'Dernières opérations',
      description: 'Annulez la dernière saisie en un clic (L12).',
      content: undoSlot,
    }),
  );
  void paintUndoJournal(undoSlot);

  /* ------------------------------- listes ------------------------------- */
  wrapper.append(
    listEditor({
      title: 'Catégories de produits',
      description: 'Proposées lors de la création d’un produit.',
      key: 'productCategories',
      label: 'Nouvelle catégorie',
      values: settings.productCategories || [],
      addAction: saveProductCategory,
      removeAction: removeSettingsEntry,
    }),
  );
  wrapper.append(
    listEditor({
      title: 'Catégories de dépenses',
      description: 'Proposées lors de la saisie d’une dépense.',
      key: 'expenseCategories',
      label: 'Nouvelle catégorie de dépense',
      values: settings.expenseCategories || [],
      addAction: saveExpenseCategory,
      removeAction: removeSettingsEntry,
    }),
  );
  wrapper.append(
    listEditor({
      title: 'Moyens de paiement',
      description: 'Espèces, mobile money, virement…',
      key: 'paymentMethods',
      label: 'Nouveau moyen de paiement',
      values: settings.paymentMethods || [],
      addAction: savePaymentMethod,
      removeAction: removeSettingsEntry,
    }),
  );

  /* ------------------------------ stockage ------------------------------ */
  const storageCard = element(html`
    <div class="space-y-3">
      <p class="text-sm text-ink">
        Les données sont enregistrées dans la base locale du navigateur (IndexedDB)${isIndexedDbSupported() ? '' : ' — indisponible sur ce navigateur'}.
      </p>
      <p class="text-xs text-muted" data-storage-usage>Estimation de l’espace utilisé : calcul en cours…</p>
      <p class="text-xs text-muted" data-env-summary>État du stockage : vérification…</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-ghost" data-persist>Demander un stockage persistant</button>
        <a href="#/aide" class="btn-ghost">Guide &amp; aide</a>
      </div>
    </div>
  `);
  qs('[data-persist]', storageCard).addEventListener('click', async () => {
    await requestPersistence();
  });
  getEnvironmentStatus().then((env) => {
    const slot = qs('[data-env-summary]', storageCard);
    if (!slot) return;
    slot.textContent = environmentSummary(env).join(' ');
  });
  estimateStorage().then((estimate) => {
    const slot = qs('[data-storage-usage]', storageCard);
    if (!slot) return;
    if (!estimate) {
      slot.textContent = 'Estimation de l’espace utilisé : non disponible sur ce navigateur.';
      return;
    }
    const used = typeof estimate.usage === 'number' ? `${(estimate.usage / 1024 / 1024).toFixed(2)} Mo` : '—';
    const quota = typeof estimate.quota === 'number' ? `${(estimate.quota / 1024 / 1024).toFixed(0)} Mo` : '—';
    slot.textContent = `Espace utilisé : ${used} sur environ ${quota} disponibles.`;
  });
  wrapper.append(sectionCard({ title: 'Stockage local', description: 'Emplacement et volume des données.', content: storageCard }));

  /* ----------------------- archivage & purge guidée (L4) ---------------- */
  const volume = dataVolume(state);
  const lastYear = new Date();
  lastYear.setFullYear(lastYear.getFullYear() - 1);
  const defaultCutoff = lastYear.toISOString().slice(0, 10);

  const archiveCard = element(html`
    <div class="space-y-3">
      <p class="text-sm text-ink">
        ${volume.total} document(s) daté(s) au total, du ${volume.oldest || '—'} au ${volume.newest || '—'}.
        Les écrans utilisent un chargement progressif ; cette section permet d’isoler les exercices anciens.
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="purge-cutoff">Archiver tout ce qui est antérieur au</label>
          <input id="purge-cutoff" type="date" class="input" value="${defaultCutoff}" />
          <p class="mt-1 text-xs text-muted">Les ventes et achats encore impayés sont toujours conservés.</p>
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <button type="button" class="btn-ghost" data-archive-export>Exporter l’archive de la période</button>
          <button type="button" class="btn-ghost" data-purge-preview>Prévisualiser la purge</button>
        </div>
      </div>
      <div data-purge-preview-slot></div>
    </div>
  `);

  const previewSlot = qs('[data-purge-preview-slot]', archiveCard);
  const cutoffInput = qs('#purge-cutoff', archiveCard);

  qs('[data-archive-export]', archiveCard).addEventListener('click', () => {
    try {
      const { payload, filename } = buildArchive(state, cutoffInput.value);
      downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json');
      toast(`Archive enregistrée : ${filename}. Conservez-la hors de l’appareil avant toute purge.`, 'success', { duration: 8000 });
    } catch (error) {
      toast(error && error.message ? error.message : 'Export de l’archive impossible.', 'error', { duration: 7000 });
    }
  });

  qs('[data-purge-preview]', archiveCard).addEventListener('click', () => {
    try {
      const plan = planPurge(state, cutoffInput.value);
      const lines = [
        ['Ventes', plan.deletions.sales.length],
        ['Achats', plan.deletions.purchases.length],
        ['Retours', plan.deletions.returns.length],
        ['Dépenses', plan.deletions.expenses.length],
        ['Paiements', plan.deletions.payments.length],
        ['Mouvements de trésorerie', plan.deletions.cashMovements.length],
      ];
      if (plan.deletedTotal === 0) {
        previewSlot.replaceChildren(
          noticePanel({
            tone: 'info',
            title: 'Rien à archiver',
            message: 'Aucun document antérieur à cette date ne peut être purgé. Les pièces encore ouvertes sont conservées.',
          }),
        );
        return;
      }
      const preview = element(html`
        <div class="space-y-3 rounded-lg border border-line bg-canvas/60 p-3">
          <p class="text-sm font-semibold text-ink">${plan.deletedTotal} document(s) seraient archivés et retirés du quotidien.</p>
          <ul class="grid gap-1 text-xs text-muted sm:grid-cols-2">
            ${lines.map(([label, count]) => html`<li class="flex justify-between gap-2"><span>${label}</span><strong class="text-ink">${count}</strong></li>`)}
          </ul>
          <p class="text-xs text-muted">
            Conservés : ${plan.kept.sales} vente(s) ouverte(s), ${plan.kept.purchases} achat(s) ouvert(s),
            ${plan.kept.expenses} dépense(s) récente(s).
            L’historique des mouvements de stock est conservé pour garantir la valorisation exacte ;
            ${plan.openingCashMovements.length} mouvement(s) d’ouverture de trésorerie seront créés pour préserver les soldes.
          </p>
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" class="mt-0.5 h-4 w-4 rounded border-line text-brand" data-purge-backup />
            <span>J’ai exporté une sauvegarde ou l’archive de la période et je l’ai conservée hors de cet appareil.</span>
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" class="mt-0.5 h-4 w-4 rounded border-line text-brand" data-purge-snapshot checked />
            <span>Créer un instantané complet avant la purge (recommandé, annulable depuis les instantanés).</span>
          </label>
          <div>
            <label class="label" for="purge-confirm">Tapez « ARCHIVER » pour confirmer</label>
            <input id="purge-confirm" class="input max-w-xs" type="text" autocomplete="off" placeholder="ARCHIVER" />
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-danger" data-purge-apply>Archiver et purger</button>
          </div>
        </div>
      `);

      qs('[data-purge-apply]', preview).addEventListener('click', async () => {
        if (!qs('[data-purge-backup]', preview).checked) {
          toast('Cochez la case confirmant l’export d’une sauvegarde.', 'warning', { duration: 6000 });
          return;
        }
        if (qs('#purge-confirm', preview).value.trim().toUpperCase() !== 'ARCHIVER') {
          toast('Tapez « ARCHIVER » pour confirmer.', 'warning');
          return;
        }
        const confirmed = await confirmDialog({
          title: 'Archiver et purger ces documents ?',
          message: `${plan.deletedTotal} document(s) antérieurs au ${plan.cutoff} seront retirés de l’application.`,
          details: 'Les soldes de stock et de trésorerie sont reportés en ouverture. Les pièces impayées restent. Un instantané permet d’annuler depuis cette page.',
          confirmLabel: 'Archiver et purger',
        });
        if (!confirmed) return;
        const result = await runAction(
          () => applyPurge(state, plan, { snapshot: qs('[data-purge-snapshot]', preview).checked, label: `Avant archivage au ${plan.cutoff}` }),
          { successMessage: 'Archivage terminé.', duration: 8000 },
        );
        if (result) {
          previewSlot.replaceChildren(
            noticePanel({
              tone: 'success',
              title: 'Archivage terminé',
              message: `${result.deleted} document(s) retiré(s). ${result.openingCashMovements} mouvement(s) d’ouverture de trésorerie ont été créés ; l’historique de stock est conservé.`,
            }),
          );
          toast('Les soldes de stock et de trésorerie sont conservés.', 'info', { duration: 7000 });
        }
      });

      previewSlot.replaceChildren(preview);
    } catch (error) {
      previewSlot.replaceChildren();
      toast(error && error.message ? error.message : 'Prévisualisation impossible.', 'error', { duration: 7000 });
    }
  });

  wrapper.append(
    sectionCard({
      title: 'Archivage par exercice',
      description: 'Clôturez les périodes anciennes sans perdre les soldes (L4).',
      content: archiveCard,
    }),
  );

  /* ------------------------------- à propos ----------------------------- */
  wrapper.append(
    sectionCard({
      title: 'À propos',
      content: element(html`
        <div class="grid gap-2 text-sm sm:grid-cols-2">
          <p>Application : <strong>${APP_NAME}</strong></p>
          <p>Version : <strong>${APP_VERSION}</strong></p>
          <p>Version du schéma : <strong>${SCHEMA_VERSION}</strong></p>
          <p>Devise : <strong>${CURRENCY_SYMBOL}</strong></p>
          <p>Activités : <strong>${state.activities.length}</strong></p>
          <p>Produits : <strong>${state.products.length}</strong></p>
          <p>Ventes : <strong>${state.sales.length}</strong></p>
          <p>Achats : <strong>${state.purchases.length}</strong></p>
        </div>
        <p class="mt-3 text-xs text-muted">
          Application hors ligne : les calculs sont effectués sur cet appareil et ne remplacent ni un comptable ni un logiciel certifié.
        </p>
        <p class="mt-2 rounded-lg border border-warning/30 bg-amber-50 px-3 py-2 text-xs text-ink">${ACCOUNTING_DISCLAIMER}</p>
      `),
    }),
  );

  /* --------------------------- zone dangereuse -------------------------- */
  const danger = element(html`
    <div class="space-y-3">
      <p class="text-sm text-ink">
        La réinitialisation efface toutes les activités, produits, ventes, achats, dépenses et mouvements de trésorerie de cet appareil.
      </p>
      <p class="text-xs text-muted">Pensez à exporter une sauvegarde JSON avant de continuer.</p>
      <button type="button" class="btn-danger" data-reset>Réinitialiser toutes les données</button>
    </div>
  `);
  qs('[data-reset]', danger).addEventListener('click', () => resetAllData());
  wrapper.append(sectionCard({ title: 'Zone sensible', description: 'Opération irréversible.', className: 'border-danger/40', content: danger }));

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: false, paint: () => paint(ctx) }).root; } };

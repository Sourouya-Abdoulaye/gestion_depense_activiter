/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Paramètres & sauvegardes »
 *
 * Identité du commerce, listes de référence, préférences de gestion, sauvegarde
 * et restauration des données locales, informations de stockage et zone de
 * réinitialisation. Aucune donnée n'est envoyée sur Internet.
 * ------------------------------------------------------------------------- */

import { APP_NAME, APP_VERSION, SCHEMA_VERSION, DATE_FORMATS, CURRENCY_SYMBOL } from '../config/constants.js';
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
import { buildBackup, buildBackupFilename, mergeBackup, replaceBackup, validateBackup } from '../services/backup.js';
import { isIndexedDbSupported } from '../database/db.js';

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

/* ------------------------------- sauvegarde ----------------------------- */

function exportBackup() {
  const state = getState();
  const payload = buildBackup(state);
  const filename = buildBackupFilename();
  downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json');
  runAction(() => markBackupExported(), { silent: true });
  toast(`Sauvegarde enregistrée : ${filename}`, 'success', { duration: 6000 });
}

function importBackup(payload) {
  const validation = validateBackup(payload);
  if (!validation.valid) {
    toast(validation.errors[0] || 'Sauvegarde invalide.', 'error', { duration: 7000 });
    return;
  }

  const preview = validation.preview || {};
  const counts = preview.counts || {};

  const body = element(html`
    <div class="space-y-3">
      <div class="grid gap-2 text-sm sm:grid-cols-2">
        <p>Application : <strong>${preview.application || APP_NAME}</strong></p>
        <p>Version : <strong>${preview.appVersion || 'inconnue'}</strong></p>
        <p>Exportée le : <strong>${preview.exportedAt ? formatStamp(preview.exportedAt) : '—'}</strong></p>
        <p>Schéma : <strong>${preview.schemaVersion ?? '—'}</strong></p>
      </div>
      <div class="table-wrap">
        <table class="table table-stack">
          <thead><tr><th>Collection</th><th class="text-right">Enregistrements</th></tr></thead>
          <tbody>
            ${Object.entries(counts).map(
              ([name, count]) => html`<tr><td data-label="Collection">${name}</td><td data-label="Enregistrements" class="text-right">${count}</td></tr>`,
            )}
          </tbody>
        </table>
      </div>
      ${validation.warnings.length > 0
        ? html`<div class="rounded-lg border border-warning/30 bg-amber-50 px-3 py-2 text-xs text-ink">
            <p class="font-semibold text-warning">Avertissements</p>
            <ul class="mt-1 list-disc space-y-0.5 pl-5">${validation.warnings.map((warning) => html`<li>${warning}</li>`)}</ul>
          </div>`
        : ''}
      <div class="rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-xs text-ink">
        <p class="font-semibold text-danger">Avant de continuer</p>
        <p>La fusion ajoute les enregistrements absents et met à jour ceux de même identifiant. Le remplacement efface d’abord toutes les données actuelles de cet appareil.</p>
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
          const { data, stats } = mergeBackup(current, (validation.normalized && validation.normalized.data) || {});
          const result = await runAction(() => replaceState(data), {
            successMessage: `Fusion terminée : ${stats.added} ajout(s), ${stats.updated} mise(s) à jour.`,
          });
          return Boolean(result) || true;
        },
      },
      {
        label: 'Remplacer',
        variant: 'danger',
        onClick: async () => {
          const current = getState();
          const { data } = replaceBackup(current, (validation.normalized && validation.normalized.data) || {});
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
    importBackup(payload);
  });
  input.click();
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
  await runAction(() => saveSettings({ onboardingDone: true }), { silent: true });
  toast('Toutes les données ont été effacées.', 'success', { duration: 6000 });
  window.location.hash = '#/tableau-de-bord';
}

/* ------------------------------- stockage ------------------------------- */

async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) {
    toast('Ce navigateur ne propose pas le stockage persistant.', 'warning');
    return;
  }
  const granted = await navigator.storage.persist();
  toast(granted ? 'Stockage persistant accordé.' : 'Le navigateur a refusé le stockage persistant.', granted ? 'success' : 'warning');
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
    </form>
  `);

  qs('#set-shop-name', identityForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ shopName: event.target.value.trim() }), { successMessage: 'Nom du commerce enregistré.' });
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

  wrapper.append(sectionCard({ title: 'Identité du commerce', description: 'Nom affiché et logo.', content: identityForm }));

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
  qs('#set-negative-stock', preferencesForm).addEventListener('change', (event) => {
    runAction(() => saveSettings({ allowNegativeStock: event.target.checked }), {
      successMessage: event.target.checked ? 'Stock négatif autorisé.' : 'Stock négatif interdit.',
    });
  });

  wrapper.append(sectionCard({ title: 'Préférences de gestion', description: 'Ces réglages influencent les formulaires et les contrôles.', content: preferencesForm }));

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
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-ghost" data-persist>Demander un stockage persistant</button>
      </div>
    </div>
  `);
  qs('[data-persist]', storageCard).addEventListener('click', () => requestPersistence());
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

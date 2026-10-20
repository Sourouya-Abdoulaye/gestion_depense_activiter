/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Import de relevés » (L21)
 *
 * Rapprochement manuel : l'utilisateur dépose un CSV exporté par sa banque ou
 * son opérateur mobile money. Aucune connexion externe n'est effectuée. Les
 * colonnes sont détectées puis vérifiées, les doublons sont ignorés.
 * ------------------------------------------------------------------------- */

import { html, element, qs } from '../shared/dom.js';
import { formatMoney } from '../shared/format.js';
import { formatDate, formatStamp } from '../shared/dates.js';
import { getFilters } from '../shared/view-state.js';
import { createPage } from '../shared/screen.js';
import {
  button,
  confirmDialog,
  emptyState,
  noticePanel,
  optionsFrom,
  pageHeader,
  runAction,
  sectionCard,
  toast,
} from '../shared/ui.js';
import { readTextFile } from '../shared/dom.js';
import { getSettings, getState } from '../services/state.js';
import { importStatementLines } from '../services/actions.js';
import {
  buildImportLines,
  detectColumns,
  parseStatementCsv,
  summarizeImportLines,
} from '../services/bank-import.js';

export const meta = { path: 'imports', title: 'Import de relevés' };

const MAX_PREVIEW = 25;

function mappingFields(columns) {
  return [
    { key: 'date', label: 'Colonne « date »', required: true },
    { key: 'label', label: 'Colonne « libellé »', required: true },
    { key: 'debit', label: 'Colonne « débit / sortie »', required: false },
    { key: 'credit', label: 'Colonne « crédit / entrée »', required: false },
    { key: 'amount', label: 'Colonne « montant » (si pas débit/crédit)', required: false },
    { key: 'direction', label: 'Colonne « sens » (si montant non signé)', required: false },
  ].map((entry) => ({ ...entry, value: columns[entry.key] || '' }));
}

function paint() {
  const state = getState();
  const settings = getSettings();
  const filters = getFilters();
  const wrapper = element('<div class="space-y-4"></div>');

  if (state.activities.length === 0) {
    wrapper.append(pageHeader({ title: 'Import de relevés' }));
    wrapper.append(
      emptyState({
        title: 'Créez d’abord une activité',
        message: 'L’import rattache les lignes à une activité et à un compte de trésorerie.',
        actionLabel: 'Créer une activité',
        iconName: 'activity',
        onAction: () => { window.location.hash = '#/activites'; },
      }),
    );
    return wrapper;
  }

  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  if (accounts.length === 0) {
    wrapper.append(pageHeader({ title: 'Import de relevés' }));
    wrapper.append(
      emptyState({
        title: 'Aucun compte de trésorerie',
        message: 'Créez un compte de caisse, mobile money ou banque avant d’importer un relevé.',
        actionLabel: 'Ouvrir la trésorerie',
        iconName: 'banknote',
        onAction: () => { window.location.hash = '#/tresorerie'; },
      }),
    );
    return wrapper;
  }

  wrapper.append(
    pageHeader({
      title: 'Import de relevés',
      subtitle: 'Rapprochez un export CSV de banque ou de mobile money, sans connexion externe.',
    }),
  );

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Comment ça marche',
      items: [
        'Exportez un relevé CSV depuis votre banque ou votre opérateur (Flooz, TMoney…).',
        'Déposez le fichier : il est lu localement, jamais envoyé sur Internet.',
        'Vérifiez les colonnes détectées et l’aperçu, puis choisissez ce que chaque ligne devient.',
        'Les lignes déjà importées (même date, sens, montant et libellé) sont automatiquement ignorées.',
      ],
    }),
  );

  /* --------------------------- choix du fichier -------------------------- */
  const fileInput = element(html`<input type="file" accept=".csv,.txt,text/csv,text/plain" class="text-sm" />`);
  const fileCardContent = element(html`
    <div class="space-y-3">
      <p class="text-xs text-muted">Taille conseillée : moins de 5 000 lignes par fichier. Pour un gros relevé, découpez-le par mois.</p>
    </div>
  `);
  fileCardContent.prepend(fileInput);
  const fileCard = sectionCard({
    title: '1. Déposer le relevé',
    description: 'Formats acceptés : CSV séparé par point-virgule, virgule ou tabulation (UTF-8).',
    content: fileCardContent,
  });
  wrapper.append(fileCard);

  const workSlot = element('<div class="space-y-4"></div>');
  wrapper.append(workSlot);

  let parsed = null;
  let mapping = null;
  let columns = [];

  function currentLines() {
    if (!parsed || !mapping) return { lines: [], skipped: 0 };
    return buildImportLines(parsed.records, mapping);
  }

  function renderPreview() {
    workSlot.replaceChildren();
    if (!parsed) return;
    const { lines, skipped } = currentLines();
    const summary = summarizeImportLines(lines);

    if (lines.length === 0) {
      workSlot.append(
        noticePanel({
          tone: 'warning',
          title: 'Aucune ligne exploitable',
          message: 'Vérifiez les colonnes de date et de montant. Les lignes sans date valide ou sans montant sont ignorées.',
        }),
      );
      return;
    }

    const mappingForm = element(html`
      <form novalidate class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        ${mappingFields(columns).map(
          (entry) => html`
            <div>
              <label class="label" for="map-${entry.key}">${entry.label}${entry.required ? html` <span class="text-danger">*</span>` : ''}</label>
              <select id="map-${entry.key}" class="input" data-map="${entry.key}">
                <option value="">— Non utilisée —</option>
                ${parsed.headers.map(
                  (header) => html`<option value="${header}" ${header === entry.value ? 'selected' : ''}>${header}</option>`,
                )}
              </select>
            </div>
          `,
        )}
      </form>
    `);

    mappingForm.addEventListener('change', (event) => {
      const target = event.target.closest('[data-map]');
      if (!target) return;
      mapping = { ...mapping, [target.dataset.map]: target.value };
      renderPreview();
    });

    const targetForm = element(html`
      <form novalidate class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label class="label" for="import-account">Compte à rapprocher</label>
          <select id="import-account" class="input">
            ${accounts.map((account) => html`<option value="${account.id}">${account.name}</option>`)}
          </select>
        </div>
        <div>
          <label class="label" for="import-activity">Activité</label>
          <select id="import-activity" class="input">
            ${optionsFrom(
              state.activities.map((activity) => ({ value: activity.id, label: activity.name })),
            )}
          </select>
        </div>
        <div>
          <label class="label" for="import-mode">Traitement des lignes</label>
          <select id="import-mode" class="input">
            <option value="cash">Mouvements de trésorerie (recommandé)</option>
            <option value="expense">Sorties = dépenses d’exploitation, entrées = trésorerie</option>
          </select>
          <p class="mt-1 text-xs text-muted">Le mode « dépenses » influence le résultat ; vérifiez chaque libellé.</p>
        </div>
      </form>
    `);
    const activitySelect = qs('#import-activity', targetForm);
    if (filters.activityId) activitySelect.value = filters.activityId;
    if (!activitySelect.value) activitySelect.value = state.activities[0]?.id || '';

    const previewRows = lines.slice(0, MAX_PREVIEW);
    const preview = element(html`
      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span class="badge badge-neutral">${summary.count} ligne(s) exploitable(s)</span>
          ${skipped > 0 ? html`<span class="badge badge-warning">${skipped} ignorée(s)</span>` : ''}
          <span>Entrées : <strong class="text-brand-dark">${formatMoney(summary.inflow)}</strong></span>
          <span>Sorties : <strong class="text-danger">${formatMoney(summary.outflow)}</strong></span>
        </div>
        <div class="table-wrap">
          <table class="table table-stack">
            <thead><tr><th>Date</th><th>Libellé</th><th>Sens</th><th class="text-right">Montant</th></tr></thead>
            <tbody>
              ${previewRows.map(
                (line) => html`
                  <tr>
                    <td data-label="Date">${formatDate(line.date)}</td>
                    <td data-label="Libellé">${line.label}</td>
                    <td data-label="Sens">
                      <span class="badge ${line.direction === 'in' ? 'badge-success' : 'badge-danger'}">${line.direction === 'in' ? 'Entrée' : 'Sortie'}</span>
                    </td>
                    <td data-label="Montant" class="text-right tabular-nums font-semibold">${formatMoney(line.amount)}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
        ${lines.length > previewRows.length
          ? html`<p class="text-xs text-muted">Aperçu limité aux ${MAX_PREVIEW} premières lignes ; les ${lines.length - previewRows.length} autres seront importées après validation.</p>`
          : ''}
      </div>
    `);

    const importButton = button({
      label: `Importer ${summary.count} ligne(s)`,
      iconName: 'upload',
      variant: 'primary',
      onClick: async () => {
        const accountId = qs('#import-account', targetForm).value;
        const activityId = activitySelect.value;
        const mode = qs('#import-mode', targetForm).value;
        const confirmed = await confirmDialog({
          title: 'Importer ces lignes ?',
          message: `${summary.count} ligne(s) seront ajoutées à la trésorerie${mode === 'expense' ? ' et aux dépenses pour les sorties' : ''}.`,
          details: `Entrées ${formatMoney(summary.inflow)}, sorties ${formatMoney(summary.outflow)}. Les doublons déjà importés seront ignorés. Un instantané n’est pas créé : vérifiez l’aperçu avant de confirmer.`,
          confirmLabel: 'Importer',
        });
        if (!confirmed) return;
        const result = await runAction(
          () => importStatementLines({ lines, accountId, activityId, mode }),
          { successMessage: 'Relevé importé.', duration: 7000 },
        );
        if (!result) return;
        const skippedText = result.skipped > 0 ? ` ${result.skipped} doublon(s) ignoré(s).` : '';
        toast(`${result.imported} ligne(s) importée(s).${skippedText}`, result.skipped > 0 ? 'warning' : 'success', { duration: 8000 });
        workSlot.replaceChildren(
          noticePanel({
            tone: 'success',
            title: 'Import terminé',
            message: `${result.imported} ligne(s) ajoutée(s).${skippedText} Retrouvez-les dans la trésorerie${mode === 'expense' ? ' et les dépenses' : ''}.`,
          }),
        );
        fileInput.value = '';
        parsed = null;
      },
    });

    const destinationContent = element('<div class="space-y-4"></div>');
    const actionRow = element('<div class="flex justify-end"></div>');
    actionRow.append(importButton);
    destinationContent.append(targetForm, preview, actionRow);

    workSlot.append(
      sectionCard({
        title: '2. Vérifier les colonnes',
        description: 'Les colonnes sont détectées automatiquement ; corrigez si nécessaire.',
        content: mappingForm,
      }),
      sectionCard({
        title: '3. Choisir la destination',
        description: 'Compte, activité et traitement comptable des lignes.',
        content: destinationContent,
      }),
    );
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const text = await readTextFile(file);
      parsed = parseStatementCsv(text);
      columns = parsed.headers;
      mapping = detectColumns(columns);
      if (!mapping.date || (!mapping.amount && !mapping.debit && !mapping.credit)) {
        toast('Colonnes de date ou de montant non détectées : sélectionnez-les manuellement.', 'warning', { duration: 7000 });
      }
      if (parsed.errors.length > 0) {
        toast(`Fichier lu avec ${parsed.errors.length} avertissement(s) de format.`, 'warning', { duration: 6000 });
      }
      renderPreview();
    } catch (error) {
      parsed = null;
      workSlot.replaceChildren();
      toast(error && error.message ? error.message : 'Lecture du fichier impossible.', 'error', { duration: 7000 });
    }
  });

  const lastImport = settings.lastBankImportAt
    ? `Dernier import : ${formatStamp(settings.lastBankImportAt)} (${settings.lastBankImportCount || 0} ligne(s)).`
    : 'Aucun import de relevé pour le moment.';

  wrapper.append(
    sectionCard({
      title: 'Bon à savoir',
      description: lastImport,
      content: element(html`
        <ul class="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Un import ne remplace pas un rapprochement bancaire : vérifiez le solde du compte après import.</li>
          <li>Le mode « mouvements de trésorerie » ne modifie pas le résultat ; le mode « dépenses » enregistre des charges.</li>
          <li>Les lignes importées peuvent être annulées avec « Annuler la dernière opération » dans les paramètres.</li>
          <li>Les agrégateurs bancaires automatiques (API) ne sont pas disponibles : il s’agit d’un import de fichier.</li>
        </ul>
      `),
    }),
  );

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint }).root; } };

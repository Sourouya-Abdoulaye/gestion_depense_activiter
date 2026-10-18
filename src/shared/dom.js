/* ---------------------------------------------------------------------------
 * Mon Commerce — utilitaires DOM
 * Petits helpers sans dépendance pour construire l'interface : gabarits
 * échappés automatiquement, création de nœuds, écouteurs d'événements.
 * ------------------------------------------------------------------------- */

import { escapeHtml } from './format.js';

/**
 * Marque une chaîne comme déjà sûre (composée à partir de gabarits échappés).
 * L'objet renvoyé est converti en texte à la demande (toString) : il peut donc
 * être interpolé dans un gabarit, mais aussi utilisé dans un tableau, par
 * exemple `.map((ligne) => html`…`).join('')`.
 */
export function raw(value) {
  const markup = String(value ?? '');
  return {
    __html: markup,
    toString() {
      return markup;
    },
  };
}

/**
 * Gabarit HTML : toute valeur interpolée est échappée automatiquement.
 * Utiliser raw() pour insérer un fragment déjà construit.
 */
export function html(strings, ...values) {
  let output = strings[0];
  values.forEach((value, index) => {
    if (value === null || value === undefined || value === false) {
      output += '';
    } else if (typeof value === 'object' && value.__html) {
      output += value.__html;
    } else if (Array.isArray(value)) {
      output += value
        .map((item) => (item && typeof item === 'object' && item.__html ? item.__html : escapeHtml(item)))
        .join('');
    } else {
      output += escapeHtml(value);
    }
    output += strings[index + 1];
  });
  return raw(output);
}

/** Convertit un gabarit (ou une chaîne) en fragment DOM. */
export function fragment(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup && markup.__html ? markup.__html : String(markup ?? '');
  return template.content;
}

/** Convertit un gabarit en élément unique. */
export function element(markup) {
  const content = fragment(markup);
  const first = content.firstElementChild;
  if (!first) throw new Error('Le gabarit ne contient aucun élément.');
  content.removeChild(first);
  return first;
}

export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

export function qsa(selector, scope = document) {
  return [...scope.querySelectorAll(selector)];
}

/** Pose un élément dans un parent en remplaçant son contenu. */
export function mount(parent, content) {
  parent.replaceChildren();
  if (typeof content === 'string') {
    parent.append(fragment(content));
  } else if (content && content.__html) {
    parent.append(fragment(content));
  } else if (content instanceof Node) {
    parent.append(content);
  }
  return parent;
}

/** Écouteur d'événements avec délégation sur un sélecteur. */
export function delegate(scope, eventName, selector, handler) {
  const listener = (event) => {
    const target = event.target.closest(selector);
    if (!target || !scope.contains(target)) return;
    handler(event, target);
  };
  scope.addEventListener(eventName, listener);
  return () => scope.removeEventListener(eventName, listener);
}

/** Lit et nettoie les valeurs d'un formulaire. */
export function formValues(form) {
  const values = {};
  for (const field of form.elements) {
    if (!field.name || field.disabled) continue;
    if (field.type === 'checkbox') {
      values[field.name] = field.checked;
    } else if (field.type === 'radio') {
      if (field.checked) values[field.name] = field.value;
    } else if (field.type === 'file') {
      values[field.name] = field.files[0] || null;
    } else {
      values[field.name] = field.value;
    }
  }
  return values;
}

/** Remplit un formulaire à partir d'un objet. */
export function fillForm(form, values = {}) {
  for (const field of form.elements) {
    if (!field.name || !(field.name in values)) continue;
    const value = values[field.name];
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value === null || value === undefined ? '' : value;
  }
}

/** Affiche les erreurs de validation sous les champs d'un formulaire. */
export function showFieldErrors(form, errors = {}) {
  qsa('[data-error-for]', form).forEach((node) => node.remove());
  for (const [name, message] of Object.entries(errors)) {
    const field = form.elements[name];
    if (!field) continue;
    const error = document.createElement('p');
    error.className = 'field-error';
    error.dataset.errorFor = name;
    error.textContent = message;
    field.insertAdjacentElement('afterend', error);
    field.setAttribute('aria-invalid', 'true');
  }
  const firstField = Object.keys(errors)[0];
  if (firstField && form.elements[firstField]) form.elements[firstField].focus();
}

export function clearFieldErrors(form) {
  qsa('[data-error-for]', form).forEach((node) => node.remove());
  qsa('[aria-invalid]', form).forEach((node) => node.removeAttribute('aria-invalid'));
}

/** Empêche les doubles soumissions : désactive le bouton le temps de l'action. */
export async function guardSubmit(button, action) {
  if (!button || button.dataset.busy === 'true') return undefined;
  const previous = button.innerHTML;
  button.dataset.busy = 'true';
  button.disabled = true;
  button.innerHTML = 'Traitement…';
  try {
    return await action();
  } finally {
    button.dataset.busy = 'false';
    button.disabled = false;
    button.innerHTML = previous;
  }
}

/** Télécharge un contenu texte ou binaire. */
export function downloadFile(filename, content, mimeType = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Lit un fichier texte choisi par l'utilisateur. */
export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible.'));
    reader.readAsText(file);
  });
}

/** Vide un conteneur (utilisé pour les nettoyages). */
export function clear(node) {
  if (node) node.replaceChildren();
}

/* ---------------------------------------------------------------------------
 * Mon Commerce — interface de chat de l'assistant
 *
 * Composant réutilisable :
 *   • version « page » dans Assistant & aide ;
 *   • version « flottante » disponible sur tous les écrans.
 *
 * L'interface ne fait aucun appel réseau. Elle lit le contexte (période,
 * activité, état) au moment de la question et délègue la réponse au service
 * local `assistant.js`.
 * ------------------------------------------------------------------------- */

import { html, element, qs, raw } from './dom.js';
import { icon } from './icons.js';
import { formatDate } from './dates.js';
import { getPeriod, getViewState } from './view-state.js';
import { currentActivity, getState } from '../services/state.js';
import { periodLabel } from '../services/reports.js';
import { answerQuestion, getWelcomeMessage, QUICK_QUESTIONS } from '../services/assistant.js';

const histories = {
  page: null,
  floating: null,
};

function historyFor(variant) {
  if (!Array.isArray(histories[variant])) histories[variant] = [getWelcomeMessage()];
  return histories[variant];
}

function buildContext() {
  const state = getState();
  const view = getViewState();
  const period = getPeriod();
  const activityId = view.activityId || '';
  const activity = activityId
    ? (state.activities || []).find((entry) => entry.id === activityId) || null
    : currentActivity();

  return {
    state,
    period,
    periodLabel: periodLabel(period, formatDate),
    activityId,
    activity,
    now: new Date(),
  };
}

/**
 * Crée une conversation.
 * @param {{variant?: 'page'|'floating', onNavigate?: Function, onClose?: Function, className?: string}} options
 */
export function createAssistantChat({ variant = 'page', onNavigate = null, onClose = null, className = '' } = {}) {
  const messages = historyFor(variant);
  let busy = false;
  let pendingTimer = null;
  let pendingAnswer = null;

  const root = element(html`
    <section
      class="flex h-full min-h-0 scroll-mt-20 flex-col overflow-hidden rounded-card border border-line bg-white ${className}"
      aria-label="Assistant Mon Commerce"
    >
      <header class="flex items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-light text-brand-dark">
          ${raw(icon('help', { size: 18 }))}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[13px] font-semibold text-brand-dark">Assistant</p>
          <p class="flex items-center gap-1 text-[0.65rem] text-muted">
            <span class="h-1.5 w-1.5 rounded-full bg-brand"></span>
            Réponses basées sur vos données
          </p>
        </div>
        <button type="button" class="btn-ghost btn-sm" data-chat-reset aria-label="Nouvelle conversation" title="Nouvelle conversation">
          ${raw(icon('refresh', { size: 15 }))}
        </button>
        ${onClose
          ? html`<button type="button" class="btn-ghost btn-sm" data-chat-close aria-label="Fermer l’assistant" title="Fermer">
              ${raw(icon('close', { size: 15 }))}
            </button>`
          : ''}
      </header>

      <div
        class="scroll-thin flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5 sm:px-4"
        data-chat-messages
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation avec l’assistant"
      ></div>

      <div class="border-t border-line px-3 pt-2 sm:px-4">
        <div class="chat-chips flex gap-2 overflow-x-auto pb-2" data-chat-suggestions aria-label="Questions suggérées"></div>
        <form class="flex items-center gap-2 pb-2" data-chat-form>
          <input
            type="text"
            class="input min-w-0 flex-1 text-[13px]"
            maxlength="500"
            autocomplete="off"
            placeholder="Écrivez votre question…"
            aria-label="Votre question"
            data-chat-input
          />
          <button type="submit" class="btn-primary h-10 w-10 shrink-0 p-0" aria-label="Envoyer la question" data-chat-send>
            ${raw(icon('send', { size: 17 }))}
          </button>
        </form>
        <p class="pb-2 text-[0.62rem] leading-snug text-muted">Assistant local · aucune donnée envoyée.</p>
      </div>
    </section>
  `);

  const messagesEl = qs('[data-chat-messages]', root);
  const suggestionsEl = qs('[data-chat-suggestions]', root);
  const form = qs('[data-chat-form]', root);
  const input = qs('[data-chat-input]', root);
  const sendButton = qs('[data-chat-send]', root);

  function scrollToBottom() {
    window.requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function suggestionChip(label) {
    return element(html`
      <button
        type="button"
        class="shrink-0 rounded-full border border-line bg-canvas px-2.5 py-1 text-left text-[11px] font-medium text-ink hover:border-brand hover:bg-brand-light hover:text-brand-dark"
        data-suggestion="${label}"
      >${label}</button>
    `);
  }

  function renderSuggestions() {
    suggestionsEl.replaceChildren(...QUICK_QUESTIONS.slice(0, 4).map((question) => suggestionChip(question)));
    suggestionsEl.classList.toggle('hidden', messages.length > 1);
  }

  function answerNode(message) {
    const bubble = element(html`
      <div class="flex items-start gap-2.5">
        <span class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-light text-brand-dark">
          ${raw(icon('help', { size: 14 }))}
        </span>
        <div class="min-w-0 max-w-[90%] rounded-2xl rounded-tl-md border border-line bg-canvas/70 px-3 py-2 text-[13px] leading-relaxed text-ink sm:max-w-[84%]">
          ${message.headline ? html`<p class="text-[13px] font-semibold text-brand-dark">${message.headline}</p>` : ''}
          ${message.text ? html`<p class="${message.headline ? 'mt-1' : ''} whitespace-pre-line">${message.text}</p>` : ''}
          ${message.bullets && message.bullets.length > 0
            ? html`<ul class="mt-1.5 list-disc space-y-0.5 pl-4 text-[12px] sm:text-[13px]">
                ${message.bullets.map((item) => html`<li>${item}</li>`)}
              </ul>`
            : ''}
          ${message.links && message.links.length > 0
            ? html`<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                ${message.links.map(
                  (link) => html`<button type="button" class="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:text-brand-dark" data-chat-link="${link.path}">
                    ${link.label} ${raw(icon('arrowRight', { size: 12 }))}
                  </button>`,
                )}
              </div>`
            : ''}
          ${message.isFallback && message.followUps && message.followUps.length > 0
            ? html`<div class="mt-2 flex flex-wrap gap-1.5">
                ${message.followUps.map(
                  (question) => html`<button
                    type="button"
                    class="rounded-full bg-white px-2.5 py-1 text-left text-[0.68rem] font-medium text-brand-dark ring-1 ring-line hover:ring-brand"
                    data-follow-up="${question}"
                  >${question}</button>`,
                )}
              </div>`
            : ''}
        </div>
      </div>
    `);
    return bubble;
  }

  function userNode(message) {
    return element(html`
      <div class="flex justify-end">
        <div class="max-w-[90%] whitespace-pre-line rounded-2xl rounded-tr-md bg-brand px-3 py-2 text-[13px] leading-relaxed text-white sm:max-w-[80%]">
          ${message.text}
        </div>
      </div>
    `);
  }

  function typingNode() {
    return element(html`
      <div class="flex items-start gap-2.5" data-chat-typing>
        <span class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-light text-brand-dark">
          ${raw(icon('help', { size: 14 }))}
        </span>
        <div class="rounded-2xl rounded-tl-md border border-line bg-canvas/70 px-3 py-2.5" aria-label="L’assistant écrit">
          <span class="flex gap-1">
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-muted"></span>
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:120ms]"></span>
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:240ms]"></span>
          </span>
        </div>
      </div>
    `);
  }

  function renderAll() {
    const nodes = messages.map((message) => (message.role === 'user' ? userNode(message) : answerNode(message)));
    messagesEl.replaceChildren(...nodes);
    renderSuggestions();
    scrollToBottom();
  }

  function append(message) {
    messagesEl.append(message.role === 'user' ? userNode(message) : answerNode(message));
    renderSuggestions();
    scrollToBottom();
  }

  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
  }

  function answerText(text) {
    const question = String(text || '').trim().slice(0, 500);
    if (!question || busy) return;

    const userMessage = { role: 'user', text: question };
    messages.push(userMessage);
    append(userMessage);
    input.value = '';
    setBusy(true);

    const typing = typingNode();
    messagesEl.append(typing);
    scrollToBottom();

    const answer = answerQuestion(question, buildContext());
    pendingAnswer = answer;
    const delay = Math.min(650, 260 + question.length * 4);

    pendingTimer = window.setTimeout(() => {
      pendingTimer = null;
      pendingAnswer = null;
      typing.remove();
      messages.push({ role: 'assistant', ...answer });
      append({ role: 'assistant', ...answer });
      setBusy(false);
    }, delay);
  }

  renderSuggestions();
  renderAll();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    answerText(input.value);
  });

  suggestionsEl.addEventListener('click', (event) => {
    const target = event.target.closest('[data-suggestion]');
    if (!target) return;
    answerText(target.dataset.suggestion);
  });

  messagesEl.addEventListener('click', (event) => {
    const link = event.target.closest('[data-chat-link]');
    if (link) {
      if (typeof onNavigate === 'function') onNavigate(link.dataset.chatLink);
      if (typeof onClose === 'function') onClose();
      return;
    }
    const followUp = event.target.closest('[data-follow-up]');
    if (followUp) answerText(followUp.dataset.followUp);
  });

  const reset = () => {
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingAnswer = null;
    messages.length = 0;
    messages.push(getWelcomeMessage());
    setBusy(false);
    renderAll();
    input.focus();
  };

  qs('[data-chat-reset]', root).addEventListener('click', reset);

  if (onClose) {
    qs('[data-chat-close]', root).addEventListener('click', onClose);
  }

  const onKeydown = (event) => {
    if (event.key === 'Escape' && typeof onClose === 'function') {
      event.stopPropagation();
      onClose();
    }
  };
  if (onClose) document.addEventListener('keydown', onKeydown);

  const destroy = () => {
    document.removeEventListener('keydown', onKeydown);
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      pendingTimer = null;
      // La réponse a déjà été calculée : on la conserve pour ne pas perdre
      // la conversation si l'écran est fermé pendant l'animation.
      if (pendingAnswer) {
        messages.push({ role: 'assistant', ...pendingAnswer });
        pendingAnswer = null;
      }
    }
    root.remove();
  };

  return {
    element: root,
    focus: () => input.focus(),
    ask: (text) => answerText(text),
    reset,
    destroy,
  };
}

/* ------------------------- assistant flottant --------------------------- */

let launcherApi = null;

/**
 * Monte la bulle d'aide flottante, une seule fois pour toute l'application.
 * @param {{onNavigate?: Function}} options
 */
export function mountAssistantLauncher({ onNavigate = null } = {}) {
  if (launcherApi) return launcherApi;

  const root = element(html`
    <div id="assistant-launcher-root" class="no-print">
      <button
        type="button"
        class="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center gap-2 rounded-full bg-brand px-0 text-sm font-semibold text-white shadow-float transition-colors hover:bg-brand-dark sm:h-auto sm:w-auto sm:px-4 sm:py-3 lg:bottom-6 lg:right-6"
        aria-label="Ouvrir l’assistant"
        aria-expanded="false"
        aria-controls="assistant-floating-panel"
        data-assistant-launcher
      >
        ${raw(icon('help', { size: 19 }))}
        <span class="hidden sm:inline">Aide</span>
      </button>

      <section
        id="assistant-floating-panel"
        class="fixed inset-x-2 bottom-20 z-[45] h-[70dvh] max-h-[560px] sm:inset-x-auto sm:bottom-24 sm:right-5 sm:h-[600px] sm:max-h-[calc(100dvh-8rem)] sm:w-[400px]"
        aria-label="Assistant Mon Commerce"
        data-assistant-panel
      ></section>
    </div>
  `);

  document.body.append(root);

  const launcher = qs('[data-assistant-launcher]', root);
  const panel = qs('[data-assistant-panel]', root);
  let chat = null;
  let allowed = true;

  panel.classList.add('hidden');

  const close = () => {
    panel.classList.add('hidden');
    launcher.classList.toggle('hidden', !allowed);
    launcher.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    if (!allowed) return;
    if (!chat) {
      chat = createAssistantChat({
        variant: 'floating',
        onNavigate,
        onClose: close,
      });
      panel.append(chat.element);
    }
    panel.classList.remove('hidden');
    launcher.classList.add('hidden');
    launcher.setAttribute('aria-expanded', 'true');
    chat.focus();
  };

  launcher.addEventListener('click', () => {
    if (panel.classList.contains('hidden')) open();
    else close();
  });

  const setVisible = (value) => {
    allowed = Boolean(value);
    root.classList.toggle('hidden', !allowed);
    if (!allowed) close();
    else launcher.classList.toggle('hidden', !panel.classList.contains('hidden'));
  };

  launcherApi = { open, close, setVisible };
  return launcherApi;
}

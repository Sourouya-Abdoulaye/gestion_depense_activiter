/* ---------------------------------------------------------------------------
 * Mon Commerce — graphiques (Chart.js)
 *
 * Les graphiques sont toujours construits à partir de séries recalculées :
 * aucune statistique n'est stockée. Chaque instance est détruite au changement
 * d'écran ou au rafraîchissement pour éviter toute fuite de mémoire.
 * ------------------------------------------------------------------------- */

import Chart from 'chart.js/auto';

const BRAND = '#15803D';
const BRAND_LIGHT = 'rgba(21, 128, 61, 0.18)';
const WARNING = '#D97706';
const INK = '#111827';
const MUTED = '#6B7280';

/** Zone de graphique avec hauteur fixe et libellé accessible. */
export function chartBox({ height = 260, label = 'Graphique', className = '' }) {
  const wrapper = document.createElement('div');
  wrapper.className = `relative w-full ${className}`;
  wrapper.style.height = `${height}px`;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  wrapper.append(canvas);
  return { wrapper, canvas };
}

/** Options communes : montants en FCFA, grille discrète, infobulles lisibles. */
export function moneyChartOptions({ formatMoney, showLegend = true } = {}) {
  const format = formatMoney || ((value) => String(value));
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: showLegend,
        position: 'bottom',
        labels: { color: INK, boxWidth: 12, usePointStyle: true, font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          label: (context) => `${context.dataset.label || ''} : ${format(context.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: MUTED, maxRotation: 0, autoSkip: true } },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(107, 114, 128, 0.15)' },
        ticks: { color: MUTED, callback: (value) => format(value, { symbol: false }) },
      },
    },
  };
}

export const CHART_COLORS = {
  brand: BRAND,
  brandArea: BRAND_LIGHT,
  warning: WARNING,
  ink: INK,
  muted: MUTED,
};

export { Chart };

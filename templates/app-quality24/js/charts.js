// Обёртки над Chart.js с брендовой палитрой.
(function () {
  const KG = {
    yellow: '#ffd66b',
    yellowStrong: '#f3bf3c',
    dark: '#37383d',
    dark2: '#2c2d31',
    muted: '#6a6c73',
    border: '#e4e4e7',
    red: '#e06a5a',
    green: '#4ca878',
    blue: '#5b8fd9',
    // Тёмная палитра для области графиков (фон #3a3b40):
    chartBg: '#3a3b40',
    chartText: '#d6d8dd',
    chartGrid: 'rgba(255,255,255,0.08)',
    chartValue: '#ffffff',
  };

  // Палитра для множественных серий. Первые 3 подобраны под скриншоты из Google Sheets:
  // жёлтый / лавандовый / мягкий зелёный — для 3 последних недель.
  const PALETTE = [
    '#ffd66b', // неделя N-2
    '#c8d2ed', // неделя N-1
    '#b9d9a1', // неделя N
    '#5b8fd9', '#e06a5a', '#b58bd4', '#f3a23c', '#3fb5b5',
    '#a9a9af', '#d48bad', '#7bbb4b', '#6a6c73',
  ];

  Chart.register(ChartDataLabels);
  // По умолчанию datalabels выключены — включаем точечно в каждом чарте.
  Chart.defaults.plugins.datalabels = { display: false };

  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif';
  Chart.defaults.color = KG.chartText;
  Chart.defaults.borderColor = KG.chartGrid;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.tooltip.backgroundColor = KG.dark;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 6;
  Chart.defaults.plugins.tooltip.titleFont = { weight: '700' };

  const instances = new Map();

  function render(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    if (instances.has(id)) {
      instances.get(id).destroy();
      instances.delete(id);
    }
    const chart = new Chart(canvas.getContext('2d'), config);
    instances.set(id, chart);
    return chart;
  }

  function destroy(id) {
    if (instances.has(id)) {
      instances.get(id).destroy();
      instances.delete(id);
    }
  }

  function colorFor(i) { return PALETTE[i % PALETTE.length]; }

  // Цвет для недели: последние 3 недели выборки берут цвета [0,1,2] палитры,
  // более старые — из хвоста. weeks — массив недель в порядке по возрастанию.
  function weekColor(weekIndex, totalWeeks) {
    // Хотим чтобы последние 3 недели окрасились в 0,1,2 палитры.
    const fromEnd = totalWeeks - 1 - weekIndex; // 0 для последней, 1 для предпоследней...
    if (fromEnd <= 2) return PALETTE[2 - fromEnd];
    return PALETTE[3 + ((weekIndex) % (PALETTE.length - 3))];
  }

  const commonScales = {
    x: { grid: { color: KG.chartGrid }, ticks: { color: KG.chartText } },
    y: { grid: { color: KG.chartGrid }, ticks: { color: KG.chartText }, beginAtZero: true },
  };

  window.KGCharts = { KG, PALETTE, render, destroy, colorFor, weekColor, commonScales };
})();

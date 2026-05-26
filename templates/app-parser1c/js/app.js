// Парсер 1С → Битрикс24. Демо-фронт.
// Шаги: upload → preview → progress → done. Никаких реальных запросов.

(function () {
  var D = window.DEMO_DATA;

  var els = {
    stepUpload:   document.getElementById('step-upload'),
    stepPreview:  document.getElementById('step-preview'),
    stepProgress: document.getElementById('step-progress'),
    stepDone:     document.getElementById('step-done'),

    dropzone:     document.getElementById('dropzone'),
    pickBtn:      document.getElementById('pickBtn'),
    fileInput:    document.getElementById('fileInput'),
    loadDemoBtn:  document.getElementById('loadDemoBtn'),

    previewMeta:  document.getElementById('previewMeta'),
    mapping:      document.getElementById('mapping'),
    previewTable: document.getElementById('previewTable'),
    previewCount: document.getElementById('previewCount'),
    importBtn:    document.getElementById('importBtn'),
    resetBtn:     document.getElementById('resetBtn'),

    psDone:       document.getElementById('psDone'),
    psTotal:      document.getElementById('psTotal'),
    psRate:       document.getElementById('psRate'),
    psEta:        document.getElementById('psEta'),
    progressBar:  document.getElementById('progressBar'),
    progressTitle:document.getElementById('progressTitle'),
    log:          document.getElementById('log'),

    doneSummary:  document.getElementById('doneSummary'),
    dsCreated:    document.getElementById('dsCreated'),
    dsUpdated:    document.getElementById('dsUpdated'),
    dsSkipped:    document.getElementById('dsSkipped'),
    dsErrors:     document.getElementById('dsErrors'),
    restartBtn:   document.getElementById('restartBtn'),
    openSmartBtn: document.getElementById('openSmartBtn'),
  };

  // ───── Шаг 1: drop / pick / demo ─────
  function bindUpload() {
    els.dropzone.addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      els.fileInput.click();
    });
    els.pickBtn.addEventListener('click', function (e) { e.stopPropagation(); els.fileInput.click(); });
    els.fileInput.addEventListener('change', function () {
      // в демо — что бы ни выбрали, грузим заранее заготовленный файл
      goToPreview();
    });

    els.dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      els.dropzone.classList.add('drag');
    });
    els.dropzone.addEventListener('dragleave', function () { els.dropzone.classList.remove('drag'); });
    els.dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      els.dropzone.classList.remove('drag');
      goToPreview();
    });

    els.loadDemoBtn.addEventListener('click', goToPreview);
  }

  // ───── Шаг 2: предпросмотр ─────
  function goToPreview() {
    show(els.stepPreview);
    hide(els.stepProgress);
    hide(els.stepDone);

    els.previewMeta.innerHTML =
      'Файл <code>' + D.fileName + '</code> · лист «' + D.sheetName + '» · ' +
      D.rowCount + ' строк · ' + D.fileSize;

    // Mapping
    els.mapping.innerHTML = D.columns.map(function (c) {
      var conf = Math.round(c.conf * 100);
      var cls = c.conf >= 0.9 ? '' : 'warn';
      return '<div class="map-item">' +
        '<div><span class="map-from">' + c.from + '</span> ' +
        '<span class="map-arrow">→</span> ' +
        '<span class="map-to">' + c.label + '</span></div>' +
        '<div class="map-confidence ' + cls + '">' +
        (c.conf >= 0.9 ? '✓' : '⚠') + ' уверенность ' + conf + '%</div>' +
        '</div>';
    }).join('');

    // Table preview — первые 8 строк
    var rows = D.items.slice(0, 8);
    var html =
      '<thead><tr>' +
      '<th>Артикул</th><th>Наименование</th><th>Ед.</th>' +
      '<th class="num">Цена</th><th class="num">Остаток</th>' +
      '<th>Склад</th><th>Категория</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr>' +
        '<td>' + r.sku + '</td>' +
        '<td>' + r.name + '</td>' +
        '<td>' + r.unit + '</td>' +
        '<td class="num">' + r.price.toLocaleString('ru-RU') + ' ₽</td>' +
        '<td class="num">' + r.qty + '</td>' +
        '<td>' + r.warehouse + '</td>' +
        '<td>' + r.category + '</td>' +
        '</tr>';
    });
    html += '</tbody>';
    els.previewTable.innerHTML = html;

    els.previewCount.textContent = D.rowCount;

    els.stepPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  els.resetBtn = els.resetBtn;
  document.getElementById('resetBtn').addEventListener('click', function () {
    hide(els.stepPreview); hide(els.stepProgress); hide(els.stepDone);
    show(els.stepUpload);
    els.fileInput.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ───── Шаг 3: прогресс ─────
  document.getElementById('importBtn').addEventListener('click', startImport);

  var importTimer = null;

  function startImport() {
    show(els.stepProgress);
    hide(els.stepDone);
    els.log.innerHTML = '';
    els.progressBar.style.width = '0%';
    els.progressTitle.textContent = 'Запросы к Битрикс24 batch API…';

    var total = D.items.length;
    els.psTotal.textContent = total;
    els.psDone.textContent = '0';
    els.psRate.textContent = '— /сек';
    els.psEta.textContent = '—';

    els.stepProgress.scrollIntoView({ behavior: 'smooth', block: 'start' });

    var i = 0;
    var startTs = Date.now();
    var stats = { create: 0, update: 0, skip: 0, error: 0 };

    // Скорость ~30 строк/тик, тик 80мс = ~375/сек, 247 строк → ~0.7 сек.
    // В демо хочется зрелищности — снизим до ~50/сек, длительность ~5 сек.
    var perTick = 4;
    var tickMs = 70;

    function tick() {
      var batch = Math.min(perTick, total - i);
      for (var k = 0; k < batch; k++) {
        var item = D.items[i];
        var op = D.ops[i];
        stats[op]++;
        addLog(i + 1, item, op);
        i++;
      }
      var pct = Math.round(i / total * 100);
      els.progressBar.style.width = pct + '%';
      els.psDone.textContent = i;

      var elapsed = (Date.now() - startTs) / 1000;
      var rate = elapsed > 0 ? Math.round(i / elapsed) : 0;
      els.psRate.textContent = rate + ' /сек';
      var eta = rate > 0 ? Math.ceil((total - i) / rate) : 0;
      els.psEta.textContent = eta > 0 ? eta + ' сек' : '0 сек';

      if (i < total) {
        importTimer = setTimeout(tick, tickMs);
      } else {
        finishImport(stats, elapsed);
      }
    }

    tick();
  }

  function addLog(idx, item, op) {
    var line = document.createElement('div');
    var cls = op === 'create' ? 'ok' : op === 'update' ? 'upd' : op === 'error' ? 'err' : '';
    line.className = 'log-line ' + cls;
    var label = op === 'create' ? 'CREATED' : op === 'update' ? 'UPDATED' : op === 'skip' ? 'SKIPPED' : 'ERROR';
    var t = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    line.innerHTML =
      '<span class="lt">' + t + '</span>' +
      '<span class="lc">[' + label + ']</span> ' +
      '#' + idx + ' · ' + escapeHtml(item.sku) + ' · ' + escapeHtml(item.name);
    els.log.appendChild(line);
    if (els.log.children.length > 200) els.log.removeChild(els.log.firstChild);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function finishImport(stats, elapsedSec) {
    els.progressTitle.textContent = 'Готово · ' + elapsedSec.toFixed(1) + ' сек';
    els.dsCreated.textContent = stats.create;
    els.dsUpdated.textContent = stats.update;
    els.dsSkipped.textContent = stats.skip;
    els.dsErrors.textContent  = stats.error;
    els.doneSummary.textContent =
      'Обновлён смарт-процесс «' + D.smartProcessName + '» · обработано ' +
      D.items.length + ' позиций за ' + elapsedSec.toFixed(1) + ' сек';
    show(els.stepDone);
    els.stepDone.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  els.restartBtn.addEventListener('click', function () {
    hide(els.stepPreview); hide(els.stepProgress); hide(els.stepDone);
    show(els.stepUpload);
    els.fileInput.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  els.openSmartBtn.addEventListener('click', function () {
    if (window.BX24 && window.BX24.openPath) {
      window.BX24.openPath(D.smartProcessUrl);
    }
    showToast('В реальном Битрикс24 здесь открылся бы смарт-процесс «' + D.smartProcessName + '»');
  });

  // ───── helpers ─────
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function showToast(text) {
    var t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:10px 18px;font-size:13px;z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:80%;text-align:center;';
    document.body.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; }, 2200);
    setTimeout(function () { t.remove(); }, 2700);
  }

  bindUpload();
})();

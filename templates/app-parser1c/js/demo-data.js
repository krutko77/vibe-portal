// Синтетическая выгрузка из 1С: 247 товаров (артикул, наименование, ед.изм, цена, остаток, склад, категория)
// Реальная версия принимает любой xlsx/csv от заказчика, авто-распознаёт колонки.

window.DEMO_DATA = (function () {
  // Категории и шаблоны имени товара (нейтральные B2B-номенклатуры)
  var CATS = [
    { name: 'Метизы',           items: ['Болт оцинкованный', 'Гайка шестигранная', 'Шайба плоская', 'Винт DIN-7985', 'Саморез по металлу', 'Анкер клиновой', 'Шпилька резьбовая'] },
    { name: 'Электрика',        items: ['Кабель ВВГнг-LS', 'Автомат однополюсный', 'УЗО 2P', 'Розетка наружная', 'Выключатель одноклавишный', 'Светильник LED 36Вт', 'Удлинитель сетевой'] },
    { name: 'Сантехника',       items: ['Труба ПП', 'Фитинг угловой', 'Кран шаровой', 'Смеситель кухонный', 'Сифон бутылочный', 'Полотенцесушитель', 'Унитаз-компакт'] },
    { name: 'Инструмент',       items: ['Дрель ударная', 'Шуруповёрт аккумуляторный', 'Болгарка 125мм', 'Перфоратор SDS+', 'Лобзик электрический', 'Набор отвёрток', 'Уровень магнитный 80см'] },
    { name: 'Расходники',       items: ['Лента малярная', 'Скотч армированный', 'Клей монтажный', 'Перчатки нитриловые', 'Респиратор FFP2', 'Очки защитные', 'Мешок для мусора 240л'] },
    { name: 'Лакокрасочные',    items: ['Эмаль ПФ-115', 'Грунт-эмаль 3-в-1', 'Растворитель 646', 'Шпатлёвка финишная', 'Валик меховой', 'Кисть плоская 75мм', 'Лак мебельный'] },
    { name: 'Крепёж',           items: ['Дюбель-гвоздь', 'Уголок монтажный', 'Пластина соединительная', 'Хомут червячный', 'Скоба двухлапковая', 'Кронштейн полки', 'Стяжка нейлоновая'] },
  ];
  var WAREHOUSES = ['Склад МСК-1', 'Склад МСК-2', 'Склад СПб', 'Склад Казань', 'Склад Транзит'];
  var UNITS = ['шт', 'м', 'кг', 'упак', 'компл', 'м2'];

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function rnd(seed) { var x = Math.sin(seed) * 10000; return x - Math.floor(x); }

  var items = [];
  var sku = 100000;
  var idx = 0;
  CATS.forEach(function (cat, ci) {
    cat.items.forEach(function (name, ni) {
      // По 5 вариантов размеров/мощностей на каждое имя
      for (var v = 0; v < 5; v++) {
        idx++;
        sku++;
        var basePrice = 30 + Math.floor(rnd(idx * 13) * 9000);
        var qty = Math.floor(rnd(idx * 7) * 350);
        var sizeStr = '';
        if (v === 0) sizeStr = ' M' + (6 + (ni % 6) * 2) + 'x' + (10 + v * 5);
        else if (v === 1) sizeStr = ' M' + (8 + (ni % 4) * 2) + 'x' + (15 + v * 5);
        else if (v === 2) sizeStr = ' ' + (1 + v) + '.' + (5 + v) + ' мм';
        else if (v === 3) sizeStr = ' ' + (10 + v * 5) + ' мм';
        else sizeStr = ' тип ' + String.fromCharCode(65 + v);

        items.push({
          sku: 'A-' + pad(sku, 6),
          name: name + sizeStr,
          unit: UNITS[(ci + v) % UNITS.length],
          price: basePrice,
          qty: qty,
          warehouse: WAREHOUSES[(idx) % WAREHOUSES.length],
          category: cat.name,
        });
      }
    });
  });

  // Слегка перетасуем, чтобы было реалистичнее
  items.sort(function (a, b) { return a.sku < b.sku ? -1 : 1; });

  // Распределение «что произойдёт» при импорте (для финальной статистики и лога)
  var ops = items.map(function (it, i) {
    var r = rnd(i * 31);
    if (r < 0.18) return 'create';
    if (r < 0.94) return 'update';
    if (r < 0.99) return 'skip';
    return 'error';
  });

  return {
    fileName: 'price-2026-04.xlsx',
    fileSize: '186 КБ',
    sheetName: 'Прайс',
    rowCount: items.length,
    columns: [
      { from: 'Артикул',         to: 'PROPERTY_SKU',       conf: 0.99, label: 'Артикул товара' },
      { from: 'Наименование',    to: 'NAME',               conf: 0.99, label: 'Название' },
      { from: 'Ед.изм.',         to: 'PROPERTY_UNIT',      conf: 0.96, label: 'Единица измерения' },
      { from: 'Цена розн., руб.',to: 'PROPERTY_PRICE',     conf: 0.92, label: 'Цена' },
      { from: 'Остаток, ед.',    to: 'PROPERTY_STOCK',     conf: 0.94, label: 'Остаток' },
      { from: 'Склад',           to: 'PROPERTY_WAREHOUSE', conf: 0.88, label: 'Склад хранения' },
      { from: 'Группа',          to: 'PROPERTY_CATEGORY',  conf: 0.78, label: 'Категория' },
    ],
    items: items,
    ops: ops,
    smartProcessName: 'Товары и услуги',
    smartProcessUrl: '/crm/type/180/list/',
  };
})();

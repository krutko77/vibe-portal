// Синтетические данные для пульта поддержки клиентов.
// Все задачи, авторы, комментарии — вымышленные. Структура совпадает с боевой.
// Реальная версия читает Google Sheet + Telegram-канал клиента.

window.DEMO_DATA = (() => {
  const today = new Date('2026-04-23');
  const ru = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  const dayDiff = (a, b) => Math.round((b - a) / 86400000);

  const STATUSES = [
    { key: 'new',         label: 'Новая' },
    { key: 'analysis',    label: 'Анализ' },
    { key: 'development', label: 'Разработка' },
    { key: 'testing',     label: 'Тест' },
    { key: 'paused',      label: 'Приостановлена' },
    { key: 'closed',      label: 'Закрыта' },
  ];

  // ── Задачи ───────────────────────────────────────────────────────────
  // [num, days_received, status, shortTitle, description, comments, time, plannedDays, priority, assignee, kb, miro, resolvedDays]
  const RAW = [
    [142, 2,  'new',         'Кодировка в выгрузке отчёта',
      'Пользователи жалуются что отчёт по продажам выгружается с ошибкой кодировки — кириллица превращается в кракозябры.',
      'Передал в разработку, ожидаем фикс к концу недели.', '0 м', 5, true, 'Соколов А.', false, false, null],
    [141, 4,  'analysis',    'Дублирование клиентов при импорте',
      'При импорте из 1С система создаёт дубликаты карточек клиентов с одним ИНН. Появилось после обновления.',
      'Воспроизвели на тестовом портале. Похоже на баг в правилах дедупликации после релиза 14 апреля.', '2 ч 15 м', 7, true, 'Лебедев Д.', true, false, null],
    [140, 3,  'analysis',    'Не приходят уведомления о просроченных задачах',
      'Менеджеры жалуются что напоминания по просроченным задачам перестали приходить в Telegram.',
      'Похоже что упал воркер уведомлений. Проверяем логи.', '1 ч 0 м', 5, false, 'Орлов К.', false, false, null],
    [139, 5,  'development', 'Не работает фильтр по дате в отчёте',
      'В отчёте «Конверсия по неделям» фильтр по периоду не применяется — всегда показывает все данные.',
      'Нашли причину: парсер дат игнорирует часовой пояс. Готовим фикс.', '3 ч 30 м', 8, false, 'Гончарова Е.', false, true, null],
    [138, 6,  'development', 'Импорт прайса из Excel падает на >5000 строк',
      'При загрузке прайс-листа более 5 тыс. строк страница зависает и обрывается с timeout.',
      'Переделываем на потоковый парсер вместо загрузки целиком в память.', '4 ч 45 м', 7, false, 'Лебедев Д.', false, false, null],
    [137, 7,  'development', 'Кнопка «Скачать акт» возвращает 500',
      'У клиентов с 100+ позициями в счёте PDF генерируется > 30 сек и таймаутит за nginx.',
      'Решение: вынести генерацию в фоновый job + отдавать ссылку по почте.', '6 ч 0 м', 10, true, 'Соколов А.', false, false, null],
    [136, 8,  'testing',     'Двойной счёт после оплаты картой',
      'Если клиент жмёт «оплатить» дважды подряд, в системе создаются два счёта на одну сделку.',
      'Защита от дабл-клика готова, идёт ручное тестирование на стейдже.', '5 ч 30 м', 11, true, 'Морозова Т.', true, false, null],
    [135, 10, 'testing',     'Поиск по комментариям не находит часть результатов',
      'Поиск по комментариям к сделкам игнорирует кириллицу и цифры в одном слове (типа «АБВ-2026»).',
      'Поправили токенизатор. Тестируем на полной выгрузке базы.', '2 ч 45 м', 14, false, 'Зайцева М.', false, false, null],
    [134, 14, 'paused',      'Интеграция с системой партнёра',
      'Двусторонний обмен заказами с партнёрской системой через REST API.',
      'Поставили на паузу — партнёр меняет схему API, ждём финальную спецификацию.', '8 ч 0 м', 30, false, 'Орлов К.', false, true, null],
    [133, 18, 'paused',      'Перенос архива клиентов 2023–2024',
      'Перенос исторических данных из старого Битрикс24 в новый портал.',
      'Поставили на паузу до согласования формата с заказчиком.', '12 ч 30 м', null, false, 'Соколов А.', false, false, null],
    [132, 16, 'closed',      'SMS-рассылка не уходила на 8-значные номера',
      'Старый формат коротких номеров игнорировался шлюзом, рассылка падала тихо.',
      'Поправили валидатор номеров, добавили лог проваленных отправок.', '3 ч 0 м', 14, false, 'Гончарова Е.', true, false, 12],
    [131, 20, 'closed',      'Доступ к сделкам у роли «Менеджер РОП»',
      'Роль РОП не видела чужие сделки своих менеджеров после изменения структуры.',
      'Перенастроили права в группе. Заказчик подтвердил.', '1 ч 30 м', 14, false, 'Зайцева М.', true, false, 17],
    [130, 22, 'closed',      'Подсказки в карточке сделки задвоились',
      'После релиза 1 апреля в карточках сделок стали показываться по два tooltipа на каждое поле.',
      'Дублирующийся обработчик удалён, проверено в продакшне.', '0 ч 45 м', 10, false, 'Лебедев Д.', false, false, 18],
    [129, 25, 'closed',      'Ошибка при сохранении задачи без срока',
      'Если у задачи не указан плановый срок, сохранение валилось с 500.',
      'Сделали поле опциональным, ошибка устранена.', '1 ч 0 м', 14, false, 'Морозова Т.', true, false, 22],
    [128, 30, 'closed',      'Telegram-уведомления приходили дважды',
      'При смене статуса сделки бот отправлял два сообщения подряд.',
      'Был race condition в воркере. Поправили.', '2 ч 15 м', 21, false, 'Орлов К.', false, false, 27],
  ];

  const tasks = RAW.map(([id, daysRecv, status, shortTitle, description, comments, time, plannedDays, prio, assignee, kb, miro, resolvedDaysAgo]) => {
    const received = daysAgo(daysRecv);
    const planned = plannedDays != null ? daysAgo(daysRecv - plannedDays) : null;
    const resolved = resolvedDaysAgo != null ? daysAgo(resolvedDaysAgo) : null;
    const isClosed = status === 'closed';
    return {
      id,
      receivedAt: ru(received),
      description,
      shortTitle,
      title: description,
      resolvedAt: resolved ? ru(resolved) : '',
      resolution: isClosed ? comments : '',
      comments: isClosed ? '' : comments,
      timeSpent: time,
      desiredDeadline: planned ? ru(planned) : '',
      plannedDeadline: planned ? ru(planned) : '',
      rawStatus: STATUSES.find(s => s.key === status).label,
      status,
      hasErrors: false,
      isClosed,
      daysElapsed: isClosed ? null : daysRecv,
      daysLeft: isClosed ? null : (planned ? dayDiff(today, planned) : null),
      daysTotal: isClosed && resolvedDaysAgo != null ? (daysRecv - resolvedDaysAgo) : daysRecv,
      isPriority: prio,
      internalAssignee: assignee,
      internalComment: '',
      internalTaskUrl: null,
      inKnowledgeBase: kb,
      inMiro: miro,
    };
  });

  // ── Чат с клиентом (Telegram) ───────────────────────────────────────
  // m.llm.sentiment: 'negative' | 'neutral' | 'positive'
  // m.llm.category:  'complaint' | 'question' | 'praise' | 'request' | 'info'
  const ms = (daysAgoN, hour, min) => {
    const d = daysAgo(daysAgoN);
    d.setHours(hour, min, 0, 0);
    return d.getTime();
  };

  const chat = [
    { id: 1, author: 'Артём (заказчик)', at: ms(0, 15, 42), text: 'Что с задачей #142? Уже неделю висит, пользователи возмущаются',
      linkedTasks: ['142'], llm: { sentiment: 'negative', category: 'complaint', reason: 'Жалоба на сроки' } },
    { id: 2, author: 'Соколов А. (поддержка)', at: ms(0, 15, 47), text: 'Артём, передали в разработку, фикс будет до пятницы. Держим в курсе.',
      linkedTasks: ['142'], llm: { sentiment: 'neutral', category: 'info' } },
    { id: 3, author: 'Артём (заказчик)', at: ms(0, 14, 18), text: 'По #138 — сегодня загружали прайс из 8000 позиций, опять упало. Это уже вторая неделя!',
      linkedTasks: ['138'], llm: { sentiment: 'negative', category: 'complaint', reason: 'Повторное падение, эмоциональный тон' } },
    { id: 4, author: 'Лебедев Д. (поддержка)', at: ms(0, 14, 25), text: 'Видим. Уже переписываем на потоковый парсер, релиз завтра-послезавтра.',
      linkedTasks: ['138'], llm: { sentiment: 'neutral', category: 'info' } },
    { id: 5, author: 'Марина (бухгалтерия)', at: ms(0, 12, 55), text: 'Спасибо за #131, права наконец-то заработали как нужно 👍',
      linkedTasks: ['131'], llm: { sentiment: 'positive', category: 'praise' } },
    { id: 6, author: 'Артём (заказчик)', at: ms(1, 17, 30), text: 'Можно ли #136 (двойной счёт) сделать приоритетом? Финансы переживают',
      linkedTasks: ['136'], llm: { sentiment: 'neutral', category: 'request' } },
    { id: 7, author: 'Морозова Т. (поддержка)', at: ms(1, 17, 38), text: 'Уже приоритетная, на тестировании. До конца недели зальём.',
      linkedTasks: ['136'], llm: { sentiment: 'neutral', category: 'info' } },
    { id: 8, author: 'Артём (заказчик)', at: ms(1, 11, 12), text: 'А по #134 партнёр обещает спецификацию к 25 апреля. Подвиньтесь как только пришлют.',
      linkedTasks: ['134'], llm: { sentiment: 'neutral', category: 'info' } },
    { id: 9, author: 'Иван (РОП)', at: ms(2, 16, 22), text: 'Коллеги, отчёт по конверсии (#139) — это вообще когда?? Мне завтра на совет директоров надо!',
      linkedTasks: ['139'], llm: { sentiment: 'negative', category: 'complaint', reason: 'Срочность, эмоциональный тон' } },
    { id: 10, author: 'Гончарова Е. (поддержка)', at: ms(2, 16, 30), text: 'Иван, причину нашли — фикс готов на тестинге, к утру выложим в прод.',
      linkedTasks: ['139'], llm: { sentiment: 'neutral', category: 'info' } },
    { id: 11, author: 'Артём (заказчик)', at: ms(3, 10, 5), text: 'Спасибо за #135, поиск стал нормально работать. Раньше было больно искать что-то конкретное.',
      linkedTasks: ['135'], llm: { sentiment: 'positive', category: 'praise' } },
    { id: 12, author: 'Зайцева М. (поддержка)', at: ms(3, 10, 12), text: 'Рады стараться 🙂 Мониторим, если найдёте кейсы где не нашлось — пишите сразу.',
      linkedTasks: ['135'], llm: { sentiment: 'positive', category: 'info' } },
    { id: 13, author: 'Артём (заказчик)', at: ms(4, 19, 8), text: 'Когда ждать импорт архива клиентов (#133)? Уже месяц на паузе',
      linkedTasks: ['133'], llm: { sentiment: 'negative', category: 'question', reason: 'Длительная задержка' } },
    { id: 14, author: 'Соколов А. (поддержка)', at: ms(4, 19, 15), text: 'Ждём от вашей стороны согласования формата экспорта. Без этого не двинемся.',
      linkedTasks: ['133'], llm: { sentiment: 'neutral', category: 'info' } },
    { id: 15, author: 'Иван (РОП)', at: ms(5, 14, 0), text: 'Принято, согласуем до конца недели и пришлём.',
      linkedTasks: ['133'], llm: { sentiment: 'neutral', category: 'info' } },
  ];

  // ── Лист учёта рабочего времени ─────────────────────────────────────
  const lurv = {
    totalMinutes: tasks.reduce((s, t) => {
      const m = String(t.timeSpent || '').match(/(\d+)\s*ч/);
      const mm = String(t.timeSpent || '').match(/(\d+)\s*м/);
      return s + (m ? +m[1] * 60 : 0) + (mm ? +mm[1] : 0);
    }, 0),
    entries: [
      { date: '2026-04-22', text: 'Анализ кодировки в выгрузке отчёта, воспроизведение бага', minutes: 90,  taskIds: ['142'] },
      { date: '2026-04-22', text: 'Релиз фикса по поиску комментариев, smoke-тесты',           minutes: 165, taskIds: ['135'] },
      { date: '2026-04-21', text: 'Переписывание импорта прайса на потоковый парсер',          minutes: 285, taskIds: ['138'] },
      { date: '2026-04-21', text: 'Фоновая генерация PDF-актов, инфра-доработка',              minutes: 240, taskIds: ['137'] },
      { date: '2026-04-20', text: 'Тестирование защиты от дабл-клика на оплате',               minutes: 180, taskIds: ['136'] },
      { date: '2026-04-19', text: 'Расследование падения уведомлений в Telegram',              minutes: 60,  taskIds: ['140'] },
      { date: '2026-04-18', text: 'Фикс фильтра по дате в отчёте конверсии',                   minutes: 210, taskIds: ['139'] },
      { date: '2026-04-17', text: 'Дедупликация клиентов после релиза 1С — анализ',            minutes: 135, taskIds: ['141'] },
      { date: '2026-04-15', text: 'Закрытие задачи по правам РОП, согласование с заказчиком',  minutes: 90,  taskIds: ['131'] },
      { date: '2026-04-14', text: 'Фикс SMS-валидатора, лог проваленных отправок',             minutes: 180, taskIds: ['132'] },
    ],
    weekly: [
      { weekStart: '2026-03-30', minutes: 1380 },
      { weekStart: '2026-04-06', minutes: 1620 },
      { weekStart: '2026-04-13', minutes: 1890 },
      { weekStart: '2026-04-20', minutes: 720 },
    ],
    periods: [
      { name: 'Март 2026',  pdf: '#' },
      { name: 'Апрель 2026', pdf: '#' },
    ],
  };

  return {
    tasks,
    statuses: STATUSES,
    chat,
    lurv,
    user: { username: 'demo', name: 'Демо-пользователь' },
    lastSyncedAt: today.toISOString(),
  };
})();

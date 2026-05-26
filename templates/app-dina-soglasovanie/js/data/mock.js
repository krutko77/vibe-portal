// Синтетические данные для демо. Все компании, лица и суммы вымышленные.
// Сохранены реалистичные пропорции: соотношение черновик/на согласовании/готово,
// разброс сумм, типичные стадии. Заменяется на live-данные из Б24 одной строкой.
//
// stageAgeDays — сколько дней заявка висит на текущей стадии (для подсветки «зависших»).

export const MOCK_REQUESTS = [
  // ── Доходные (поставка/продажа клиентам) ─────────────────────────────
  { id: 101, num: 'ДД-2026-014', typeSlug: 'income',
    title: 'ООО «ТД Магистраль» — поставка партии оборудования',
    amount: 2_840_000, author: 'Соколов А.В.', status: 'draft',  createdAt: '2026-04-22' },
  { id: 102, num: 'ДД-2026-013', typeSlug: 'income',
    title: 'АО «Северное Сияние» — годовой контракт сервиса',
    amount: 5_400_000, author: 'Гончарова Е.П.', status: 'review', createdAt: '2026-04-17',
    stage: 'Финдиректор', stageAgeDays: 6 },
  { id: 103, num: 'ДД-2026-012', typeSlug: 'income',
    title: 'ИП Никитин — разовая поставка инструмента',
    amount: 480_000, author: 'Соколов А.В.', status: 'review', createdAt: '2026-04-19',
    stage: 'Юрист', stageAgeDays: 3 },
  { id: 104, num: 'ДД-2026-011', typeSlug: 'income',
    title: 'ООО «ПромКомплект» — допсоглашение к договору',
    amount: 920_000, author: 'Лебедев Д.С.', status: 'done', createdAt: '2026-04-11' },
  { id: 105, num: 'ДД-2026-010', typeSlug: 'income',
    title: 'ООО «УралОптТорг» — расширение SLA до 24×7',
    amount: 2_150_000, author: 'Гончарова Е.П.', status: 'done', createdAt: '2026-04-08' },

  // ── Расходные (закупки, подрядчики) ───────────────────────────────────
  { id: 201, num: 'РД-2026-027', typeSlug: 'expense',
    title: 'Закупка партии станочного оборудования у поставщика',
    amount: 4_800_000, author: 'Орлов К.Н.', status: 'draft', createdAt: '2026-04-20' },
  { id: 202, num: 'РД-2026-026', typeSlug: 'expense',
    title: 'Услуги маркетингового агентства, апрель',
    amount: 360_000, author: 'Зайцева М.А.', status: 'review', createdAt: '2026-04-18',
    stage: 'Маркетинг-директор', stageAgeDays: 4 },
  { id: 203, num: 'РД-2026-025', typeSlug: 'expense',
    title: 'Доставка и монтаж оборудования в филиал Казань',
    amount: 215_000, author: 'Орлов К.Н.', status: 'review', createdAt: '2026-04-21',
    stage: 'Финдиректор', stageAgeDays: 1 },
  { id: 204, num: 'РД-2026-024', typeSlug: 'expense',
    title: 'Лицензии на программное обеспечение, годовое продление',
    amount: 980_000, author: 'Морозова Т.Н.', status: 'done', createdAt: '2026-04-05' },
  { id: 205, num: 'РД-2026-023', typeSlug: 'expense',
    title: 'Рекламный пакет: контекст + соцсети, май',
    amount: 540_000, author: 'Зайцева М.А.', status: 'review', createdAt: '2026-04-13',
    stage: 'Гендиректор', stageAgeDays: 9 },

  // ── Хозяйственные (аренда, коммуналка, АХО) ───────────────────────────
  { id: 301, num: 'ХД-2026-008', typeSlug: 'economic',
    title: 'Аренда офиса на ул. Красноармейская, 12',
    amount: 1_800_000, author: 'Морозова Т.Н.', status: 'draft', createdAt: '2026-04-19' },
  { id: 302, num: 'ХД-2026-007', typeSlug: 'economic',
    title: 'Клининг офиса и складских помещений, Q2-Q3',
    amount: 420_000, author: 'Морозова Т.Н.', status: 'review', createdAt: '2026-04-13',
    stage: 'АХО', stageAgeDays: 9 },
  { id: 303, num: 'ХД-2026-006', typeSlug: 'economic',
    title: 'Коммунальные услуги — филиал Челябинск',
    amount: 178_000, author: 'Морозова Т.Н.', status: 'done', createdAt: '2026-04-02' },
  { id: 304, num: 'ХД-2026-005', typeSlug: 'economic',
    title: 'Закупка бытовой техники для кухни офиса',
    amount: 92_000, author: 'Морозова Т.Н.', status: 'draft', createdAt: '2026-04-23' },

  // ── Трудовые (HR-документы) ───────────────────────────────────────────
  { id: 401, num: 'ТД-2026-031', typeSlug: 'labor',
    title: 'Приём: Кузнецов С.В., инженер 1-й категории',
    amount: null, author: 'Яковлева А.И. (HR)', status: 'review', createdAt: '2026-04-20',
    stage: 'Руководитель отдела', stageAgeDays: 3 },
  { id: 402, num: 'ТД-2026-030', typeSlug: 'labor',
    title: 'Допсоглашение: повышение оклада, Гончарова Е.П.',
    amount: null, author: 'Яковлева А.И. (HR)', status: 'review', createdAt: '2026-04-16',
    stage: 'Финдиректор', stageAgeDays: 7 },
  { id: 403, num: 'ТД-2026-029', typeSlug: 'labor',
    title: 'Приём: стажёр в отдел аналитики',
    amount: null, author: 'Яковлева А.И. (HR)', status: 'done', createdAt: '2026-04-10' },
  { id: 404, num: 'ТД-2026-028', typeSlug: 'labor',
    title: 'Командировка: Лебедев Д.С., Самара, 5 дней',
    amount: null, author: 'Яковлева А.И. (HR)', status: 'draft', createdAt: '2026-04-23' },

  // ── Внутренние (приказы, регламенты) ──────────────────────────────────
  { id: 501, num: 'ВД-2026-042', typeSlug: 'internal',
    title: 'Положение о командировках, версия 3',
    amount: null, author: 'Секретариат', status: 'draft', createdAt: '2026-04-21' },
  { id: 502, num: 'ВД-2026-041', typeSlug: 'internal',
    title: 'Приказ об итогах Q1 и распределении премий',
    amount: null, author: 'Секретариат', status: 'review', createdAt: '2026-04-18',
    stage: 'Гендиректор', stageAgeDays: 5 },
  { id: 503, num: 'ВД-2026-040', typeSlug: 'internal',
    title: 'Регламент выдачи корпоративной техники',
    amount: null, author: 'Секретариат', status: 'done', createdAt: '2026-04-04' },
  { id: 504, num: 'ВД-2026-039', typeSlug: 'internal',
    title: 'Приказ о переходе на новый график работы склада',
    amount: null, author: 'Секретариат', status: 'review', createdAt: '2026-04-22',
    stage: 'Замдиректора по операциям', stageAgeDays: 1 },
];

// История событий — лента активности на главной.
// Реальное приложение собирает её из логов изменений Б24.
export const MOCK_ACTIVITY = [
  { ts: '15:42', who: 'Финдиректор',           action: 'согласовал',                target: 'РД-2026-025 «Доставка оборудования в Казань»', kind: 'ok' },
  { ts: '14:18', who: 'Соколов А.В.',          action: 'отправил на согласование',  target: 'ДД-2026-012 «ИП Никитин — поставка»',           kind: 'send' },
  { ts: '12:55', who: 'Юрист',                 action: 'вернул на доработку',       target: 'ДД-2026-014 «ТД Магистраль»',                  kind: 'reject' },
  { ts: '11:30', who: 'Морозова Т.Н.',         action: 'создала черновик',          target: 'ХД-2026-005 «Бытовая техника»',                kind: 'draft' },
  { ts: 'вчера', who: 'Гендиректор',           action: 'согласовал',                target: 'РД-2026-024 «Лицензии ПО»',                    kind: 'ok' },
  { ts: 'вчера', who: 'Орлов К.Н.',            action: 'создал черновик',           target: 'РД-2026-027 «Закупка станков»',                kind: 'draft' },
  { ts: 'вчера', who: 'АХО',                   action: 'запросил уточнение',        target: 'ХД-2026-007 «Клининг Q2-Q3»',                  kind: 'reject' },
  { ts: '2 дня', who: 'Маркетинг-директор',    action: 'согласовал',                target: 'РД-2026-026 «Маркетинг апрель»',               kind: 'ok' },
];

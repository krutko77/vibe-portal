// Синтетика для демо «Конструктор карточек CRM».
// Подменяет server-side прокси к Битрикс24 — всё локально, в памяти.

window.DEMO_DATA = (() => {
  // app.js на старте требует window.SESSION_TOKEN; ставим заглушку.
  window.SESSION_TOKEN = 'demo-session-token';

  // ── Несколько демо-порталов ────────────────────────────────────────
  const PORTALS = [
    { id: 'demo-portal-1', name: 'KISELEV GROUP — основной', host: 'kiselev.bitrix24.ru', createdAt: '2025-11-20T10:00:00Z' },
    { id: 'demo-portal-2', name: 'ТД Магистраль — staging',  host: 'magistral.bitrix24.ru', createdAt: '2026-01-14T15:23:00Z' },
    { id: 'demo-portal-3', name: 'СеверноеСияние — продажи', host: 'sevsiyanie.bitrix24.ru', createdAt: '2026-03-02T09:11:00Z' },
  ];

  // ── Поля сделки (entityTypeId=2): 24 поля, в духе типового портала ──
  const DEAL_FIELDS = {
    TITLE:           { title: 'Название сделки',    type: 'string',   isSystem: true },
    STAGE_ID:        { title: 'Стадия',             type: 'crm_status', isSystem: true },
    OPPORTUNITY:     { title: 'Сумма',              type: 'double',   isSystem: true },
    CURRENCY_ID:     { title: 'Валюта',             type: 'string',   isSystem: true },
    BEGINDATE:       { title: 'Дата начала',        type: 'date',     isSystem: true },
    CLOSEDATE:       { title: 'Дата завершения',    type: 'date',     isSystem: true },
    ASSIGNED_BY_ID:  { title: 'Ответственный',      type: 'user',     isSystem: true },
    SOURCE_ID:       { title: 'Источник',           type: 'crm_status', isSystem: true },
    COMMENTS:        { title: 'Комментарий',        type: 'text',     isSystem: true },
    UF_CRM_LEAD_TYPE:{ title: 'Тип лида',            type: 'enumeration', items: [
      { ID: '101', VALUE: 'Холодный' }, { ID: '102', VALUE: 'Тёплый' }, { ID: '103', VALUE: 'Входящий' },
    ] },
    UF_CRM_INDUSTRY: { title: 'Отрасль клиента',    type: 'enumeration', items: [
      { ID: '201', VALUE: 'Производство' }, { ID: '202', VALUE: 'Логистика' },
      { ID: '203', VALUE: 'Розница' }, { ID: '204', VALUE: 'Услуги' },
    ] },
    UF_CRM_INN:        { title: 'ИНН клиента',     type: 'string' },
    UF_CRM_KPP:        { title: 'КПП клиента',     type: 'string' },
    UF_CRM_CONTRACT:   { title: 'Номер договора',  type: 'string' },
    UF_CRM_AMOUNT_PLAN:{ title: 'План по сумме',   type: 'double' },
    UF_CRM_AMOUNT_FACT:{ title: 'Факт по сумме',   type: 'double' },
    UF_CRM_PRIORITY:   { title: 'Приоритет',       type: 'enumeration', items: [
      { ID: '301', VALUE: 'Низкий' }, { ID: '302', VALUE: 'Средний' }, { ID: '303', VALUE: 'Высокий' }, { ID: '304', VALUE: 'Критичный' },
    ] },
    UF_CRM_PROBABILITY:{ title: 'Вероятность, %',  type: 'integer' },
    UF_CRM_NEXT_STEP:  { title: 'Следующий шаг',   type: 'string' },
    UF_CRM_NEXT_DATE:  { title: 'Дата след. касания', type: 'datetime' },
    UF_CRM_DECISION:   { title: 'ЛПР',             type: 'string' },
    UF_CRM_OBJECTION:  { title: 'Возражение',      type: 'enumeration', items: [
      { ID: '401', VALUE: 'Дорого' }, { ID: '402', VALUE: 'Уже есть подрядчик' }, { ID: '403', VALUE: 'Перезвоните позже' },
    ] },
    UF_CRM_DOCS:       { title: 'Документы',       type: 'file', isMultiple: true },
    UF_CRM_INTEGRATIONS: { title: 'Интеграции (мульти)', type: 'enumeration', isMultiple: true, items: [
      { ID: '501', VALUE: '1С' }, { ID: '502', VALUE: 'Telegram' }, { ID: '503', VALUE: 'WhatsApp' },
      { ID: '504', VALUE: 'АТС' }, { ID: '505', VALUE: 'Email' }, { ID: '506', VALUE: 'API сайта' },
    ] },
    UF_CRM_NPS:        { title: 'NPS клиента',     type: 'integer' },
    UF_CRM_TAGS:       { title: 'Теги',            type: 'string',   isMultiple: true },
  };

  // ── Поля контакта (entityTypeId=3) ─────────────────────────────────
  const CONTACT_FIELDS = {
    NAME:        { title: 'Имя',         type: 'string',   isSystem: true },
    LAST_NAME:   { title: 'Фамилия',     type: 'string',   isSystem: true },
    SECOND_NAME: { title: 'Отчество',    type: 'string',   isSystem: true },
    PHONE:       { title: 'Телефон',     type: 'string',   isSystem: true, isMultiple: true },
    EMAIL:       { title: 'E-mail',      type: 'string',   isSystem: true, isMultiple: true },
    POST:        { title: 'Должность',   type: 'string',   isSystem: true },
    UF_CRM_C_BIRTHDAY:  { title: 'День рождения',     type: 'date' },
    UF_CRM_C_MESSENGER: { title: 'Мессенджер',        type: 'string' },
    UF_CRM_C_LANG:      { title: 'Язык общения',      type: 'enumeration', items: [
      { ID: '601', VALUE: 'Русский' }, { ID: '602', VALUE: 'Английский' },
    ] },
    UF_CRM_C_NOTES:     { title: 'Заметка по человеку', type: 'text' },
  };

  // ── Поля компании (entityTypeId=4) ─────────────────────────────────
  const COMPANY_FIELDS = {
    TITLE:       { title: 'Название',     type: 'string', isSystem: true },
    INDUSTRY:    { title: 'Отрасль',      type: 'crm_status', isSystem: true },
    EMPLOYEES:   { title: 'Сотрудников',  type: 'crm_status', isSystem: true },
    PHONE:       { title: 'Телефон',      type: 'string', isSystem: true, isMultiple: true },
    EMAIL:       { title: 'E-mail',       type: 'string', isSystem: true, isMultiple: true },
    UF_CRM_CMP_INN:    { title: 'ИНН',           type: 'string' },
    UF_CRM_CMP_KPP:    { title: 'КПП',           type: 'string' },
    UF_CRM_CMP_OGRN:   { title: 'ОГРН',          type: 'string' },
    UF_CRM_CMP_REVENUE:{ title: 'Выручка, ₽',    type: 'double' },
    UF_CRM_CMP_SCORE:  { title: 'Скоринг A/B/C', type: 'enumeration', items: [
      { ID: '701', VALUE: 'A' }, { ID: '702', VALUE: 'B' }, { ID: '703', VALUE: 'C' },
    ] },
  };

  const FIELDS_BY_ENTITY = { 2: DEAL_FIELDS, 3: CONTACT_FIELDS, 4: COMPANY_FIELDS };

  // ── Категории (воронки) сделок ─────────────────────────────────────
  const CATEGORIES = {
    2: [
      { id: 0, name: 'Основная воронка' },
      { id: 1, name: 'B2B-направление' },
      { id: 2, name: 'Тех. поддержка' },
    ],
  };

  // ── Дефолтная раскладка карточки сделки ────────────────────────────
  const DEFAULT_LAYOUT_DEAL = [
    { name: 'main', title: 'Главное', type: 'section', elements: [
      { name: 'TITLE', optionFlags: '0' },
      { name: 'STAGE_ID', optionFlags: '0' },
      { name: 'OPPORTUNITY', optionFlags: '0' },
      { name: 'CURRENCY_ID', optionFlags: '0' },
      { name: 'ASSIGNED_BY_ID', optionFlags: '0' },
    ] },
    { name: 'about_client', title: 'О клиенте', type: 'section', elements: [
      { name: 'UF_CRM_INN', optionFlags: '0' },
      { name: 'UF_CRM_KPP', optionFlags: '0' },
      { name: 'UF_CRM_INDUSTRY', optionFlags: '0' },
      { name: 'UF_CRM_DECISION', optionFlags: '0' },
    ] },
    { name: 'sales', title: 'Продажа', type: 'section', elements: [
      { name: 'UF_CRM_LEAD_TYPE', optionFlags: '0' },
      { name: 'UF_CRM_PRIORITY', optionFlags: '0' },
      { name: 'UF_CRM_PROBABILITY', optionFlags: '0' },
      { name: 'UF_CRM_AMOUNT_PLAN', optionFlags: '0' },
      { name: 'UF_CRM_AMOUNT_FACT', optionFlags: '0' },
    ] },
    { name: 'next', title: 'Следующее касание', type: 'section', elements: [
      { name: 'UF_CRM_NEXT_STEP', optionFlags: '0' },
      { name: 'UF_CRM_NEXT_DATE', optionFlags: '0' },
      { name: 'UF_CRM_OBJECTION', optionFlags: '0' },
      { name: 'COMMENTS', optionFlags: '0' },
    ] },
    { name: 'extra', title: 'Доп. информация', type: 'section', elements: [
      { name: 'UF_CRM_INTEGRATIONS', optionFlags: '0' },
      { name: 'UF_CRM_DOCS', optionFlags: '0' },
      { name: 'UF_CRM_TAGS', optionFlags: '0' },
      { name: 'UF_CRM_NPS', optionFlags: '0' },
    ] },
  ];

  const DEFAULT_LAYOUT_CONTACT = [
    { name: 'main', title: 'Главное', type: 'section', elements: [
      { name: 'NAME', optionFlags: '0' }, { name: 'LAST_NAME', optionFlags: '0' },
      { name: 'SECOND_NAME', optionFlags: '0' }, { name: 'POST', optionFlags: '0' },
    ] },
    { name: 'comm', title: 'Контакты', type: 'section', elements: [
      { name: 'PHONE', optionFlags: '0' }, { name: 'EMAIL', optionFlags: '0' },
      { name: 'UF_CRM_C_MESSENGER', optionFlags: '0' }, { name: 'UF_CRM_C_LANG', optionFlags: '0' },
    ] },
    { name: 'misc', title: 'Прочее', type: 'section', elements: [
      { name: 'UF_CRM_C_BIRTHDAY', optionFlags: '0' }, { name: 'UF_CRM_C_NOTES', optionFlags: '0' },
    ] },
  ];

  const DEFAULT_LAYOUT_COMPANY = [
    { name: 'main', title: 'Главное', type: 'section', elements: [
      { name: 'TITLE', optionFlags: '0' }, { name: 'INDUSTRY', optionFlags: '0' },
      { name: 'EMPLOYEES', optionFlags: '0' }, { name: 'UF_CRM_CMP_SCORE', optionFlags: '0' },
    ] },
    { name: 'requisites', title: 'Реквизиты', type: 'section', elements: [
      { name: 'UF_CRM_CMP_INN', optionFlags: '0' }, { name: 'UF_CRM_CMP_KPP', optionFlags: '0' },
      { name: 'UF_CRM_CMP_OGRN', optionFlags: '0' }, { name: 'UF_CRM_CMP_REVENUE', optionFlags: '0' },
    ] },
    { name: 'contacts', title: 'Контакты', type: 'section', elements: [
      { name: 'PHONE', optionFlags: '0' }, { name: 'EMAIL', optionFlags: '0' },
    ] },
  ];

  const LAYOUTS_BY_ENTITY = { 2: DEFAULT_LAYOUT_DEAL, 3: DEFAULT_LAYOUT_CONTACT, 4: DEFAULT_LAYOUT_COMPANY };

  // Хранилище «сохранённых» раскладок in-memory: { portalId+entityId+catId → layout }
  const savedLayouts = {};

  return {
    PORTALS, FIELDS_BY_ENTITY, CATEGORIES, LAYOUTS_BY_ENTITY, savedLayouts,
  };
})();

/* Реестр внемодульных материалов «Базы знаний» (Старт + Справочник).
 * Это «одно аккуратное место»: чтобы добавить справочный материал —
 * допиши объект сюда + (если нужна страница) блок .materials-page
 * с тем же data-sub в panel/public/index.html.
 *
 *   group: 'start' | 'reference'        — в какую группу сайдбара
 *   kind:  start|cheatsheet|example|template|link|skill|faq  — иконка/ярлык + подгруппа Справочника
 *   sub:   значение data-sub существующего блока .materials-page
 */
window.KB_REFERENCE = [
  { id:'how-to',        group:'start',     kind:'start',      icon:'🧭', sub:'how-to',        title:'Как работать с порталом',     desc:'Вход, навбар, VS Code, проект, чат с Claude, файлы, контейнер.' },
  { id:'publish',       group:'start',     kind:'start',      icon:'🚀', sub:'publish',       title:'Как опубликовать приложение', desc:'Публикация, кто видит, деплой, относительные пути.' },
  { id:'cheatsheet',    group:'reference', kind:'cheatsheet', icon:'📋', sub:'cheatsheet',    title:'Шпаргалка по Claude Code',    desc:'Горячие клавиши, slash-команды, флаги CLI.' },
  { id:'claude-md',     group:'reference', kind:'example',    icon:'📝', sub:'claude-md',     title:'.md и CLAUDE.md — что это',   desc:'Учебная мини-страница про Markdown и CLAUDE.md.' },
  { id:'claude-folder', group:'reference', kind:'example',    icon:'🧩', sub:'claude-folder', title:'Структура папки .claude',     desc:'Из чего состоит .claude и за что отвечает.' },
  { id:'templates-dl',  group:'reference', kind:'template',   icon:'📦', sub:'templates-dl',  title:'Шаблоны проектов',            desc:'Скачать _base и _b24-single-php.' },
  { id:'skills',        group:'reference', kind:'skill',      icon:'✨', sub:'skills',        title:'Шпаргалка по Skills',         desc:'superpowers, ui-ux-pro-max, claude-memory и другие.' },
  { id:'software',      group:'reference', kind:'software',   icon:'💿', sub:'software',      title:'Полезный софт',               desc:'Редактор, AI-альтернативы, голосовой ввод, скриншоты, буфер обмена.' },
  { id:'links',         group:'reference', kind:'link',       icon:'🔗', sub:'links',         title:'Полезные ссылки',             desc:'claude.ai, Vibecode и документация.' },
  { id:'sources',       group:'reference', kind:'link',       icon:'📡', sub:'sources',       title:'Полезные источники',          desc:'Telegram- и YouTube-каналы про вайбкодинг и AI.' },
  { id:'faq',           group:'reference', kind:'faq',        icon:'⚠',  sub:'faq',           title:'FAQ — частые проблемы',       desc:'«Вылетает / не пускает» и другое.' },
  { id:'vibecode-b24',  group:'platforms', kind:'guide',      icon:'🏄', sub:'vibecode-b24',  title:'Битрикс24 Вайбкод',           desc:'Полный конспект: AI Router, Entity API, боты, деплой, архитектура.' },
];

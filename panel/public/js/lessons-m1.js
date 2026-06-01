/* ============================================================
 * Конспекты модуля 1 курса Vibecoding.
 * Источник — расшифровки трёх записей мастер-классов (27–28.05),
 * плюс реальная структура портала vibe.kiselevgroup.com:
 *   • воркспейс ученика (контейнер code-server, маунты workspace/templates/skills);
 *   • шаблоны templates/_base и templates/_b24-single-php;
 *   • протокол онбординга из templates/_base/CLAUDE.md.
 * Каждый ключ "mN.lK" → готовый HTML тела конспекта, который
 * app.js вставляет в #course-content вместо плейсхолдера.
 * Диаграммы — инлайн-SVG, цвета берутся из токенов темы
 * (css/style.css, блок ".note-fig svg ..."), корректны в обеих темах.
 * ============================================================ */
(function () {
  const L = {};
  const lead = (t) => '<p class="note-lead muted" style="font-size:14px;line-height:1.62;color:hsl(var(--muted-foreground));margin-bottom:18px">' + t + '</p>';

  /* ═══════════════════════════════════════════════════════════
   * M1 · Урок 1 — Что такое Claude и почему именно он
   * ═══════════════════════════════════════════════════════════ */
  L['m1.l1'] = lead(
    'Вводный урок: что такое Claude, как он устроен «под капотом» и чем отличается от ' +
    'ChatGPT, Cursor, Codex и DeepSeek. Главный вывод — рабочая связка, которую мы используем весь курс: ' +
    '<em>Claude Code + VS Code</em>.'
  ) + `
    <div class="note-toc">
      <span class="note-toc-chip">модель и дата-центр</span>
      <span class="note-toc-chip">3 способа обращения</span>
      <span class="note-toc-chip">от производителя vs агрегатор</span>
      <span class="note-toc-chip">сравнение инструментов</span>
      <span class="note-toc-chip">почему Claude Code</span>
      <span class="note-toc-chip">скорость и потоки</span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">1</span>Модель живёт в дата-центре — а мы к ней обращаемся</h2>
    <p>Нейросеть (модель) — это <strong>не программа на вашем компьютере</strong>. Она «живёт» и считает на серверах
       компании-производителя — в дата-центре. У Anthropic это <strong>Claude</strong>, у OpenAI — ChatGPT и Codex,
       есть китайские модели и DeepSeek.</p>
    <p>Мы лишь отправляем запрос (промт) → дата-центр считает → возвращает готовый ответ. Инструмент
       (чат, терминал, IDE) — это «ручка», через которую мы дотягиваемся до модели. <strong>Сама модель никогда
       не оказывается у вас на компьютере</strong> — у вас только инструмент и доступ.</p>

    <div class="note-fig">
      <svg viewBox="0 0 700 150" role="img" aria-label="Путь запроса к модели">
        <defs>
          <marker id="l1f1m" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="fill-mut"/></marker>
          <marker id="l1f1p" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="fill-pri"/></marker>
        </defs>
        <rect x="12" y="30" width="96" height="48" rx="2" class="box"/>
        <text x="60" y="59" text-anchor="middle" font-size="13">Вы</text>
        <rect x="178" y="22" width="156" height="64" rx="2" class="box-pri"/>
        <text x="256" y="48" text-anchor="middle" font-size="13" class="t-pri">Claude Code</text>
        <text x="256" y="66" text-anchor="middle" font-size="10" class="t-mut">чат · терминал · IDE</text>
        <rect x="436" y="22" width="200" height="64" rx="2" class="box"/>
        <text x="536" y="48" text-anchor="middle" font-size="12">Дата-центр Anthropic</text>
        <text x="536" y="66" text-anchor="middle" font-size="11" class="t-mut">модель Claude</text>
        <line x1="108" y1="54" x2="176" y2="54" class="ln" marker-end="url(#l1f1m)"/>
        <text x="142" y="46" text-anchor="middle" font-size="10" class="t-mut">промт</text>
        <line x1="334" y1="54" x2="434" y2="54" class="ln-pri" marker-end="url(#l1f1p)"/>
        <text x="384" y="46" text-anchor="middle" font-size="10" class="t-pri">ключ · подписка</text>
        <polyline points="536,86 536,126 60,126 60,80" class="ln-pri" marker-end="url(#l1f1p)"/>
        <text x="300" y="120" text-anchor="middle" font-size="11" class="t-pri">готовый ответ</text>
      </svg>
      <div class="note-fig-cap">Схема 1 · запрос уходит на серверы Anthropic, ответ возвращается обратно в инструмент</div>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">2</span>Три способа «дотянуться» до модели</h2>
    <ul>
      <li><strong>Чат в браузере</strong> — как ChatGPT: загрузил файл, спросил, посоветовался. Удобно, но между сессиями «забывает» контекст.</li>
      <li><strong>Терминал + Claude Code</strong> — модель сама читает и пишет файлы, выполняет команды. Это наш основной рабочий режим.</li>
      <li><strong>Приложение / IDE</strong> — визуальная оболочка (VS Code): видно файлы и чат с моделью одновременно.</li>
    </ul>
    <div class="note-callout is-tip">
      <span class="note-callout-ic">🧭</span>
      <span class="note-callout-body">
        <span class="note-callout-label">не пугайтесь слов</span>
        «Терминал», «среда разработки», «IDE», «вьюскод» — это всё про <strong>одно и то же место</strong>,
        где мы работаем с кодом и моделью. Дальше в курсе разберём каждое по отдельности.
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">3</span>«От производителя» против «агрегатора»</h2>
    <p>Принципиальное различие, которое стоит понять сразу: инструмент может быть
       <strong>от того же производителя, что и модель</strong>, или быть <strong>агрегатором</strong> — оболочкой,
       в которую подключают любую модель.</p>
    <div class="note-fig">
      <svg viewBox="0 0 700 180" role="img" aria-label="От производителя против агрегатора">
        <defs>
          <marker id="l1f2m" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="fill-mut"/></marker>
        </defs>
        <text x="30" y="24" font-size="11" class="t-pri">Напрямую от производителя</text>
        <rect x="30" y="38" width="120" height="34" rx="2" class="box-pri"/><text x="90" y="59" text-anchor="middle" font-size="11">Claude Code</text>
        <line x1="150" y1="55" x2="196" y2="55" class="ln" marker-end="url(#l1f2m)"/>
        <rect x="198" y="38" width="120" height="34" rx="2" class="box"/><text x="258" y="59" text-anchor="middle" font-size="11">Anthropic · Claude</text>
        <rect x="30" y="92" width="120" height="34" rx="2" class="box"/><text x="90" y="113" text-anchor="middle" font-size="11">Codex</text>
        <line x1="150" y1="109" x2="196" y2="109" class="ln" marker-end="url(#l1f2m)"/>
        <rect x="198" y="92" width="120" height="34" rx="2" class="box"/><text x="258" y="113" text-anchor="middle" font-size="11">OpenAI · GPT</text>

        <line x1="350" y1="30" x2="350" y2="150" class="ln" style="stroke:hsl(var(--border));stroke-dasharray:3 3"/>

        <text x="392" y="24" font-size="11" class="t-mut">Агрегатор (Cursor)</text>
        <rect x="392" y="56" width="96" height="44" rx="2" class="box"/><text x="440" y="82" text-anchor="middle" font-size="11">Cursor</text>
        <line x1="488" y1="78" x2="528" y2="78" class="ln" marker-end="url(#l1f2m)"/>
        <rect x="530" y="40" width="150" height="78" rx="2" class="box-dash"/>
        <text x="605" y="60" text-anchor="middle" font-size="10" class="t-mut">любая модель:</text>
        <text x="605" y="78" text-anchor="middle" font-size="11">Claude</text>
        <text x="605" y="94" text-anchor="middle" font-size="11">GPT</text>
        <text x="605" y="110" text-anchor="middle" font-size="11">DeepSeek</text>
      </svg>
      <div class="note-fig-cap">Схема 2 · «от производителя» — модель и инструмент от одной компании; агрегатор — переключаешь модель «под капотом»</div>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">4</span>Сравнение инструментов</h2>
    <div class="note-cmp-wrap">
      <table class="note-cmp">
        <thead><tr><th>Инструмент</th><th>Тип</th><th>Для чего</th><th>Заметка</th></tr></thead>
        <tbody>
          <tr><td>ChatGPT</td><td>браузер-чат</td><td>текст, идеи, файлы</td><td>привычный, но «забывает»</td></tr>
          <tr><td>Claude.ai</td><td>браузер-чат</td><td>то же + сильный анализ</td><td>наш «совет» в браузере</td></tr>
          <tr><td>Cursor</td><td>IDE-агрегатор</td><td>код, любая модель</td><td>гибко, но не «от производителя»</td></tr>
          <tr><td>Codex</td><td>от OpenAI</td><td>код</td><td>топовый у OpenAI</td></tr>
          <tr><td>DeepSeek</td><td>дёшево</td><td>код / текст</td><td class="nope">больше галлюцинаций, медленнее — не на старте</td></tr>
          <tr><td>Claude Code</td><td>от Anthropic</td><td>код в терминале / VS Code</td><td class="pick">наш выбор ✓</td></tr>
        </tbody>
      </table>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">5</span>Почему именно Claude Code</h2>
    <ul>
      <li>Даёт <strong>прогнозируемый, корректный и безопасный</strong> результат — сам делает проверку по безопасности перед действием.</li>
      <li>Примерно <strong>в 90% случаев</strong> выдаёт ровно тот результат, который ожидаешь.</li>
      <li>Это подтверждают практики вайбкодинга (в т.ч. в команде Битрикс24).</li>
      <li>DeepSeek дешевле, но больше «уходит не туда» (галлюцинации) и медленнее — на старте важнее скорость и предсказуемость.</li>
    </ul>
    <div class="note-callout is-key">
      <span class="note-callout-ic">⭐</span>
      <span class="note-callout-body">
        <span class="note-callout-label">вывод урока</span>
        Связка <strong>Claude Code + VS Code</strong> — самая рабочая и, по сути, безальтернативная,
        особенно если раскатываете процесс на всю команду. Именно её используем весь курс.
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">6</span>Скорость и работа в несколько потоков</h2>
    <p>Когда работаешь с моделями постоянно, важна и <strong>скорость ответа</strong>. Можно держать несколько окон
       одновременно — разные задачи одного или разных проектов, которые не мешают друг другу. Пока один поток «думает»,
       во втором продолжаешь работу.</p>
    <div class="note-fig">
      <svg viewBox="0 0 700 170" role="img" aria-label="Три потока Claude параллельно">
        <rect x="20" y="24" width="200" height="120" rx="2" class="box"/>
        <rect x="20" y="24" width="200" height="26" class="fill-track"/>
        <text x="120" y="42" text-anchor="middle" font-size="11" class="t-pri">● чат 1</text>
        <text x="120" y="92" text-anchor="middle" font-size="13">сайт-лендинг</text>
        <text x="120" y="116" text-anchor="middle" font-size="10" class="t-mut">Sonnet</text>
        <rect x="250" y="24" width="200" height="120" rx="2" class="box"/>
        <rect x="250" y="24" width="200" height="26" class="fill-track"/>
        <text x="350" y="42" text-anchor="middle" font-size="11" class="t-pri">● чат 2</text>
        <text x="350" y="92" text-anchor="middle" font-size="13">личный кабинет</text>
        <text x="350" y="116" text-anchor="middle" font-size="10" class="t-mut">Sonnet</text>
        <rect x="480" y="24" width="200" height="120" rx="2" class="box"/>
        <rect x="480" y="24" width="200" height="26" class="fill-track"/>
        <text x="580" y="42" text-anchor="middle" font-size="11" class="t-pri">● чат 3</text>
        <text x="580" y="92" text-anchor="middle" font-size="13">дашборд</text>
        <text x="580" y="116" text-anchor="middle" font-size="10" class="t-mut">Sonnet</text>
      </svg>
      <div class="note-fig-cap">Схема 3 · три потока одновременно — пока один думает, в другом продолжаешь работу</div>
    </div>

    <p class="note-end">Дальше: <em>урок 2</em> — где и как работать с Claude (токены, лимиты, модели, безопасность),
       и <em>урок 3</em> — в чём волшебство проектов.</p>
  `;

  /* ═══════════════════════════════════════════════════════════
   * M1 · Урок 2 — Где и как работать · лайфхаки и типовые ошибки
   * ═══════════════════════════════════════════════════════════ */
  L['m1.l2'] = lead(
    'Где именно работать с Claude, как устроены токены и лимиты, какие модели когда брать и лайфхаки — ' +
    'включая то, как не словить бан в РФ. Хорошая новость: <em>на старте всё уже готово на нашем портале</em> — ' +
    'платить и возиться с VPN самим не нужно.'
  ) + `
    <div class="note-toc">
      <span class="note-toc-chip">доступ через портал</span>
      <span class="note-toc-chip">что такое токен</span>
      <span class="note-toc-chip">лимиты сессий</span>
      <span class="note-toc-chip">тарифы</span>
      <span class="note-toc-chip">3 модели</span>
      <span class="note-toc-chip">3 способа работать</span>
      <span class="note-toc-chip">установка</span>
      <span class="note-toc-chip">безопасность</span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">1</span>Старт без боли: доступ уже на портале</h2>
    <p>На старте <strong>не нужно</strong> сразу покупать подписку, заводить карты, ловить SMS и настраивать VPN.
       Ваш рабочий стол (VS Code в браузере) уже открывается прямо на vibe-портале, и Claude в нём
       <strong>ходит через нашу подписку</strong>. Вам не нужен ни свой ключ, ни VPN — это всё на стороне портала.</p>
    <div class="note-fig">
      <svg viewBox="0 0 700 170" role="img" aria-label="Как Claude работает через портал">
        <defs>
          <marker id="l2f0p" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="fill-pri"/></marker>
        </defs>
        <rect x="14" y="44" width="196" height="72" rx="2" class="box-pri"/>
        <text x="112" y="74" text-anchor="middle" font-size="12" class="t-pri">Ваш стол на портале</text>
        <text x="112" y="94" text-anchor="middle" font-size="10" class="t-mut">VS Code + Claude</text>
        <rect x="266" y="44" width="170" height="72" rx="2" class="box"/>
        <text x="351" y="74" text-anchor="middle" font-size="12">Портал KG</text>
        <text x="351" y="94" text-anchor="middle" font-size="10" class="t-mut">подписка Claude</text>
        <rect x="492" y="44" width="190" height="72" rx="2" class="box"/>
        <text x="587" y="74" text-anchor="middle" font-size="12">Claude · Anthropic</text>
        <text x="587" y="94" text-anchor="middle" font-size="10" class="t-mut">дата-центр</text>
        <line x1="210" y1="80" x2="264" y2="80" class="ln-pri" marker-end="url(#l2f0p)"/>
        <line x1="436" y1="80" x2="490" y2="80" class="ln-pri" marker-end="url(#l2f0p)"/>
        <text x="350" y="146" text-anchor="middle" font-size="11" class="t-grn">ключ и VPN на вашей стороне НЕ нужны — всё берёт на себя портал</text>
      </svg>
      <div class="note-fig-cap">Схема 1 · ваши запросы к Claude идут через подписку портала</div>
    </div>
    <div class="note-callout is-tip">
      <span class="note-callout-ic">✅</span>
      <span class="note-callout-body">
        <span class="note-callout-label">задача урока</span>
        Сначала сделать <strong>первое приложение</strong> на готовом доступе. Покупкой, регистрацией и обходом
        блокировок займёмся спокойно отдельно (модуль 2) — это отдельный путь с кучей нюансов.
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">2</span>Что такое токен</h2>
    <p>Claude считает <strong>токены</strong> — это «кусочки» текста (примерно часть слова). Тратятся и <strong>ваш запрос</strong>,
       и <strong>ответ модели</strong>: чем длиннее переписка и чем больше файлов в контексте — тем больше токенов уходит.</p>
    <div class="note-fig">
      <svg viewBox="0 0 700 120" role="img" aria-label="Что такое токен">
        <text x="14" y="28" font-size="11" class="t-mut">«сделай дашборд продаж» →</text>
        <rect x="14"  y="40" width="66" height="30" rx="2" class="box"/><text x="47"  y="60" text-anchor="middle" font-size="12">сде</text>
        <rect x="86"  y="40" width="66" height="30" rx="2" class="box"/><text x="119" y="60" text-anchor="middle" font-size="12">лай</text>
        <rect x="158" y="40" width="74" height="30" rx="2" class="box"/><text x="195" y="60" text-anchor="middle" font-size="12">дашборд</text>
        <rect x="238" y="40" width="60" height="30" rx="2" class="box"/><text x="268" y="60" text-anchor="middle" font-size="12">про</text>
        <rect x="304" y="40" width="66" height="30" rx="2" class="box"/><text x="337" y="60" text-anchor="middle" font-size="12">даж</text>
        <text x="400" y="60" font-size="12" class="t-mut">≈ 5 токенов</text>
        <text x="14" y="100" font-size="11" class="t-pri">расход = токены запроса (вход) + токены ответа (выход)</text>
      </svg>
      <div class="note-fig-cap">Схема 2 · токен ≈ кусочек слова; платим и за вход, и за выход</div>
    </div>
    <p>Лимиты двухуровневые:</p>
    <ul>
      <li><strong>5-часовая сессия</strong> — пул токенов, который обнуляется (восстанавливается) каждые 5 часов.</li>
      <li><strong>Недельный лимит</strong> — общий потолок поверх сессий.</li>
    </ul>
    <div class="note-fig">
      <svg viewBox="0 0 700 190" role="img" aria-label="Лимиты: 5-часовая сессия и недельный лимит">
        <text x="12" y="30" font-size="12" class="t-pri">5-часовая сессия</text>
        <rect x="12" y="40" width="470" height="24" rx="2" class="fill-track"/>
        <rect x="12" y="40" width="300" height="24" rx="2" class="fill-pri"/>
        <text x="500" y="56" font-size="11" class="t-mut">↻ обнуляется каждые 5 часов</text>
        <text x="12" y="108" font-size="12" class="t-org">недельный лимит</text>
        <rect x="12" y="118" width="600" height="24" rx="2" class="fill-track"/>
        <rect x="12" y="118" width="470" height="24" rx="2" class="fill-pri"/>
        <line x1="130" y1="118" x2="130" y2="142" class="ln"/>
        <line x1="248" y1="118" x2="248" y2="142" class="ln"/>
        <line x1="366" y1="118" x2="366" y2="142" class="ln"/>
        <text x="12" y="170" font-size="11" class="t-mut">выжигаешь сессии «под ноль» → недельный лимит кончился за ~3 дня → ждём неделю</text>
      </svg>
      <div class="note-fig-cap">Схема 3 · сессии восстанавливаются каждые 5 ч, но есть общий недельный потолок</div>
    </div>
    <div class="note-callout is-warn">
      <span class="note-callout-ic">⚠️</span>
      <span class="note-callout-body">
        <span class="note-callout-label">типовая ошибка</span>
        Не гонитесь «выжать» каждую 5-часовую сессию под ноль — упрётесь в недельный лимит и будете ждать. Дозируйте нагрузку.
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">3</span>Тарифы и лайфхак</h2>
    <div class="note-cmp-wrap">
      <table class="note-cmp">
        <thead><tr><th>Тариф</th><th>≈ в месяц</th><th>Что внутри</th></tr></thead>
        <tbody>
          <tr><td>$20</td><td>≈ 1 600 ₽</td><td>Sonnet, базовый лимит — хватит на первое приложение</td></tr>
          <tr><td>$100</td><td>≈ 8 000 ₽</td><td>больше токенов, доступ к Opus спокойнее</td></tr>
          <tr><td>$200</td><td>≈ 16 000 ₽</td><td>максимум лимитов под плотную работу</td></tr>
        </tbody>
      </table>
    </div>
    <div class="note-callout is-tip">
      <span class="note-callout-ic">💡</span>
      <span class="note-callout-body">
        <span class="note-callout-label">лайфхак</span>
        Вместо одной дорогой подписки часто выгоднее <strong>два аккаунта по $20</strong> и переключаться между ними —
        суммарный лимит больше, а денег не жалко.
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">4</span>Три модели: Haiku · Sonnet · Opus</h2>
    <ul>
      <li><strong>Haiku</strong> — маленькая и быстрая, для коротких ответов.</li>
      <li><strong>Sonnet</strong> — «боевая» рабочая модель. Большинство малых/средних проектов и операционка — на ней. В вайбе стоит по умолчанию, и её хватит за глаза.</li>
      <li><strong>Opus</strong> — самая мощная, для больших проектов и большого контекста. Ест токены быстрее и иногда «перемудривает» — вместо прямого действия начинает анализировать и предлагать своё.</li>
    </ul>
    <div class="note-fig">
      <svg viewBox="0 0 700 200" role="img" aria-label="Модели Haiku, Sonnet, Opus">
        <defs>
          <marker id="l2f2p" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="fill-mut"/></marker>
        </defs>
        <polyline points="60,170 270,130 490,80" style="fill:none;stroke:hsl(var(--muted-foreground));stroke-width:1.4;stroke-dasharray:4 4"/>
        <rect x="40" y="150" width="160" height="40" rx="2" class="box"/>
        <text x="120" y="168" text-anchor="middle" font-size="13">Haiku</text>
        <text x="120" y="183" text-anchor="middle" font-size="9" class="t-mut">быстро · коротко</text>
        <rect x="250" y="110" width="170" height="40" rx="2" class="box-pri"/>
        <text x="335" y="128" text-anchor="middle" font-size="13" class="t-pri">Sonnet</text>
        <text x="335" y="143" text-anchor="middle" font-size="9" class="t-pri">рабочая · по умолчанию</text>
        <rect x="470" y="60" width="180" height="40" rx="2" class="box"/>
        <text x="560" y="78" text-anchor="middle" font-size="13">Opus</text>
        <text x="560" y="93" text-anchor="middle" font-size="9" class="t-mut">мощно · ест токены</text>
        <line x1="40" y1="40" x2="650" y2="40" class="ln" marker-end="url(#l2f2p)"/>
        <text x="40" y="30" font-size="10" class="t-mut">скорость, экономия</text>
        <text x="650" y="30" text-anchor="end" font-size="10" class="t-mut">мощность, расход токенов →</text>
      </svg>
      <div class="note-fig-cap">Схема 4 · чем мощнее модель, тем больше расход. По умолчанию — Sonnet, Opus берём под крупное</div>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">5</span>Где работать: браузер / приложение / терминал</h2>
    <div class="note-fig">
      <svg viewBox="0 0 700 180" role="img" aria-label="Три способа работать с Claude">
        <rect x="15" y="24" width="210" height="138" rx="2" class="box"/>
        <rect x="15" y="24" width="210" height="28" class="fill-track"/>
        <text x="120" y="43" text-anchor="middle" font-size="11">Браузер · claude.ai</text>
        <text x="120" y="84" text-anchor="middle" font-size="11" class="t-mut">как ChatGPT</text>
        <text x="120" y="104" text-anchor="middle" font-size="11" class="t-mut">файлы, совет</text>
        <text x="120" y="140" text-anchor="middle" font-size="11" class="t-red">код НЕ выполняет</text>
        <rect x="245" y="24" width="210" height="138" rx="2" class="box"/>
        <rect x="245" y="24" width="210" height="28" class="fill-track"/>
        <text x="350" y="43" text-anchor="middle" font-size="11">Приложение Claude</text>
        <text x="350" y="84" text-anchor="middle" font-size="11" class="t-mut">тот же чат</text>
        <text x="350" y="104" text-anchor="middle" font-size="11" class="t-mut">на десктопе</text>
        <text x="350" y="140" text-anchor="middle" font-size="11" class="t-mut">тяжелит — почти не юзаем</text>
        <rect x="475" y="24" width="210" height="138" rx="2" class="box-pri"/>
        <rect x="475" y="24" width="210" height="28" style="fill:hsl(var(--primary) / .2)"/>
        <text x="580" y="43" text-anchor="middle" font-size="11" class="t-pri">Терминал + Claude Code</text>
        <text x="580" y="84" text-anchor="middle" font-size="11">сам пишет и правит файлы</text>
        <text x="580" y="104" text-anchor="middle" font-size="11">выполняет команды</text>
        <text x="580" y="140" text-anchor="middle" font-size="11" class="t-pri">★ рабочий режим</text>
      </svg>
      <div class="note-fig-cap">Схема 5 · в браузере — советуемся, в терминале с Claude Code — реально делаем</div>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">6</span>Установка Claude Code</h2>
    <p>Ставится одной командой в терминал (терминал есть и в macOS, и в Windows). На странице Claude Code жмём <span class="kbd">install</span> и копируем команду.</p>
    <ol class="note-steps">
      <li>Открыть терминал (в macOS / Windows он уже есть).</li>
      <li>Вставить команду установки со страницы Claude Code и нажать <span class="kbd">Enter</span>.</li>
      <li>Авторизоваться под своим аккаунтом (или нашим доступом).</li>
      <li>Готово — дальше работаем из VS Code.</li>
    </ol>
    <div class="note-callout is-tip">
      <span class="note-callout-ic">🧩</span>
      <span class="note-callout-body">
        <span class="note-callout-label">а на портале — уже стоит</span>
        В воркспейсе на портале Claude Code и расширения VS Code уже установлены. Эта установка нужна,
        когда будете разворачивать своё рабочее место (модуль 2).
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">7</span>Лайфхак: чат «Claude для компании»</h2>
    <p>В браузере создайте отдельный проект-чат — например <span class="kbd">Claude для компании</span> — и складывайте туда
       свою «памятку»: как ставить терминал, какие команды, ваши настройки и ключи-подсказки.</p>
    <ul>
      <li>Зашли с нового устройства или ставите коллеге — всё под рукой.</li>
      <li>Можно спрашивать «что не получается», советоваться по настройке Claude и обходу VPN.</li>
    </ul>

    <h2 class="note-h2"><span class="note-h2-no">8</span>Безопасность в РФ</h2>
    <div class="note-callout is-warn">
      <span class="note-callout-ic">🛡️</span>
      <span class="note-callout-body">
        <span class="note-callout-label">осторожно с VPN</span>
        Если работаете со своим аккаунтом в браузере — вы под VPN, и под «неправильным» VPN аккаунт
        <strong>реально могут забанить</strong>. Рабочий путь — один стабильный «выход» (через прокси/сервер).
        На нашем портале это уже решено: один стабильный канал — меньше риск бана.
      </span>
    </div>

    <p class="note-end">Дальше: <em>урок 3</em> — в чём волшебство проектов и почему чат ≠ проект (и как устроен ваш воркспейс на портале).</p>
  `;

  /* ═══════════════════════════════════════════════════════════
   * M1 · Урок 3 — В чём волшебство проектов · чаты vs проекты
   * ═══════════════════════════════════════════════════════════ */
  L['m1.l3'] = lead(
    'Тема простая, но даёт самый «вау-эффект». Коротко: чат теряет контекст между сессиями, ' +
    'а <em>проект — это папка с памятью</em>: весь контекст хранится в ней и едет вместе с папкой между машинами ' +
    'и серверами. Сердце проекта — файл <em>CLAUDE.md</em>. Ниже — на реальном устройстве вашего воркспейса на портале.'
  ) + `
    <div class="note-toc">
      <span class="note-toc-chip">проблема чатов</span>
      <span class="note-toc-chip">проект = папка с памятью</span>
      <span class="note-toc-chip">ваш воркспейс на портале</span>
      <span class="note-toc-chip">CLAUDE.md</span>
      <span class="note-toc-chip">структура проекта</span>
      <span class="note-toc-chip">из шаблона → онбординг</span>
      <span class="note-toc-chip">VS Code · 4 зоны</span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">1</span>Проблема: между чатами контекст не переносится</h2>
    <p>Чат — облачная штука: отправили запрос → получили ответ. Но <strong>новый чат не помнит</strong>, что было в старом.
       Между чатами контекст не перекидывается — раньше именно это вызывало отторжение.</p>
    <p>Полумера — «проекты» в браузере: выгружаешь контекст один раз, дальше короткими сообщениями. Это обходной путь.</p>
    <div class="note-fig">
      <svg viewBox="0 0 700 150" role="img" aria-label="Контекст не переносится между чатами">
        <text x="350" y="26" text-anchor="middle" font-size="11" class="t-red">контекст не переносится между чатами</text>
        <rect x="40" y="50" width="150" height="60" rx="2" class="box"/><text x="115" y="86" text-anchor="middle" font-size="13">Чат 1</text>
        <rect x="275" y="50" width="150" height="60" rx="2" class="box"/><text x="350" y="86" text-anchor="middle" font-size="13">Чат 2</text>
        <rect x="510" y="50" width="150" height="60" rx="2" class="box"/><text x="585" y="86" text-anchor="middle" font-size="13">Чат 3</text>
        <line x1="195" y1="80" x2="270" y2="80" class="ln-dash"/>
        <text x="232" y="74" text-anchor="middle" font-size="16" class="t-red">✕</text>
        <line x1="430" y1="80" x2="505" y2="80" class="ln-dash"/>
        <text x="467" y="74" text-anchor="middle" font-size="16" class="t-red">✕</text>
      </svg>
      <div class="note-fig-cap">Схема 1 · каждый новый чат начинает «с чистого листа»</div>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">2</span>Проект = папка с памятью</h2>
    <p>Проект — это <strong>физическая папка</strong>. В ней весь контекст: история работы, коммуникация, описание проекта.
       Папку можно перекинуть с компьютера на сервер, с сервера на сервер — контекст едет вместе с ней.</p>
    <p>Когда открываешь папку в новом VS Code, Claude считывает её ключевые файлы (CLAUDE.md, <span class="kbd">.claude/</span>) и <strong>сразу понимает контекст</strong>.</p>
    <div class="note-callout is-key">
      <span class="note-callout-ic">🪄</span>
      <span class="note-callout-body">
        <span class="note-callout-label">в этом всё волшебство</span>
        Проект самодостаточен: переносишь папку — и Claude «вспоминает» всё, что вы делали.
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">3</span>Ваш воркспейс на портале — как это устроено реально</h2>
    <p>На vibe-портале у каждого ученика — свой изолированный «рабочий стол» (контейнер с VS Code). Внутри вы видите
       <strong>только три вещи</strong>: свою папку с проектами, общие шаблоны курса и общие скиллы. Чужие файлы и сервер недоступны.</p>
    <div class="note-fig">
      <svg viewBox="0 0 700 250" role="img" aria-label="Воркспейс ученика на портале">
        <defs>
          <marker id="l3wp" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="fill-pri"/></marker>
        </defs>
        <rect x="14" y="30" width="560" height="206" rx="3" class="box-dash"/>
        <text x="28" y="50" font-size="11" class="t-pri">контейнер vibe-&lt;вы&gt; · code-server (ваш VS Code в браузере)</text>

        <rect x="30" y="64" width="300" height="158" rx="2" class="box-pri"/>
        <text x="46" y="84" font-size="11" class="t-pri">workspace/  (ваша папка, можно менять)</text>
        <text x="46" y="108" font-size="11">📄 CLAUDE.md — правила воркспейса</text>
        <text x="46" y="132" font-size="11">📁 пульт24/ — проект</text>
        <text x="46" y="156" font-size="11">📁 лендинг/ — проект</text>
        <text x="46" y="180" font-size="11">📁 …</text>
        <text x="46" y="206" font-size="9" class="t-mut">видна только вам</text>

        <rect x="350" y="64" width="208" height="74" rx="2" class="box"/>
        <text x="364" y="84" font-size="11">templates/  (только чтение)</text>
        <text x="364" y="106" font-size="10" class="t-mut">_base · _b24-single-php</text>
        <text x="364" y="124" font-size="10" class="t-mut">+ показательные app-*</text>

        <rect x="350" y="148" width="208" height="74" rx="2" class="box"/>
        <text x="364" y="168" font-size="11">.claude/skills/  (только чтение)</text>
        <text x="364" y="190" font-size="10" class="t-mut">superpowers · claude-memory</text>
        <text x="364" y="208" font-size="10" class="t-mut">ui-ux-pro-max</text>

        <line x1="574" y1="100" x2="660" y2="100" class="ln-pri" marker-end="url(#l3wp)"/>
        <text x="640" y="90" text-anchor="end" font-size="9" class="t-pri">Claude</text>
        <text x="640" y="116" text-anchor="end" font-size="9" class="t-mut">через портал</text>
      </svg>
      <div class="note-fig-cap">Схема 2 · реальный воркспейс: ваша папка (rw) + шаблоны и скиллы (read-only). Соседей и сервер не видно</div>
    </div>
    <div class="note-callout is-tip">
      <span class="note-callout-ic">🧠</span>
      <span class="note-callout-body">
        <span class="note-callout-label">скиллы под рукой</span>
        В воркспейсе уже подключены скиллы: <strong>superpowers</strong> (общие практики),
        <strong>ui-ux-pro-max</strong> (frontend/UI) и <strong>claude-memory</strong> (структурная память проекта в <span class="kbd">.claude/memory/</span>).
        Подробно — в уроке про Skills.
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">4</span>CLAUDE.md — мозг проекта</h2>
    <p>В любом проекте у Claude должен быть файл <span class="kbd">CLAUDE.md</span> — главный файл.
       <strong>Первое, что делает Claude при запуске</strong> — читает его и понимает контекст. Внутри — ссылки на историю,
       память проекта, типовые ошибки, шаг, на котором остановились, changelog и ключи.</p>
    <div class="note-fig">
      <svg viewBox="0 0 700 250" role="img" aria-label="CLAUDE.md связывает контекст проекта">
        <line x1="350" y1="124" x2="105" y2="48" class="ln"/>
        <line x1="350" y1="124" x2="350" y2="38" class="ln"/>
        <line x1="350" y1="124" x2="595" y2="48" class="ln"/>
        <line x1="350" y1="124" x2="105" y2="203" class="ln"/>
        <line x1="350" y1="124" x2="350" y2="218" class="ln"/>
        <line x1="350" y1="124" x2="595" y2="203" class="ln"/>
        <rect x="40" y="30" width="130" height="36" rx="2" class="box"/><text x="105" y="52" text-anchor="middle" font-size="11">история</text>
        <rect x="285" y="20" width="130" height="36" rx="2" class="box"/><text x="350" y="42" text-anchor="middle" font-size="11">память проекта</text>
        <rect x="530" y="30" width="130" height="36" rx="2" class="box"/><text x="595" y="52" text-anchor="middle" font-size="11">changelog</text>
        <rect x="40" y="185" width="130" height="36" rx="2" class="box"/><text x="105" y="207" text-anchor="middle" font-size="11">типовые ошибки</text>
        <rect x="285" y="200" width="130" height="36" rx="2" class="box"/><text x="350" y="222" text-anchor="middle" font-size="11">ключи · .env</text>
        <rect x="530" y="185" width="130" height="36" rx="2" class="box"/><text x="595" y="207" text-anchor="middle" font-size="11">структура</text>
        <rect x="275" y="100" width="150" height="48" rx="2" class="box-pri"/>
        <text x="350" y="129" text-anchor="middle" font-size="14" class="t-pri">CLAUDE.md</text>
      </svg>
      <div class="note-fig-cap">Схема 3 · CLAUDE.md — точка входа, из которой Claude видит весь проект</div>
    </div>
    <p>Так выглядит начало реального CLAUDE.md из нашего шаблона <span class="kbd">_base</span> — обратите внимание,
       как он сразу задаёт Claude роль и правила:</p>
    <div class="note-quote">
      <span class="note-quote-label">templates/_base/CLAUDE.md · начало</span>
      ## КЛОДУ: Прочитай это первым делом<br><br>
      Ты помогаешь ученику курса VibeCoding запустить новый проект. Ученик — не разработчик. Объясняй просто,
      без технического жаргона. Если встречается незнакомый термин — объясни его в скобках.<br><br>
      <strong>Проверь наличие файла <span class="kbd">.onboarding-done</span> в корне проекта:</strong><br>
      • нет → онбординг не пройден. Напиши: «Привет! Давай настроим проект…» и иди по протоколу.<br>
      • есть → онбординг пройден. Читай раздел «О ПРОЕКТЕ» и работай.
    </div>

    <h2 class="note-h2"><span class="note-h2-no">5</span>Структура проекта (реальный шаблон _base)</h2>
    <p>Шаблоны уже содержат правильную структуру и инструкции. Вот что реально лежит в проекте, созданном из <span class="kbd">_base</span>:</p>
    <div class="note-fig">
      <svg viewBox="0 0 700 360" role="img" aria-label="Структура проекта из шаблона _base">
        <text x="20" y="28" font-size="13">📁 пульт24/</text>
        <line x1="34" y1="38" x2="34" y2="338" class="ln" style="stroke:hsl(var(--border))"/>
        <text x="46" y="56"  font-size="12.5" class="t-pri">├─ CLAUDE.md</text>            <text x="300" y="56"  font-size="11" class="t-pri">инструкции проекта (читается первым)</text>
        <text x="46" y="80"  font-size="12.5" class="t-grn">├─ .onboarding-done</text>     <text x="300" y="80"  font-size="11" class="t-grn">маркер: онбординг пройден</text>
        <text x="46" y="104" font-size="12.5">├─ .claude/</text>                                <text x="300" y="104" font-size="11" class="t-mut">настройки и память проекта</text>
        <text x="66" y="126" font-size="12" class="t-mut">│   ├─ commands/</text>                       <text x="300" y="126" font-size="11" class="t-mut">скиллы проекта (/deploy …)</text>
        <text x="66" y="148" font-size="12" class="t-mut">│   └─ settings.local.json</text>             <text x="300" y="148" font-size="11" class="t-mut">разрешения + MCP-серверы</text>
        <text x="46" y="172" font-size="12.5" class="t-org">├─ .env</text>                  <text x="300" y="172" font-size="11" class="t-org">ключи — секрет, не в git</text>
        <text x="46" y="196" font-size="12.5">├─ .env.example</text>                            <text x="300" y="196" font-size="11" class="t-mut">шаблон переменных без значений</text>
        <text x="46" y="220" font-size="12.5">├─ package.json</text>                            <text x="300" y="220" font-size="11" class="t-mut">зависимости (Node.js)</text>
        <text x="46" y="244" font-size="12.5">├─ deploy.sh</text>                               <text x="300" y="244" font-size="11" class="t-mut">деплой на Vibecode</text>
        <text x="46" y="268" font-size="12.5">├─ docs/</text>                                   <text x="300" y="268" font-size="11" class="t-mut">project-brief.md · changelog.md</text>
        <text x="46" y="292" font-size="12.5">├─ src/</text>                                    <text x="300" y="292" font-size="11" class="t-mut">server.js · check.js · public/ (фронт)</text>
        <text x="46" y="316" font-size="12.5">└─ data/</text>                                   <text x="300" y="316" font-size="11" class="t-mut">кеш и локальные данные (не в git)</text>
      </svg>
      <div class="note-fig-cap">Схема 4 · реальная структура проекта _base. CLAUDE.md задаёт контекст, .env держит ключ в секрете</div>
    </div>
    <p>Ключи никогда не попадают в код и в git — только в <span class="kbd">.env</span> (он в <span class="kbd">.gitignore</span>).
       В репозиторий едет лишь <span class="kbd">.env.example</span> — шаблон без значений.</p>
    <div class="note-quote">
      <span class="note-quote-label">.env (пример из _base)</span>
      VIBE_API_KEY=vibe_api_…  &nbsp;<span style="color:hsl(var(--muted-foreground))"># ключ портала</span><br>
      VIBE_BASE_URL=https://vibecode.bitrix24.tech/v1<br>
      SERVER_ID=  &nbsp;<span style="color:hsl(var(--muted-foreground))"># заполнится после первого деплоя</span><br>
      PORT=3000
    </div>
    <div class="note-cmp-wrap">
      <table class="note-cmp">
        <thead><tr><th>Тип ключа</th><th>Префикс</th><th>Когда использовать</th></tr></thead>
        <tbody>
          <tr><td>API-ключ</td><td>vibe_api_…</td><td>личный дашборд, один портал, все видят одни данные</td></tr>
          <tr><td>OAuth-приложение</td><td>vibe_app_…</td><td>команда: каждый входит своим аккаунтом Б24</td></tr>
          <tr><td>Менеджмент</td><td>vibe_live_…</td><td>только администрирование, не для данных</td></tr>
        </tbody>
      </table>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">6</span>Из шаблона → онбординг → работа</h2>
    <p>Кнопка «Из шаблона» на портале делает простую вещь: <strong>копирует</strong> шаблон в ваш воркспейс,
       подставляет имя проекта вместо <span class="kbd">{{PROJECT_NAME}}</span> и открывает его в VS Code.</p>
    <div class="note-fig">
      <svg viewBox="0 0 700 130" role="img" aria-label="Жизненный цикл проекта из шаблона">
        <defs>
          <marker id="l3lcp" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="fill-pri"/></marker>
        </defs>
        <rect x="14" y="46" width="130" height="44" rx="2" class="box"/>
        <text x="79" y="66" text-anchor="middle" font-size="11">шаблон _base</text>
        <text x="79" y="82" text-anchor="middle" font-size="9" class="t-mut">read-only</text>
        <rect x="206" y="46" width="140" height="44" rx="2" class="box-pri"/>
        <text x="276" y="66" text-anchor="middle" font-size="11" class="t-pri">ваш проект</text>
        <text x="276" y="82" text-anchor="middle" font-size="9" class="t-mut">копия в workspace</text>
        <rect x="408" y="46" width="130" height="44" rx="2" class="box"/>
        <text x="473" y="66" text-anchor="middle" font-size="11">онбординг</text>
        <text x="473" y="82" text-anchor="middle" font-size="9" class="t-mut">8 вопросов</text>
        <rect x="600" y="46" width="90" height="44" rx="2" class="box-grn"/>
        <text x="645" y="66" text-anchor="middle" font-size="11" class="t-grn">работа</text>
        <text x="645" y="82" text-anchor="middle" font-size="9" class="t-mut">+ деплой</text>
        <line x1="144" y1="68" x2="204" y2="68" class="ln-pri" marker-end="url(#l3lcp)"/>
        <text x="174" y="60" text-anchor="middle" font-size="8" class="t-mut">копия</text>
        <line x1="346" y1="68" x2="406" y2="68" class="ln-pri" marker-end="url(#l3lcp)"/>
        <text x="376" y="60" text-anchor="middle" font-size="8" class="t-mut">привет</text>
        <line x1="538" y1="68" x2="598" y2="68" class="ln-pri" marker-end="url(#l3lcp)"/>
      </svg>
      <div class="note-fig-cap">Схема 5 · из read-only шаблона рождается ваш проект, который проходит онбординг и идёт в работу</div>
    </div>
    <p>Что делает Claude при <strong>первом запуске</strong> проекта — это и есть онбординг, прописанный в CLAUDE.md:</p>
    <div class="note-fig">
      <svg viewBox="0 0 700 230" role="img" aria-label="Онбординг: что делает Claude при первом запуске">
        <defs>
          <marker id="l3obp" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="fill-mut"/></marker>
        </defs>
        <rect x="20" y="20" width="180" height="40" rx="2" class="box"/>
        <text x="110" y="44" text-anchor="middle" font-size="11">читает CLAUDE.md</text>
        <polygon points="110,80 230,120 110,160 -10,120" class="box-pri" transform="translate(110,0)"/>
        <text x="220" y="116" text-anchor="middle" font-size="10" class="t-pri">есть файл</text>
        <text x="220" y="132" text-anchor="middle" font-size="10" class="t-pri">.onboarding-done?</text>
        <line x1="110" y1="60" x2="170" y2="86" class="ln" marker-end="url(#l3obp)"/>

        <text x="318" y="96" font-size="10" class="t-red">нет</text>
        <line x1="330" y1="105" x2="408" y2="80" class="ln" marker-end="url(#l3obp)"/>
        <rect x="410" y="58" width="270" height="40" rx="2" class="box"/>
        <text x="545" y="82" text-anchor="middle" font-size="11">задаёт 8 вопросов — по одному</text>
        <line x1="545" y1="98" x2="545" y2="124" class="ln" marker-end="url(#l3obp)"/>
        <rect x="410" y="126" width="270" height="48" rx="2" class="box-grn"/>
        <text x="545" y="148" text-anchor="middle" font-size="10.5" class="t-grn">заполняет «О ПРОЕКТЕ» в CLAUDE.md,</text>
        <text x="545" y="164" text-anchor="middle" font-size="10.5" class="t-grn">создаёт .onboarding-done + project-brief</text>

        <text x="250" y="176" font-size="10" class="t-grn">да</text>
        <line x1="230" y1="150" x2="240" y2="196" class="ln" marker-end="url(#l3obp)"/>
        <rect x="120" y="196" width="240" height="34" rx="2" class="box"/>
        <text x="240" y="217" text-anchor="middle" font-size="11">работает в контексте проекта</text>
      </svg>
      <div class="note-fig-cap">Схема 6 · нет маркера — Claude проводит онбординг; есть — сразу работает в контексте</div>
    </div>
    <p>Онбординг — это 8 вопросов по одному (название, портал Б24, где разместим, как подключаемся, где открывается,
       нужен ли бэкенд, дизайн, авторизация). После ответов Claude заполняет раздел «О ПРОЕКТЕ» прямо в CLAUDE.md:</p>
    <div class="note-quote">
      <span class="note-quote-label">CLAUDE.md · «О ПРОЕКТЕ» после онбординга (пример)</span>
      Название: <strong>Пульт24</strong><br>
      Описание: дашборд аналитики продаж для менеджеров<br>
      Портал Б24: company.bitrix24.ru<br>
      Размещение: Vibecode &nbsp;·&nbsp; Подключение: API-ключ (vibe_api_…)<br>
      Где открывается: внутри Битрикс24 &nbsp;·&nbsp; Бэкенд: только фронт<br>
      Дизайн: стиль Битрикс24 &nbsp;·&nbsp; Авторизация: не нужна
    </div>

    <h2 class="note-h2"><span class="note-h2-no">7</span>VS Code: 4 зоны рабочего места</h2>
    <div class="note-fig">
      <svg viewBox="0 0 700 300" role="img" aria-label="Четыре зоны VS Code">
        <rect x="20" y="20" width="660" height="262" rx="3" class="box"/>
        <rect x="20" y="20" width="660" height="28" class="fill-track"/>
        <text x="40" y="39" font-size="11" class="t-mut">VS Code</text>
        <rect x="32" y="60" width="150" height="210" rx="2" class="box"/>
        <text x="107" y="155" text-anchor="middle" font-size="12">Файлы</text>
        <text x="107" y="175" text-anchor="middle" font-size="10" class="t-mut">дерево проекта</text>
        <rect x="194" y="60" width="330" height="120" rx="2" class="box"/>
        <text x="359" y="115" text-anchor="middle" font-size="12">Редактор</text>
        <text x="359" y="135" text-anchor="middle" font-size="10" class="t-mut">просмотр и правка кода</text>
        <rect x="194" y="192" width="330" height="78" rx="2" class="box-pri"/>
        <text x="359" y="226" text-anchor="middle" font-size="12" class="t-pri">Терминал</text>
        <text x="359" y="246" text-anchor="middle" font-size="10" class="t-pri">здесь работает Claude Code</text>
        <rect x="536" y="60" width="132" height="210" rx="2" class="box-dash"/>
        <text x="602" y="150" text-anchor="middle" font-size="11" class="t-mut">Чат / агенты</text>
        <text x="602" y="170" text-anchor="middle" font-size="9" class="t-mut">встроенный — не</text>
        <text x="602" y="183" text-anchor="middle" font-size="9" class="t-mut">используем</text>
      </svg>
      <div class="note-fig-cap">Схема 7 · файлы · редактор · терминал (Claude Code) · справа встроенный чат — его не трогаем</div>
    </div>
    <ul>
      <li>Расширение <strong>Claude Code</strong> ставится в VS Code — выбирайте именно его (у него ~15 млн установок, самое популярное). На портале оно уже стоит.</li>
      <li><strong>Remote Explorer / SSH</strong> — чтобы подключаться к своему серверу (IP, логин, пароль или ключ), когда будете арендовать VPS.</li>
    </ul>

    <h2 class="note-h2"><span class="note-h2-no">8</span>Волшебство на практике</h2>
    <ol class="note-steps">
      <li>Скопировал <span class="kbd">CLAUDE.md</span> из готового шаблона.</li>
      <li>Создал абсолютно новый пустой проект и положил туда только этот файл.</li>
      <li>Открыл папку в VS Code → «создай структуру папок и сделай онбординг».</li>
      <li>Claude прочитал CLAUDE.md, развернул структуру и сразу оказался в контексте проекта.</li>
    </ol>
    <p>Так же работает перенос «живого» проекта: например, dev-портал автор изначально собирал в одном длинном чате
       (аренда сервера, Ubuntu, Docker). Этот чат не зависит от его сервера — поэтому из браузера, с любой точки мира,
       можно «починить» сервер, даже находясь в командировке.</p>

    <p class="note-end">Дальше: <em>урок 4</em> — как организовать проект под любую модель, и <em>урок 5</em> — подробно про CLAUDE.md.</p>
  `;

  window.LESSON_NOTES = L;
})();

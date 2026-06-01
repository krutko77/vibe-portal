/* ============================================================
 * Конспекты модуля 1 курса Vibecoding.
 * Источник — расшифровки трёх записей мастер-классов (27–28.05).
 * Каждый ключ "mN.lK" → готовый HTML тела конспекта, который
 * app.js вставляет в #course-content вместо плейсхолдера.
 * Диаграммы — инлайн-SVG, цвета берутся из токенов темы (css/style.css,
 * блок ".note-fig svg ..."), поэтому корректны в тёмной и светлой теме.
 * ============================================================ */
(function () {
  const L = {};

  /* ── M1 · Урок 1 ─────────────────────────────────────────── */
  L['m1.l1'] = `
    <p class="note-lead muted" style="font-size:14px;line-height:1.6;color:hsl(var(--muted-foreground));margin-bottom:18px">
      Вводный урок: что такое Claude, как он вообще устроен «под капотом» и чем
      отличается от ChatGPT, Cursor, Codex и DeepSeek. Главный вывод —
      рабочая связка, которую мы используем весь курс: <em>Claude Code + VS Code</em>.
    </p>
    <div class="note-toc">
      <span class="note-toc-chip">модель и дата-центр</span>
      <span class="note-toc-chip">3 способа обращения</span>
      <span class="note-toc-chip">сравнение инструментов</span>
      <span class="note-toc-chip">почему Claude Code</span>
      <span class="note-toc-chip">скорость и потоки</span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">1</span>Модель живёт в дата-центре — а мы к ней обращаемся</h2>
    <p>Нейросеть (модель) — это <strong>не программа на вашем компьютере</strong>.
       Она «живёт» и считает на серверах компании-производителя — в дата-центре.
       У Anthropic это <strong>Claude</strong>, у OpenAI — ChatGPT и Codex, есть китайские модели и DeepSeek.</p>
    <p>Мы лишь отправляем запрос (промт) → дата-центр считает → возвращает готовый ответ.
       Инструмент (чат, терминал, IDE) — это «ручка», через которую мы дотягиваемся до модели.</p>

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

    <h2 class="note-h2"><span class="note-h2-no">3</span>Сравнение инструментов</h2>
    <p>Принципиальное различие: модель <strong>«напрямую от производителя»</strong> (Claude Code от Anthropic, Codex от OpenAI)
       против <strong>агрегатора</strong> (Cursor — туда можно подключить любую модель). Они работают по-разному.</p>
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

    <h2 class="note-h2"><span class="note-h2-no">4</span>Почему именно Claude Code</h2>
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

    <h2 class="note-h2"><span class="note-h2-no">5</span>Скорость и работа в несколько потоков</h2>
    <p>Когда работаешь с моделями постоянно, важна и <strong>скорость ответа</strong>. Можно держать несколько окон
       одновременно — разные задачи одного или разных проектов, которые не мешают друг другу.</p>

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
      <div class="note-fig-cap">Схема 2 · три потока одновременно — пока один думает, в другом продолжаешь работу</div>
    </div>

    <p class="note-end">Дальше: <em>урок 2</em> — где и как работать с Claude (токены, лимиты, модели, безопасность),
       и <em>урок 3</em> — в чём волшебство проектов.</p>
  `;

  /* ── M1 · Урок 2 ─────────────────────────────────────────── */
  L['m1.l2'] = `
    <p class="note-lead muted" style="font-size:14px;line-height:1.6;color:hsl(var(--muted-foreground));margin-bottom:18px">
      Где именно работать с Claude, как устроены токены и лимиты, какие модели когда брать
      и лайфхаки — включая то, как не словить бан в РФ. Хорошая новость:
      <em>на старте всё уже готово на нашем портале</em> — платить и возиться с VPN самим не нужно.
    </p>
    <div class="note-toc">
      <span class="note-toc-chip">доступ через портал</span>
      <span class="note-toc-chip">токены и лимиты</span>
      <span class="note-toc-chip">3 модели</span>
      <span class="note-toc-chip">3 способа работать</span>
      <span class="note-toc-chip">установка</span>
      <span class="note-toc-chip">безопасность</span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">1</span>Старт без боли: всё уже на нашем портале</h2>
    <p>На старте <strong>не нужно</strong> сразу покупать подписку, заводить карты, ловить SMS-подтверждения и настраивать VPN.
       На vibe-портале у вас уже есть доступ к Claude и к нашей подписке — для тестов и первого приложения этого достаточно.</p>
    <div class="note-callout is-tip">
      <span class="note-callout-ic">✅</span>
      <span class="note-callout-body">
        <span class="note-callout-label">задача урока</span>
        Сначала сделать <strong>первое приложение</strong> на готовом доступе. Покупкой, регистрацией и обходом блокировок
        займёмся спокойно отдельно (модуль 2) — это отдельный путь с кучей нюансов.
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">2</span>Как устроены токены и лимиты</h2>
    <p>Claude считает <strong>токены</strong> — объём текста на вход и выход. Лимиты двухуровневые:</p>
    <ul>
      <li><strong>5-часовая сессия</strong> — пул токенов, который обнуляется (восстанавливается) каждые 5 часов.</li>
      <li><strong>Недельный лимит</strong> — общий потолок поверх сессий.</li>
    </ul>

    <div class="note-fig">
      <svg viewBox="0 0 700 190" role="img" aria-label="Токены: 5-часовая сессия и недельный лимит">
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
      <div class="note-fig-cap">Схема 1 · сессии восстанавливаются каждые 5 ч, но есть общий недельный потолок</div>
    </div>

    <div class="note-callout is-warn">
      <span class="note-callout-ic">⚠️</span>
      <span class="note-callout-body">
        <span class="note-callout-label">типовая ошибка</span>
        Не гонитесь «выжать» каждую 5-часовую сессию под ноль — упрётесь в недельный лимит и будете ждать.
        Дозируйте нагрузку.
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">3</span>Тарифы и лайфхак</h2>
    <ul>
      <li><strong>$20</strong> — минимальная подписка (Sonnet, базовый лимит).</li>
      <li><strong>$100 / $200</strong> — больше лимиты (≈ 8 000 ₽ за $100).</li>
    </ul>
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
        <polyline points="60,170 270,130 490,80" class="ln-dash" style="stroke:hsl(var(--muted-foreground));stroke-dasharray:4 4"/>
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
      <div class="note-fig-cap">Схема 2 · чем мощнее модель, тем больше расход. По умолчанию — Sonnet, Opus берём под крупное</div>
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
      <div class="note-fig-cap">Схема 3 · в браузере — советуемся, в терминале с Claude Code — реально делаем</div>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">6</span>Установка Claude Code</h2>
    <p>Ставится одной командой в терминал (терминал есть и в macOS, и в Windows). На странице Claude Code жмём <span class="kbd">install</span> и копируем команду.</p>
    <ol class="note-steps">
      <li>Открыть терминал (в macOS / Windows он уже есть).</li>
      <li>Вставить команду установки со страницы Claude Code и нажать <span class="kbd">Enter</span>.</li>
      <li>Авторизоваться под своим аккаунтом (или нашим доступом).</li>
      <li>Готово — дальше работаем из VS Code.</li>
    </ol>

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
        В браузере вы работаете под VPN, и под «неправильным» VPN аккаунт <strong>реально могут забанить</strong>.
        Рабочий путь — один стабильный «выход» (через прокси/сервер). Наш портал это решает: один стабильный канал,
        находитесь в одном месте — меньше риск бана.
      </span>
    </div>

    <p class="note-end">Дальше: <em>урок 3</em> — в чём волшебство проектов и почему чат ≠ проект.</p>
  `;

  /* ── M1 · Урок 3 ─────────────────────────────────────────── */
  L['m1.l3'] = `
    <p class="note-lead muted" style="font-size:14px;line-height:1.6;color:hsl(var(--muted-foreground));margin-bottom:18px">
      Тема простая, но даёт самый «вау-эффект». Коротко: чат теряет контекст между сессиями,
      а <em>проект — это папка с памятью</em>: весь контекст хранится в ней и едет вместе с папкой
      между машинами и серверами. Сердце проекта — файл <em>CLAUDE.md</em>.
    </p>
    <div class="note-toc">
      <span class="note-toc-chip">проблема чатов</span>
      <span class="note-toc-chip">проект = папка с памятью</span>
      <span class="note-toc-chip">CLAUDE.md</span>
      <span class="note-toc-chip">структура</span>
      <span class="note-toc-chip">VS Code · 4 зоны</span>
      <span class="note-toc-chip">волшебство переноса</span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">1</span>Проблема: между чатами контекст не переносится</h2>
    <p>Чат — облачная штука: отправили запрос → получили ответ. Но <strong>новый чат не помнит</strong>, что было в старом.
       Между чатами контекст не перекидывается — раньше именно это вызывало отторжение.</p>
    <p>Полумера — «проекты» в браузере: выгружаешь контекст один раз, дальше короткими сообщениями. Это обходной путь.</p>

    <div class="note-fig">
      <svg viewBox="0 0 700 150" role="img" aria-label="Контекст не переносится между чатами">
        <text x="350" y="26" text-anchor="middle" font-size="11" class="t-red">контекст не переносится между чатами</text>
        <rect x="40" y="50" width="150" height="60" rx="2" class="box"/>
        <text x="115" y="86" text-anchor="middle" font-size="13">Чат 1</text>
        <rect x="275" y="50" width="150" height="60" rx="2" class="box"/>
        <text x="350" y="86" text-anchor="middle" font-size="13">Чат 2</text>
        <rect x="510" y="50" width="150" height="60" rx="2" class="box"/>
        <text x="585" y="86" text-anchor="middle" font-size="13">Чат 3</text>
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
    <p>Когда подключаешься новым VS Code, Claude считывает файлы проекта (не все подряд, а определённые — CLAUDE.md, <span class="kbd">.claude/</span>, skills) и <strong>сразу понимает контекст</strong>.</p>
    <div class="note-callout is-key">
      <span class="note-callout-ic">🪄</span>
      <span class="note-callout-body">
        <span class="note-callout-label">в этом всё волшебство</span>
        Проект самодостаточен: переносишь папку — и Claude «вспоминает» всё, что вы делали.
      </span>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">3</span>CLAUDE.md — мозг проекта</h2>
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
      <div class="note-fig-cap">Схема 2 · CLAUDE.md — точка входа, из которой Claude видит весь проект</div>
    </div>

    <div class="note-quote">
      <span class="note-quote-label">пример инструкции в CLAUDE.md</span>
      «Помогаешь ученику курса запустить новый проект. Ученик — не разработчик: объясняй просто, без технического жаргона.
      Если встречается незнакомый термин — поясни в скобках. Проверь наличие файла онбординга в корне; если его нет — напиши “привет” и предложи настроить проект, задавая вопросы по одному.»
    </div>

    <h2 class="note-h2"><span class="note-h2-no">4</span>Структура проекта</h2>
    <p>Шаблоны уже содержат правильную структуру и инструкции: <span class="kbd">_base</span> (базовый)
       и <span class="kbd">b24-single-php</span> (под Битрикс24). Ключ API хранится в <span class="kbd">.env</span> —
       вы даёте только ключ, и папка подключается к порталу.</p>

    <div class="note-fig">
      <svg viewBox="0 0 700 230" role="img" aria-label="Структура папки проекта">
        <text x="24" y="34" font-size="14">📁 my-project/</text>
        <line x1="44" y1="44" x2="44" y2="208" class="ln" style="stroke:hsl(var(--border))"/>

        <text x="56" y="66" font-size="13" class="t-pri">├─ CLAUDE.md</text>
        <text x="300" y="66" font-size="11" class="t-pri">← главный файл, читается первым</text>

        <text x="56" y="94" font-size="13">├─ .claude/</text>
        <text x="300" y="94" font-size="11" class="t-mut">доступы · skills</text>

        <text x="56" y="122" font-size="13">├─ docs/</text>
        <text x="300" y="122" font-size="11" class="t-mut">документация</text>

        <text x="56" y="150" font-size="13">├─ onboarding.md</text>
        <text x="300" y="150" font-size="11" class="t-mut">сценарий первого запуска</text>

        <text x="56" y="178" font-size="13" class="t-org">├─ .env</text>
        <text x="300" y="178" font-size="11" class="t-org">API-ключ — секрет, не коммитим</text>

        <text x="56" y="206" font-size="13">└─ .gitignore</text>
        <text x="300" y="206" font-size="11" class="t-mut">что не уходит в git</text>
      </svg>
      <div class="note-fig-cap">Схема 3 · типовая структура. CLAUDE.md задаёт контекст, .env держит ключ в секрете</div>
    </div>

    <h2 class="note-h2"><span class="note-h2-no">5</span>VS Code: 4 зоны рабочего места</h2>
    <p>Половину дня можно потратить, чтобы настроить VS Code «как надо». Зоны:</p>
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
      <div class="note-fig-cap">Схема 4 · файлы · редактор · терминал (Claude Code) · справа встроенный чат — его не трогаем</div>
    </div>
    <ul>
      <li>Расширение <strong>Claude Code</strong> ставится в VS Code — выбирайте именно его (у него ~15 млн установок, самое популярное).</li>
      <li><strong>Remote Explorer / SSH</strong> — чтобы подключаться к своему серверу (IP, логин, пароль или ключ), когда будете арендовать VPS.</li>
    </ul>

    <h2 class="note-h2"><span class="note-h2-no">6</span>Волшебство на практике</h2>
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

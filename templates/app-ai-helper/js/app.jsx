const { useState, useEffect, useMemo, useRef, useCallback } = React;

const LS_KEY = 'podskazchik.v2';

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { likes: {}, usage: {}, custom: [] };
    const s = JSON.parse(raw);
    return { likes: s.likes || {}, usage: s.usage || {}, custom: s.custom || [] };
  } catch { return { likes: {}, usage: {}, custom: [] }; }
}
function saveState(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); return s; }

function Icon({ name, className = 'w-4 h-4' }) {
  const paths = {
    search:   <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    copy:     <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    check:    <polyline points="20 6 9 17 4 12" />,
    mic:      <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /></>,
    micOff:   <><line x1="2" y1="2" x2="22" y2="22" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M19 10v2a7 7 0 0 1-.11 1.23M12 19v3" /></>,
    plus:     <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
    thumbUp:  <path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l5-8a2 2 0 0 1 2 2z" />,
    thumbDn:  <path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-5 8a2 2 0 0 1-2-2z" />,
    x:        <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
    sparkle:  <><path d="M12 3v3M12 18v3M5.64 5.64l2.12 2.12M16.24 16.24l2.12 2.12M3 12h3M18 12h3M5.64 18.36l2.12-2.12M16.24 7.76l2.12-2.12" /><circle cx="12" cy="12" r="3" /></>,
    monitor:  <><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></>,
    layers:   <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>,
    upload:   <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>,
    file:     <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    book:     <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>,
    trash:    <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
    play:     <polygon points="5 3 19 12 5 21 5 3" />,
    stop:     <rect x="6" y="6" width="12" height="12" rx="1" />,
    bolt:     <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
    lightbulb:<><path d="M9 18h6M10 22h4M15.09 14a5 5 0 1 0-6.18 0L10 16h4z" /></>,
    chat:     <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  };
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function Toast({ msg, type }) {
  const color = type === 'warn' ? 'bg-amber-600' : type === 'error' ? 'bg-rose-600' : 'bg-stone-900';
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 ${color} text-white px-4 py-2 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 z-50 animate-[fadeIn_.15s_ease-out]`}>
      <Icon name={type === 'error' ? 'x' : 'check'} className="w-4 h-4" />
      {msg}
    </div>
  );
}

function SectionCard({ icon, iconColor, title, subtitle, children, accent }) {
  return (
    <section className={`bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden ${accent || ''}`}>
      <div className="px-6 pt-5 pb-4 flex items-start gap-3 border-b border-stone-100">
        <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${iconColor}`}>
          <Icon name={icon} className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-stone-900 leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="px-6 py-5">
        {children}
      </div>
    </section>
  );
}

function SourcePicker({ value, onChange, listening }) {
  const opts = [
    { id: 'mic',    label: 'Микрофон',    icon: 'mic',     hint: 'речь менеджера' },
    { id: 'screen', label: 'Захват',      icon: 'monitor', hint: 'звук из приложения' },
    { id: 'both',   label: 'Оба',         icon: 'layers',  hint: 'мик + захват' },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-stone-500 mr-1">Источник:</span>
      {opts.map(opt => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            disabled={listening}
            onClick={() => onChange(opt.id)}
            title={opt.hint}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              active
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
            } ${listening ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Icon name={opt.icon} className="w-3.5 h-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function LiveTranscript({ text, listening }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [text]);
  if (!listening && !text) return null;
  return (
    <div className="bg-stone-900 rounded-xl text-white px-4 py-3 mt-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex w-2 h-2">
          {listening && <span className="absolute inline-flex w-full h-full rounded-full bg-rose-400 opacity-75 animate-ping" />}
          <span className={`relative inline-flex w-2 h-2 rounded-full ${listening ? 'bg-rose-500' : 'bg-stone-500'}`} />
        </span>
        <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">
          {listening ? 'Слушаю в реальном времени' : 'Транскрипт остановлен'}
        </span>
      </div>
      <div ref={ref} className="text-sm leading-relaxed max-h-32 overflow-y-auto font-medium">
        {text || <span className="text-stone-500 italic">Скажите что-нибудь…</span>}
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion, idx, onCopy, isFresh }) {
  const palette = ['from-amber-50 to-amber-100 border-amber-200', 'from-sky-50 to-sky-100 border-sky-200', 'from-emerald-50 to-emerald-100 border-emerald-200'];
  const badge   = ['text-amber-800 bg-amber-200/60', 'text-sky-800 bg-sky-200/60', 'text-emerald-800 bg-emerald-200/60'];
  return (
    <div className={`bg-gradient-to-br ${palette[idx % 3]} border rounded-xl p-4 ${isFresh ? 'animate-[fadeIn_.3s_ease-out]' : ''}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badge[idx % 3]}`}>
          {suggestion.tactic}
        </span>
        <button
          onClick={() => onCopy(suggestion.text)}
          className="text-stone-700 hover:text-stone-900 p-1 rounded hover:bg-white/60 transition-colors"
          title="Копировать"
        >
          <Icon name="copy" className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[15px] leading-relaxed text-stone-900 font-medium">{suggestion.text}</p>
    </div>
  );
}

function LiveSuggestionsPanel({ result, loading, listening, error, onCopy }) {
  if (!listening && !result && !error) return null;
  return (
    <div className="mt-4 bg-gradient-to-br from-stone-50 to-white rounded-xl border-2 border-dashed border-stone-300 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="lightbulb" className="w-4 h-4 text-amber-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-stone-700">AI рекомендует</span>
        {loading && <span className="text-[11px] text-stone-500 italic">думаю…</span>}
      </div>
      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 rounded-lg p-3 border border-rose-200">
          {error}
        </div>
      )}
      {!result && !loading && !error && (
        <div className="text-sm text-stone-500 italic">
          Когда наберётся фрагмент разговора, AI подскажет, что ответить клиенту.
        </div>
      )}
      {result && (
        <>
          <div className="mb-3 pb-3 border-b border-stone-200">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1">
              {result.type === 'objection' ? 'Возражение' : result.type === 'context' ? 'Контекст' : 'Ситуация'}
            </div>
            <div className="text-sm font-medium text-stone-800">{result.detected}</div>
          </div>
          <div className="space-y-2">
            {result.suggestions?.map((s, i) => (
              <SuggestionCard key={i} suggestion={s} idx={i} onCopy={onCopy} isFresh />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LiveAssistant({ aiAvailable, onShowToast }) {
  const [source, setSource] = useState('mic');
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const screenStreamRef = useRef(null);
  const lastSuggestAtRef = useRef(0);
  const lastSuggestedTextRef = useRef('');
  const abortRef = useRef(null);

  const supported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  function copy(text) {
    navigator.clipboard.writeText(text);
    onShowToast('Скопировано');
  }

  async function fetchSuggestion(text) {
    if (!aiAvailable) {
      setAiError('AI-провайдер не настроен. Добавьте GIGACHAT_AUTH_KEY / OPENROUTER_API_KEY в .env.');
      return;
    }
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('api/suggest', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'request failed');
      if (abortRef.current === controller) setAiResult(data);
    } catch (e) {
      if (e.name !== 'AbortError') setAiError(e.message);
    } finally {
      if (abortRef.current === controller) {
        setAiLoading(false);
        abortRef.current = null;
      }
    }
  }

  function maybeFetchSuggestion(currentText) {
    const now = Date.now();
    const minGap = 2000;
    const minNewChars = 20;
    const minTotal = 15;
    if (currentText.length < minTotal) return;
    const newPart = currentText.length - lastSuggestedTextRef.current.length;
    const elapsed = now - lastSuggestAtRef.current;
    const firstTime = lastSuggestAtRef.current === 0;
    if (!firstTime && elapsed < minGap) return;
    if (!firstTime && newPart < minNewChars) return;
    lastSuggestAtRef.current = now;
    lastSuggestedTextRef.current = currentText;
    fetchSuggestion(currentText.slice(-1500));
  }

  async function start() {
    setError(null);
    setTranscript('');
    setAiResult(null);
    setAiError(null);
    lastSuggestedTextRef.current = '';
    lastSuggestAtRef.current = 0;

    if (source === 'screen' || source === 'both') {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
          stream.getTracks().forEach(t => t.stop());
          setError('Не получили аудио из захвата экрана. В Chrome выберите "Поделиться вкладкой" и поставьте галочку "Поделиться аудио вкладки".');
          return;
        }
        screenStreamRef.current = stream;
        stream.getVideoTracks().forEach(t => t.stop());
        if (source === 'screen') {
          setError('Захват аудио активен, но без подключения Whisper/Gemini API распознавание речи из захвата пока недоступно. Используйте "Микрофон", или подключите бекенд STT (это v3).');
          stream.getTracks().forEach(t => t.stop());
          return;
        }
      } catch (e) {
        setError('Не удалось получить доступ к захвату экрана: ' + e.message);
        return;
      }
    }

    if (source === 'mic' || source === 'both') {
      if (!supported) {
        setError('Распознавание речи доступно только в Chrome / Edge.');
        return;
      }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.lang = 'ru-RU';
      rec.continuous = true;
      rec.interimResults = true;
      let manualStop = false;
      let accumulated = '';
      rec.onresult = (evt) => {
        let interim = '';
        for (let i = evt.resultIndex; i < evt.results.length; i++) {
          const t = evt.results[i][0].transcript;
          if (evt.results[i].isFinal) accumulated += t + ' ';
          else interim += t;
        }
        const display = accumulated + interim;
        setTranscript(display);
        maybeFetchSuggestion(display);
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed') {
          setError('Доступ к микрофону не дан');
          manualStop = true;
          setListening(false);
        }
      };
      rec.onend = () => {
        if (!manualStop && recognitionRef.current === rec) {
          try { rec.start(); } catch {}
        }
      };
      try {
        rec.start();
        recognitionRef.current = rec;
        setListening(true);
      } catch (e) {
        setError('Не удалось запустить распознавание: ' + e.message);
      }
    }
  }

  function stop() {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    setListening(false);
  }

  useEffect(() => () => stop(), []);

  return (
    <SectionCard
      icon="bolt"
      iconColor="bg-stone-900 text-white"
      title="Живой ассистент"
      subtitle="AI слушает разговор и подсказывает, что ответить"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <SourcePicker value={source} onChange={setSource} listening={listening} />
        {!listening ? (
          <button
            onClick={start}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-stone-900 text-white font-medium hover:bg-stone-800 transition-colors shadow-sm"
          >
            <Icon name="play" className="w-4 h-4" />
            Начать
          </button>
        ) : (
          <button
            onClick={stop}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white font-medium hover:bg-rose-500 transition-colors shadow-sm"
          >
            <Icon name="stop" className="w-4 h-4" />
            Остановить
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 flex items-start gap-2">
          <Icon name="lightbulb" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!listening && !transcript && !error && (
        <div className="mt-5 text-center py-8 text-stone-400">
          <div className="inline-flex w-12 h-12 rounded-full bg-stone-100 items-center justify-center mb-3">
            <Icon name="mic" className="w-5 h-5 text-stone-500" />
          </div>
          <p className="text-sm text-stone-600 max-w-md mx-auto">
            Выберите источник звука, нажмите <strong>«Начать»</strong>, и AI начнёт распознавать речь и подсказывать ответы на возражения по контексту.
          </p>
          {!aiAvailable && (
            <p className="text-xs text-stone-400 mt-3">
              Подсказки от Claude работают, если в `.env` задан <code className="bg-stone-100 px-1.5 py-0.5 rounded font-mono">ANTHROPIC_API_KEY</code>.
            </p>
          )}
        </div>
      )}

      <LiveTranscript text={transcript} listening={listening} />
      <LiveSuggestionsPanel
        result={aiResult}
        loading={aiLoading}
        listening={listening}
        error={aiError}
        onCopy={copy}
      />
    </SectionCard>
  );
}

function AnalyzeSection({ aiAvailable, onShowToast }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleAnalyze() {
    if (text.trim().length < 50) {
      setError('Минимум 50 символов транскрипта');
      return;
    }
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch('api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'request failed');
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = e => setText(String(e.target.result || ''));
    reader.readAsText(file, 'utf-8');
  }

  return (
    <SectionCard
      icon="sparkle"
      iconColor="bg-violet-100 text-violet-700"
      title="AI-анализ транскрипта звонка"
      subtitle="Вставь транскрипт или загрузи файл — AI разберёт возражения и предложит лучшие отработки"
    >
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={5}
        placeholder="Менеджер: Добрый день, хотел предложить...&#10;Клиент: Спасибо, но это слишком дорого для нас.&#10;Менеджер: Понимаю..."
        className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 placeholder:text-stone-400 resize-none transition-colors"
      />
      <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-stone-200 hover:bg-stone-50 cursor-pointer text-sm font-medium text-stone-700 transition-colors">
          <Icon name="upload" className="w-4 h-4" />
          Загрузить .txt
          <input
            type="file"
            accept=".txt,.md,text/plain"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
              e.target.value = '';
            }}
          />
        </label>
        <button
          onClick={handleAnalyze}
          disabled={loading || text.trim().length < 50}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          <Icon name="sparkle" className="w-4 h-4" />
          {loading ? 'Анализирую…' : 'Проанализировать'}
        </button>
      </div>
      {error && (
        <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800">{error}</div>
      )}
      {result && <AnalyzeResult result={result} onCopy={t => { navigator.clipboard.writeText(t); onShowToast('Скопировано'); }} />}
    </SectionCard>
  );
}

function AnalyzeResult({ result, onCopy }) {
  const handledColor = {
    well:    'bg-emerald-100 text-emerald-800',
    average: 'bg-amber-100 text-amber-800',
    poor:    'bg-rose-100 text-rose-800',
    missed:  'bg-stone-200 text-stone-700',
  };
  const handledLabel = { well: 'отработано хорошо', average: 'средне', poor: 'плохо', missed: 'не отработано' };
  const scoreColor = result.score >= 8 ? 'bg-emerald-500' : result.score >= 5 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="mt-5 space-y-4 animate-[fadeIn_.3s_ease-out]">
      <div className="flex items-start gap-4 p-4 bg-gradient-to-br from-violet-50 to-violet-100/50 rounded-xl border border-violet-200">
        <div className={`flex-shrink-0 w-14 h-14 rounded-xl ${scoreColor} text-white flex items-center justify-center text-2xl font-bold shadow-sm`}>
          {result.score}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-violet-700 font-semibold mb-1">Резюме звонка</div>
          <p className="text-sm text-stone-800 leading-relaxed">{result.summary}</p>
        </div>
      </div>

      {result.objections?.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">
            Найдено возражений: {result.objections.length}
          </div>
          <div className="space-y-3">
            {result.objections.map((obj, i) => (
              <div key={i} className="bg-white rounded-xl border border-stone-200 p-4">
                <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded bg-stone-100 text-stone-700">
                    {obj.category}
                  </span>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded ${handledColor[obj.managerHandled] || handledColor.missed}`}>
                    {handledLabel[obj.managerHandled] || obj.managerHandled}
                  </span>
                </div>
                <blockquote className="text-sm italic text-stone-600 border-l-2 border-stone-300 pl-3 mb-2">
                  «{obj.quote}»
                </blockquote>
                {obj.managerResponse && (
                  <div className="text-xs text-stone-500 mb-3">
                    <span className="font-medium">Менеджер ответил:</span> {obj.managerResponse}
                  </div>
                )}
                <div className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold mb-2">Что было бы лучше сказать</div>
                <div className="space-y-2">
                  {obj.betterTakes?.map((take, j) => (
                    <div key={j} className="flex items-start gap-2 p-3 bg-stone-50 rounded-lg group">
                      <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-stone-500 bg-white px-2 py-1 rounded">
                        {take.tactic}
                      </span>
                      <p className="flex-1 text-sm text-stone-800 leading-relaxed">{take.text}</p>
                      <button
                        onClick={() => onCopy(take.text)}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-stone-500 hover:text-stone-900 p-1 rounded transition-all"
                      >
                        <Icon name="copy" className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.recommendations?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="lightbulb" className="w-4 h-4 text-amber-700" />
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-800">Рекомендации</div>
          </div>
          <ul className="space-y-1.5">
            {result.recommendations.map((rec, i) => (
              <li key={i} className="text-sm text-stone-800 flex items-start gap-2">
                <span className="text-amber-600 font-bold flex-shrink-0">→</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function KnowledgeBase({ onShowToast }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function refresh() {
    try {
      const res = await fetch('api/kb/list');
      const data = await res.json();
      setFiles(data.files || []);
    } catch {}
  }
  useEffect(() => { refresh(); }, []);

  async function handleFiles(fileList) {
    if (!fileList || !fileList.length) return;
    setUploading(true);
    for (const f of fileList) {
      try {
        const buf = await f.arrayBuffer();
        let bin = '';
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
        const b64 = btoa(bin);
        const res = await fetch('api/kb/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: f.name, mimeType: f.type, contentBase64: b64 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'upload failed');
      } catch (e) {
        onShowToast('Ошибка: ' + e.message, 'error');
      }
    }
    setUploading(false);
    refresh();
    onShowToast('Файлы загружены');
  }

  async function remove(id) {
    await fetch(`api/kb/${id}`, { method: 'DELETE' });
    refresh();
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  return (
    <SectionCard
      icon="book"
      iconColor="bg-emerald-100 text-emerald-700"
      title="База знаний компании"
      subtitle="Загрузи файлы с информацией о продуктах, ценах, кейсах — AI будет опираться на них в подсказках"
    >
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          handleFiles(Array.from(e.dataTransfer.files));
        }}
        className={`border-2 border-dashed rounded-xl px-6 py-8 text-center transition-colors ${
          dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-stone-300 bg-stone-50'
        }`}
      >
        <Icon name="upload" className="w-8 h-8 mx-auto text-stone-400 mb-2" />
        <p className="text-sm text-stone-700 font-medium mb-1">
          Перетащи файлы сюда или
          <label className="text-emerald-700 hover:text-emerald-600 cursor-pointer ml-1 underline underline-offset-2">
            выбери файлы
            <input
              type="file"
              multiple
              accept=".txt,.md,.csv,.json,.pdf,.docx"
              className="hidden"
              onChange={e => { handleFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
            />
          </label>
        </p>
        <p className="text-xs text-stone-500">
          {uploading ? 'Загружаю…' : '.txt, .md, .csv, .json — лучше всего. PDF/DOCX сохранятся, но для извлечения текста нужна v3.'}
        </p>
      </div>

      {files.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">
            Загружено: {files.length}
          </div>
          <div className="space-y-1.5">
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-3 py-2 bg-stone-50 rounded-lg group hover:bg-stone-100 transition-colors">
                <Icon name="file" className="w-4 h-4 text-stone-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-800 truncate">{f.filename}</div>
                  <div className="text-[11px] text-stone-500">
                    {fmtSize(f.size)} · {f.extractable ? 'текст распознан' : 'бинарный файл'}
                  </div>
                </div>
                <button
                  onClick={() => remove(f.id)}
                  className="opacity-0 group-hover:opacity-100 text-stone-500 hover:text-rose-600 p-1.5 rounded-md hover:bg-white transition-all"
                  title="Удалить"
                >
                  <Icon name="trash" className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function ObjectionsLibrary({ state, setState, onShowToast }) {
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('all');
  const [collapsed, setCollapsed] = useState(true);
  const allObjections = useMemo(() => [...window.OBJECTIONS, ...(state.custom || [])], [state.custom]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allObjections.filter(o => {
      if (activeCat !== 'all' && o.category !== activeCat) return false;
      if (!q) return true;
      const haystack = [o.title, o.category, ...o.takes.map(t => t.text), ...o.takes.map(t => t.type)].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [allObjections, search, activeCat]);

  function copy(text, takeId) {
    navigator.clipboard.writeText(text);
    onShowToast('Скопировано');
    setState(s => {
      const usage = { ...(s.usage || {}) };
      usage[takeId] = (usage[takeId] || 0) + 1;
      return saveState({ ...s, usage });
    });
  }
  function toggleLike(takeId, dir) {
    setState(s => {
      const likes = { ...(s.likes || {}) };
      likes[takeId] = likes[takeId] === dir ? 0 : dir;
      return saveState({ ...s, likes });
    });
  }

  return (
    <SectionCard
      icon="chat"
      iconColor="bg-sky-100 text-sky-700"
      title="База готовых отработок"
      subtitle={`${allObjections.length} возражений · ${allObjections.reduce((n, o) => n + o.takes.length, 0)} тейков`}
    >
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setCollapsed(false); }}
            placeholder="Поиск по возражению или ключевому слову…"
            className="w-full pl-9 pr-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-400"
          />
        </div>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-xs text-stone-600 hover:text-stone-900 px-3 py-2 rounded-lg hover:bg-stone-50 font-medium"
        >
          {collapsed ? 'Раскрыть всё' : 'Свернуть'}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {window.CATEGORIES.map(cat => {
          const active = activeCat === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                active ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {!collapsed && (
        <div className="space-y-3 animate-[fadeIn_.2s_ease-out]">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-stone-500">Ничего не нашлось</div>
          ) : filtered.map(obj => {
            const style = window.CATEGORY_STYLES[obj.category] || window.CATEGORY_STYLES['Процесс'];
            const sortedTakes = [...obj.takes].sort((a, b) => {
              const sa = (state.likes[a.id] || 0) * 10 + (state.usage[a.id] || 0);
              const sb = (state.likes[b.id] || 0) * 10 + (state.usage[b.id] || 0);
              return sb - sa;
            });
            return (
              <div key={obj.id} className="bg-white rounded-xl border border-stone-200 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                    <h3 className="text-base font-semibold text-stone-900">«{obj.title}»</h3>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-1 rounded ${style.chip}`}>{obj.category}</span>
                </div>
                <div className="space-y-1">
                  {sortedTakes.map(take => {
                    const like = state.likes[take.id] || 0;
                    const usage = state.usage[take.id] || 0;
                    return (
                      <div key={take.id} className="group flex items-start gap-3 p-2 rounded-lg hover:bg-stone-50">
                        <span className="flex-shrink-0 mt-0.5 text-[10px] font-bold uppercase tracking-wider text-stone-500 bg-stone-100 px-2 py-0.5 rounded">
                          {take.type}
                        </span>
                        <p className="flex-1 text-sm text-stone-800 leading-relaxed">{take.text}</p>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button onClick={() => copy(take.text, take.id)} className="p-1.5 rounded hover:bg-stone-200 text-stone-600" title="Копировать"><Icon name="copy" className="w-3.5 h-3.5" /></button>
                          <button onClick={() => toggleLike(take.id, 1)} className={`p-1.5 rounded hover:bg-stone-200 ${like === 1 ? 'text-emerald-700' : 'text-stone-400'}`} title="Работает"><Icon name="thumbUp" className="w-3.5 h-3.5" /></button>
                          <button onClick={() => toggleLike(take.id, -1)} className={`p-1.5 rounded hover:bg-stone-200 ${like === -1 ? 'text-rose-700' : 'text-stone-400'}`} title="Не работает"><Icon name="thumbDn" className="w-3.5 h-3.5" /></button>
                          {usage > 0 && <span className="text-[10px] text-stone-400 ml-1">×{usage}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function App() {
  const [state, setState] = useState(() => loadState());
  const [toast, setToast] = useState(null);

  const aiAvailable = !!window.__AI_AVAILABLE__;
  const aiProvider = window.__AI_PROVIDER__;

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 1800);
  }, []);

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-40 bg-stone-50/85 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-stone-900 to-stone-700 rounded-xl flex items-center justify-center shadow-sm">
              <Icon name="bolt" className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-base font-semibold text-stone-900 leading-tight">Подсказчик</div>
              <div className="text-[11px] text-stone-500 leading-tight">AI-ассистент менеджера по продажам</div>
            </div>
          </div>
          <div className="text-[11px] font-mono hidden sm:flex items-center gap-1.5">
            {aiAvailable ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-stone-600">AI · {aiProvider?.name || 'on'}</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-stone-300" />
                <span className="text-stone-400">AI off</span>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6 space-y-5">
        <LiveAssistant aiAvailable={aiAvailable} onShowToast={showToast} />
        <AnalyzeSection aiAvailable={aiAvailable} onShowToast={showToast} />
        <KnowledgeBase onShowToast={showToast} />
        <ObjectionsLibrary state={state} setState={setState} onShowToast={showToast} />

        <div className="pt-6 pb-12 text-center text-xs text-stone-400">
          v2 · Подсказчик KISELEV GROUP · {new Date().getFullYear()}
        </div>
      </main>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

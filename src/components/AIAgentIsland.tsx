import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useStore } from '../store';
import { uid } from '../lib/utils';
import type { CanvasNode, Id } from '../types';

interface AIActionResponse {
  action: 'create_note' | 'create_sticker' | 'create_task' | 'create_canvas_card' | 'answer';
  title?: string;
  content?: string;
  color?: string;
  priority?: 'low' | 'med' | 'high';
  message: string;
}

export function AIAgentIsland() {
  const { ws, createNote, createTask, mutateCanvas, openTab, toast } = useStore();

  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [responseMessage, setResponseMessage] = useState<string | null>(null);
  const [lastActionResult, setLastActionResult] = useState<{
    type: 'note' | 'canvas' | 'task';
    id: Id;
    title: string;
  } | null>(null);

  // API Key management
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('org.ai.apiKey') || '';
  });
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey);

  const inputRef = useRef<HTMLInputElement>(null);
  const islandRef = useRef<HTMLDivElement>(null);

  const saveKey = (key: string) => {
    const trimmed = key.trim();
    setApiKey(trimmed);
    if (trimmed) {
      localStorage.setItem('org.ai.apiKey', trimmed);
      toast('API-ключ успешно сохранён');
    } else {
      localStorage.removeItem('org.ai.apiKey');
      toast('API-ключ удалён');
    }
    setShowKeyModal(false);
  };

  // Keyboard shortcut Ctrl+J to toggle and focus island
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCmd = e.ctrlKey || e.metaKey;
      if (isCmd && (e.code === 'KeyJ' || e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'о')) {
        e.preventDefault();
        setOpen(true);
        window.setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && open) {
        if (showKeyModal) {
          setShowKeyModal(false);
        } else {
          setOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, showKeyModal]);

  // Click outside to collapse
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (islandRef.current && !islandRef.current.contains(e.target as Node)) {
        if (!loading) {
          setShowKeyModal(false);
          // Only collapse if prompt is empty
          if (!prompt.trim() && !responseMessage) {
            setOpen(false);
          }
        }
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [loading, prompt, responseMessage]);

  // Workspace context builder
  const buildContext = () => {
    const notesSummary = ws.notes
      .slice(0, 15)
      .map((n) => `• Заметка «${n.title}» (теги: ${n.tags.join(', ') || 'нет'}): ${n.body.slice(0, 90)}…`)
      .join('\n');

    const activeCanvas = ws.canvases[0];
    const canvasSummary = activeCanvas
      ? `• Канвас «${activeCanvas.name}»: ${activeCanvas.nodes.length} узлов (${activeCanvas.nodes.map((n) => n.title).slice(0, 8).join(', ')})`
      : 'Нет канваса';

    const tasksSummary = ws.tasks
      .slice(0, 8)
      .map((t) => `• Задача: [${t.status}] ${t.title}`)
      .join('\n');

    return `ТЕКУЩЕЕ СОСТОЯНИЕ РАБОЧЕГО ПРОСТРАНСТВА:
Заметки:
${notesSummary || 'Заметок пока нет'}

Канвас:
${canvasSummary}

Задачи:
${tasksSummary || 'Задач пока нет'}`;
  };

  // Execute AI action on the workspace
  const executeAction = (actionData: AIActionResponse) => {
    const title = actionData.title || 'Новый элемент от ИИ';
    const content = actionData.content || '';

    switch (actionData.action) {
      case 'create_note': {
        const newNote = createNote({
          title,
          body: content,
          folder: 'ИИ Заметки',
        });
        setLastActionResult({ type: 'note', id: newNote.id, title: newNote.title });
        toast(`ИИ создал заметку «${newNote.title}»`);
        break;
      }
      case 'create_sticker': {
        const targetCanvas = ws.canvases[0];
        if (targetCanvas) {
          const stickerNode: CanvasNode = {
            id: uid('cn'),
            rev: Date.now(),
            x: Math.round(-targetCanvas.viewport.x / targetCanvas.viewport.zoom + 180),
            y: Math.round(-targetCanvas.viewport.y / targetCanvas.viewport.zoom + 140),
            w: 220,
            h: 220,
            title: title || 'Стикер',
            icon: '📌',
            tone: 'amber',
            kind: 'sticker',
            color: actionData.color || '#fef08a',
            text: content || title,
            bullets: [],
            items: [],
            links: [],
          };
          mutateCanvas(targetCanvas.id, (c) => ({
            ...c,
            nodes: [...c.nodes, stickerNode],
          }));
          setLastActionResult({ type: 'canvas', id: targetCanvas.id, title: `Стикер «${title}»` });
          toast('ИИ добавил стикер на холст');
        }
        break;
      }
      case 'create_canvas_card': {
        const targetCanvas = ws.canvases[0];
        if (targetCanvas) {
          const cardNode: CanvasNode = {
            id: uid('cn'),
            rev: Date.now(),
            x: Math.round(-targetCanvas.viewport.x / targetCanvas.viewport.zoom + 200),
            y: Math.round(-targetCanvas.viewport.y / targetCanvas.viewport.zoom + 160),
            w: 240,
            h: 120,
            title,
            icon: '💡',
            tone: 'violet',
            kind: 'note',
            bullets: content ? content.split('\n').filter(Boolean) : ['Сгенерировано ИИ'],
            items: [],
            links: [],
          };
          mutateCanvas(targetCanvas.id, (c) => ({
            ...c,
            nodes: [...c.nodes, cardNode],
          }));
          setLastActionResult({ type: 'canvas', id: targetCanvas.id, title: `Узел «${title}»` });
          toast('ИИ создал карточку на холсте');
        }
        break;
      }
      case 'create_task': {
        const newTask = createTask({
          title,
          priority: actionData.priority || 'med',
        });
        setLastActionResult({ type: 'task', id: newTask.id, title: newTask.title });
        toast(`ИИ добавил задачу «${newTask.title}»`);
        break;
      }
      default:
        // Regular answer, no workspace modification
        break;
    }
  };

  // Local fallback parser when no API key is provided
  const handleLocalFallback = (text: string) => {
    const lower = text.toLowerCase().trim();

    if (lower.startsWith('создай заметку') || lower.startsWith('заметка')) {
      const title = text.replace(/^(создай заметку|заметка)\s*:?\s*/i, '').trim() || 'Новая мысль';
      const newNote = createNote({
        title,
        body: `# ${title}\n\nСоздано по запросу: «${text}»`,
      });
      setLastActionResult({ type: 'note', id: newNote.id, title: newNote.title });
      setResponseMessage(`Создал для вас заметку «${newNote.title}». Нажмите кнопку ниже, чтобы открыть её.`);
      return true;
    }

    if (lower.startsWith('создай стикер') || lower.startsWith('стикер') || lower.includes('на холст')) {
      const content = text.replace(/^(создай стикер|стикер|добавь стикер)\s*:?\s*/i, '').trim() || 'Важное напоминание';
      const targetCanvas = ws.canvases[0];
      if (targetCanvas) {
        const stickerNode: CanvasNode = {
          id: uid('cn'),
          rev: Date.now(),
          x: 240,
          y: 200,
          w: 220,
          h: 220,
          title: 'Стикер',
          icon: '📌',
          tone: 'amber',
          kind: 'sticker',
          color: '#fef08a',
          text: content,
          bullets: [],
          items: [],
          links: [],
        };
        mutateCanvas(targetCanvas.id, (c) => ({ ...c, nodes: [...c.nodes, stickerNode] }));
        setLastActionResult({ type: 'canvas', id: targetCanvas.id, title: 'Стикер на холсте' });
        setResponseMessage(`Добавил стикер с текстом «${content}» на ваш канвас!`);
        return true;
      }
    }

    if (lower.startsWith('создай задачу') || lower.startsWith('задача')) {
      const taskTitle = text.replace(/^(создай задачу|задача)\s*:?\s*/i, '').trim() || 'Новая задача';
      const task = createTask({ title: taskTitle });
      setLastActionResult({ type: 'task', id: task.id, title: task.title });
      setResponseMessage(`Добавил задачу «${task.title}» в список задач.`);
      return true;
    }

    return false;
  };

  // Submit request to AI model
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = prompt.trim();
    if (!query || loading) return;

    setLoading(true);
    setResponseMessage(null);
    setLastActionResult(null);

    // If no API key is set, check if it can be fulfilled locally
    if (!apiKey) {
      const handled = handleLocalFallback(query);
      if (handled) {
        setLoading(false);
        return;
      }
      setLoading(false);
      setShowKeyModal(true);
      setResponseMessage(
        '🔑 Для ответов на любые вопросы и генерации текста подключите API-ключ Google Gemini или OpenAI. Введите его в окне выше (ключ сохраняется только в вашем браузере).',
      );
      return;
    }

    const context = buildContext();
    const systemPrompt = `Ты — встроенный интеллектуальный ИИ-агент приложения Org (заметки, интерактивный канвас, граф связей, задачи).
Твоя задача — помогать пользователю, отвечать на вопросы о его рабочем пространстве или ВЫПОЛНЯТЬ КОМАНДЫ (создавать заметки, стикеры на холсте, задачи).
Всегда отвечай вежливо, ёмко и на русском языке.

КОНТЕКСТ РАБОЧЕГО ПРОСТРАНСТВА:
${context}

ИНСТРУКЦИЯ ПО ВЫХОДНОМУ ФОРМАТУ:
Ты ВСЕГДА должен вернуть валидный JSON-объект в следующем формате:
{
  "action": "create_note" | "create_sticker" | "create_canvas_card" | "create_task" | "answer",
  "title": "Краткий емкий заголовок (для заметки/стикера/задачи)",
  "content": "Полный структурированный текст в markdown (для заметок пиши подробный красивый текст, для стикеров краткий)",
  "color": "#fef08a" (только для стикера: #fef08a, #fed7aa, #bbf7d0, #bae6fd, #e9d5ff, #fbcfe8),
  "priority": "high" | "med" | "low" (только для задач),
  "message": "Понятное и приятное сообщение для пользователя о том, что сделано, или ответ на вопрос"
}

Никаких посторонних символов до или после JSON. Только JSON.`;

    try {
      let rawText = '';

      // Google Gemini API
      if (!apiKey.startsWith('sk-')) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: `${systemPrompt}\n\nЗАПРОС ПОЛЬЗОВАТЕЛЯ:\n${query}` }],
                },
              ],
              generationConfig: {
                temperature: 0.4,
              },
            }),
          },
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData?.error?.message || `Ошибка API Gemini (${response.status})`);
        }

        const data = await response.json();
        rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        // OpenAI compatible API
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: query },
            ],
            temperature: 0.4,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData?.error?.message || `Ошибка OpenAI (${response.status})`);
        }

        const data = await response.json();
        rawText = data?.choices?.[0]?.message?.content || '';
      }

      // Parse JSON from model response
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      let parsed: AIActionResponse;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        // If not strictly JSON, treat entire response as an answer
        parsed = {
          action: 'answer',
          message: rawText,
        };
      }

      executeAction(parsed);
      setResponseMessage(parsed.message || 'Готово!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Не удалось связаться с ИИ';
      setResponseMessage(`⚠️ Ошибка: ${msg}. Проверьте правильность API ключа.`);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickPrompt = (text: string) => {
    setPrompt(text);
    setOpen(true);
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 40);
  };

  return (
    <div className={`ai-island-container${open ? ' expanded' : ''}`} ref={islandRef}>
      {/* Main Island Bar */}
      <form className="ai-island-bar" onSubmit={handleSubmit}>
        <div className={`ai-island-icon${loading ? ' pulse' : ''}`} title="ИИ Агент Org">
          <span className="sparkle">✨</span>
        </div>

        <input
          ref={inputRef}
          type="text"
          className="ai-island-input"
          placeholder="Спроси ИИ или дай команду («создай заметку», «стикер на холст», «задачу»)…"
          value={prompt}
          onFocus={() => setOpen(true)}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <div className="ai-island-actions">
          {loading ? (
            <div className="ai-spinner" title="Генерация ответа…" />
          ) : (
            <button
              type="submit"
              className="ai-submit-btn"
              title="Отправить запрос (Enter)"
              disabled={!prompt.trim()}
            >
              <Icon name="chevron-right" size={14} />
            </button>
          )}

          <button
            type="button"
            className={`ai-key-btn${apiKey ? ' active' : ''}`}
            title={apiKey ? 'API-ключ подключён (нажми для смены)' : 'Подключить API-ключ Gemini / OpenAI'}
            onClick={() => {
              setKeyInput(apiKey);
              setShowKeyModal((v) => !v);
            }}
          >
            <span>🔑</span>
          </button>
        </div>
      </form>

      {/* API Key Modal / Popover */}
      {showKeyModal && (
        <div className="ai-key-popover">
          <div className="ai-key-head">
            <span className="title">🔑 Настройка API-ключа</span>
            <button
              type="button"
              className="close-btn"
              onClick={() => setShowKeyModal(false)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
          <p className="ai-key-desc">
            Вставьте ваш API-ключ <strong>Google Gemini</strong> или <strong>OpenAI</strong>.
            Ключ хранится исключительно локально в вашем браузере.
          </p>
          <div className="ai-key-input-row">
            <input
              type="password"
              placeholder="AIzaSy... или sk-..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="btn primary"
              onClick={() => saveKey(keyInput)}
            >
              Сохранить
            </button>
          </div>
          <div className="ai-key-help">
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
            >
              Получить бесплатный ключ в Google AI Studio ↗
            </a>
          </div>
        </div>
      )}

      {/* Expanded Dropdown with AI response and quick prompts */}
      {open && (
        <div className="ai-island-dropdown">
          {/* Response Message */}
          {responseMessage && (
            <div className="ai-response-card">
              <div className="ai-response-head">
                <span className="sparkle">✨</span>
                <span className="title">Ответ ИИ:</span>
              </div>
              <div className="ai-response-text">{responseMessage}</div>

              {lastActionResult && (
                <div className="ai-action-badge">
                  <span>Готово: <strong>{lastActionResult.title}</strong></span>
                  {lastActionResult.type === 'note' && (
                    <button
                      className="btn"
                      onClick={() => openTab('note', lastActionResult.id)}
                    >
                      Открыть заметку →
                    </button>
                  )}
                  {lastActionResult.type === 'canvas' && (
                    <button
                      className="btn"
                      onClick={() => openTab('canvas', lastActionResult.id)}
                    >
                      К канвасу →
                    </button>
                  )}
                  {lastActionResult.type === 'task' && (
                    <button
                      className="btn"
                      onClick={() => openTab('tasks')}
                    >
                      К задачам →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Quick Prompts Chips */}
          <div className="ai-quick-chips">
            <span className="chips-label">Быстрые команды:</span>
            <button
              type="button"
              className="chip-btn"
              onClick={() => handleQuickPrompt('Создай заметку со структурированным планом на неделю')}
            >
              📝 План на неделю
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => handleQuickPrompt('Создай жёлтый стикер на холсте: Главный приоритет сегодня')}
            >
              📌 Стикер на холст
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => handleQuickPrompt('Добавь задачу: Запустить проект')}
            >
              ✅ Новая задача
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => handleQuickPrompt('Проанализируй мои заметки и расскажи о чём они')}
            >
              🔍 О чём мои заметки?
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

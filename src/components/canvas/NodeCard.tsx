import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Icon, OrgMark } from '../Icon';
import type { CanvasNode } from '../../types';

export type HandleSide = 'l' | 'r' | 't' | 'b';

interface Props {
  node: CanvasNode;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
  showHandles: boolean;
  onPointerDown: (event: ReactPointerEvent, node: CanvasNode) => void;
  onStartEdit: (node: CanvasNode) => void;
  onPatch: (id: string, patch: Partial<CanvasNode>) => void;
  onToggleItem: (nodeId: string, itemId: string) => void;
  onRemoveItem: (nodeId: string, itemId: string) => void;
  onAddItem: (nodeId: string) => void;
  onHandleDown: (event: ReactPointerEvent, node: CanvasNode, side: HandleSide) => void;
  onResizeDown: (event: ReactPointerEvent, node: CanvasNode) => void;
  onOpenNote: (noteId: string) => void;
  onDrawOnImage?: (node: CanvasNode) => void;
}

const HANDLES: { side: HandleSide; style: CSSProperties }[] = [
  { side: 't', style: { left: '50%', top: -6, transform: 'translateX(-50%)' } },
  { side: 'b', style: { left: '50%', bottom: -6, transform: 'translateX(-50%)' } },
  { side: 'l', style: { left: -6, top: '50%', transform: 'translateY(-50%)' } },
  { side: 'r', style: { right: -6, top: '50%', transform: 'translateY(-50%)' } },
];

const STICKER_COLORS = [
  '#fef08a', // Yellow
  '#fed7aa', // Peach / Orange
  '#fbcfe8', // Pink
  '#bbf7d0', // Green
  '#bfdbfe', // Sky Blue
  '#e9d5ff', // Purple
  '#ffffff', // White
  '#27272a', // Dark Slate
];

export const NodeCard = memo(function NodeCard({
  node,
  selected,
  editing,
  dragging,
  showHandles,
  onPointerDown,
  onStartEdit,
  onPatch,
  onToggleItem,
  onRemoveItem,
  onAddItem,
  onHandleDown,
  onResizeDown,
  onOpenNote,
  onDrawOnImage,
}: Props) {
  const isCenter = node.kind === 'text';

  // Локальный буфер для текста и заголовка для плавного набора без задержек сети
  const [localTitle, setLocalTitle] = useState(node.title);
  const [localText, setLocalText] = useState(node.text ?? '');
  const isTypingTitle = useRef(false);
  const isTypingText = useRef(false);
  const titleDebounce = useRef<number | null>(null);
  const textDebounce = useRef<number | null>(null);

  useEffect(() => {
    if (!isTypingTitle.current) {
      setLocalTitle(node.title);
    }
  }, [node.title]);

  useEffect(() => {
    if (!isTypingText.current) {
      setLocalText(node.text ?? '');
    }
  }, [node.text]);

  const handleTitleChange = (val: string) => {
    setLocalTitle(val);
    isTypingTitle.current = true;
    if (titleDebounce.current !== null) window.clearTimeout(titleDebounce.current);
    titleDebounce.current = window.setTimeout(() => {
      onPatch(node.id, { title: val });
      isTypingTitle.current = false;
    }, 50);
  };

  const handleTitleBlur = () => {
    if (titleDebounce.current !== null) {
      window.clearTimeout(titleDebounce.current);
      titleDebounce.current = null;
    }
    onPatch(node.id, { title: localTitle });
    isTypingTitle.current = false;
  };

  const handleTextChange = (val: string) => {
    setLocalText(val);
    isTypingText.current = true;
    if (textDebounce.current !== null) window.clearTimeout(textDebounce.current);
    textDebounce.current = window.setTimeout(() => {
      onPatch(node.id, { text: val });
      isTypingText.current = false;
    }, 50);
  };

  const handleTextBlur = () => {
    if (textDebounce.current !== null) {
      window.clearTimeout(textDebounce.current);
      textDebounce.current = null;
    }
    onPatch(node.id, { text: localText });
    isTypingText.current = false;
  };

  // Отдельный фокус для текстового узла: autoFocus ненадёжен при перерисовке
  const plainInput = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing || (node.kind !== 'plain' && node.kind !== 'sticker')) return;
    const element = plainInput.current;
    if (!element) return;
    element.focus();
    const end = element.value.length;
    element.setSelectionRange(end, end);
  }, [editing, node.kind]);

  const head = editing ? (
    <div className="node-head">
      <span className="node-icon">{node.icon || '•'}</span>
      <input
        className="node-edit"
        autoFocus
        value={localTitle}
        onChange={(event) => handleTitleChange(event.target.value)}
        onBlur={handleTitleBlur}
      />
    </div>
  ) : (
    <div className="node-head">
      <span className="node-icon">{node.icon || '•'}</span>
      <span className="node-title">{node.title}</span>
      {node.noteId && (
        <button
          className="node-badge"
          title="Открыть заметку"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (node.noteId) onOpenNote(node.noteId);
          }}
        >
          заметка
        </button>
      )}
    </div>
  );

  const bullets = editing ? (
    <>
      {node.bullets.map((bullet, index) => (
        <input
          key={`b${index}`}
          className="node-item-input"
          value={bullet}
          onChange={(event) => {
            const bullets = [...node.bullets];
            bullets[index] = event.target.value;
            onPatch(node.id, { bullets });
          }}
        />
      ))}
      <button
        className="node-sub"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onPatch(node.id, { bullets: [...node.bullets, ''] });
        }}
      >
        + пункт
      </button>
    </>
  ) : node.kind === 'quote' ? (
    node.bullets.map((bullet, index) => (
      <p className="node-quote" key={`q${index}`}>
        {bullet}
      </p>
    ))
  ) : (
    node.bullets.map((bullet, index) => (
      <div className="node-bullet" key={`b${index}`}>
        <span>{bullet}</span>
      </div>
    ))
  );

  const items = editing ? (
    <>
      {node.items.map((item) => (
        <div className="node-check" key={item.id}>
          <button
            className={`node-box${item.done ? ' on' : ''}`}
            style={item.done ? { background: 'var(--tone)', borderColor: 'transparent' } : undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleItem(node.id, item.id);
            }}
          >
            <Icon name="check" size={9} strokeWidth={3} />
          </button>
          <input
            className="node-item-input"
            value={item.text}
            onChange={(event) => {
              const items = node.items.map((i) =>
                i.id === item.id ? { ...i, text: event.target.value } : i,
              );
              onPatch(node.id, { items });
            }}
          />
          <button
            className="node-sub"
            title="Удалить пункт"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemoveItem(node.id, item.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="node-sub"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onAddItem(node.id);
        }}
      >
        + пункт
      </button>
    </>
  ) : (
    node.items.map((item) => (
      <button
        className={`node-check${item.done ? ' done' : ''}`}
        key={item.id}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleItem(node.id, item.id);
        }}
      >
        <span className="node-box">
          <Icon name="check" size={9} strokeWidth={3} />
        </span>
        <span>{item.text}</span>
      </button>
    ))
  );

  const links = editing ? (
    <>
      {node.links.map((link) => (
        <div className="node-link-row" key={link.id}>
          <input
            className="node-item-input"
            value={link.from}
            onChange={(event) =>
              onPatch(node.id, {
                links: node.links.map((l) => (l.id === link.id ? { ...l, from: event.target.value } : l)),
              })
            }
          />
          <span className="arrow">→</span>
          <input
            className="node-item-input"
            value={link.to}
            onChange={(event) =>
              onPatch(node.id, {
                links: node.links.map((l) => (l.id === link.id ? { ...l, to: event.target.value } : l)),
              })
            }
          />
          <button
            className="node-sub"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onPatch(node.id, { links: node.links.filter((l) => l.id !== link.id) });
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="node-sub"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onPatch(node.id, {
            links: [
              ...node.links,
              { id: `nl_${Math.random().toString(36).slice(2, 8)}`, from: 'Продукт', to: 'Команда' },
            ],
          });
        }}
      >
        + связь
      </button>
    </>
  ) : (
    node.links.map((link) => (
      <div className="node-link-row" key={link.id}>
        <span>{link.from}</span>
        <span className="arrow">→</span>
        <span>{link.to}</span>
      </div>
    ))
  );

  if (node.kind === 'sticker') {
    const stickerColor = node.color || '#fef08a';
    const isDark =
      stickerColor === '#27272a' || stickerColor === '#18181b' || stickerColor === '#000000';
    return (
      <div
        className={`node sticker-node${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
        data-node-id={node.id}
        style={{
          left: node.x,
          top: node.y,
          width: node.w,
          height: node.h,
          backgroundColor: stickerColor,
          color: isDark ? '#ffffff' : '#1c1917',
        }}
        onPointerDown={(event) => onPointerDown(event, node)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onStartEdit(node);
        }}
      >
        <div className="sticker-clip-wrap" title="Канцелярская скрепка">
          <svg className="sticker-clip-svg" viewBox="0 0 28 56" fill="none">
            <path
              d="M14 6 C 18 6, 22 10, 22 18 L 22 42 C 22 49, 17 52, 11 52 C 5 52, 2 48, 2 41 L 2 17 C 2 10, 6 6, 12 6 C 17 6, 19 10, 19 16 L 19 38 C 19 41, 16 43, 13 43 C 10 43, 8 41, 8 38 L 8 18"
              stroke="#dc2626"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M13 8 C 16 8, 20 11, 20 18 L 20 40"
              stroke="#f87171"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {selected && (
          <div
            className="sticker-colors-bar"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {STICKER_COLORS.map((col) => (
              <button
                key={col}
                className={`sticker-color-dot${(node.color || '#fef08a') === col ? ' active' : ''}`}
                style={{ backgroundColor: col }}
                title="Выбрать цвет стикера"
                onClick={() => onPatch(node.id, { color: col })}
              />
            ))}
            <label className="sticker-color-custom-btn" title="Выбрать любой цвет">
              <input
                type="color"
                className="sticker-color-input"
                value={node.color || '#fef08a'}
                onChange={(e) => onPatch(node.id, { color: e.target.value })}
              />
              <span className="color-wheel-icon">🎨</span>
            </label>
          </div>
        )}

        <textarea
          ref={editing ? plainInput : undefined}
          className="sticker-textarea"
          placeholder="Текст стикера…"
          value={editing ? localText : (node.text ?? '')}
          style={{ color: isDark ? '#ffffff' : '#1c1917' }}
          onChange={(event) => handleTextChange(event.target.value)}
          onBlur={handleTextBlur}
          onPointerDown={(event) => event.stopPropagation()}
        />

        {showHandles &&
          HANDLES.map((handle) => (
            <span
              key={handle.side}
              className="handle"
              data-handle={handle.side}
              style={handle.style}
              onPointerDown={(event) => onHandleDown(event, node, handle.side)}
            />
          ))}

        {selected && !editing && (
          <span className="node-resize" onPointerDown={(event) => onResizeDown(event, node)} />
        )}
      </div>
    );
  }

  if (node.kind === 'image') {
    return (
      <div
        className={`node image-node${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
        data-node-id={node.id}
        style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
        onPointerDown={(event) => onPointerDown(event, node)}
      >
        <div className="node-image-container">
          {node.imageUrl ? (
            <img
              src={node.imageUrl}
              alt={node.title || 'Изображение'}
              className="node-img-element"
              draggable={false}
            />
          ) : (
            <div className="node-img-empty">
              <Icon name="image" size={30} />
              <span>Нет фото</span>
            </div>
          )}
        </div>

        {showHandles &&
          HANDLES.map((handle) => (
            <span
              key={handle.side}
              className="handle"
              data-handle={handle.side}
              style={handle.style}
              onPointerDown={(event) => onHandleDown(event, node, handle.side)}
            />
          ))}

        {selected && onDrawOnImage && (
          <div className="node-image-actions" onPointerDown={(e) => e.stopPropagation()}>
            <button
              className="node-image-action-btn"
              title="Включить рисование на этом фото (P)"
              onClick={() => onDrawOnImage(node)}
            >
              <Icon name="pen" size={12} />
              Рисовать
            </button>
          </div>
        )}

        {selected && (
          <span className="node-resize" onPointerDown={(event) => onResizeDown(event, node)} />
        )}
      </div>
    );
  }

  if (node.kind === 'plain') {
    return (
      <div
        className={`node plain tone-${node.tone}${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
        data-node-id={node.id}
        style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
        onPointerDown={(event) => onPointerDown(event, node)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onStartEdit(node);
        }}
      >
        {editing ? (
          <textarea
            ref={plainInput}
            className="node-plain-input"
            placeholder="Введи текст…"
            value={localText}
            onChange={(event) => handleTextChange(event.target.value)}
            onBlur={handleTextBlur}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : node.text ? (
          <div className="node-plain-text">{node.text}</div>
        ) : (
          <div className="node-plain-text empty">Двойной клик — введи текст</div>
        )}
        {selected && !editing && (
          <span className="node-resize" onPointerDown={(event) => onResizeDown(event, node)} />
        )}
      </div>
    );
  }

  return (
    <div
      className={`node tone-${node.tone}${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onStartEdit(node);
      }}
    >
      {isCenter ? (
        <>
          <div className="node-center-title">
            <OrgMark size={34} className="mark" />
            <h3>{node.title}</h3>
          </div>
          <div className="node-body node-center">
            {bullets}
            {items}
            {links}
          </div>
        </>
      ) : (
        <>
          {head}
          <div className="node-body">
            {bullets}
            {items}
            {links}
          </div>
        </>
      )}

      {showHandles &&
        HANDLES.map((handle) => (
          <span
            key={handle.side}
            className="handle"
            data-handle={handle.side}
            style={handle.style}
            onPointerDown={(event) => onHandleDown(event, node, handle.side)}
          />
        ))}
      {selected && !editing && (
        <span className="node-resize" onPointerDown={(event) => onResizeDown(event, node)} />
      )}
    </div>
  );
});

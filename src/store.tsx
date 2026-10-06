import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Canvas,
  Id,
  KnowledgeBase,
  Note,
  Space,
  Tab,
  Task,
  ToneKey,
  ViewKind,
  Workspace,
} from './types';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';
import { createSeed } from './data/seed';
import { downloadJson, uid } from './lib/utils';

const STORAGE_KEY = 'org.workspace.v1';
const HISTORY_LIMIT = 60;

export type CollabStatus = 'off' | 'connecting' | 'online';

export interface Peer {
  id: number;
  name: string;
  color: string;
  avatar?: string;
}

export interface RemoteCursor {
  id: number;
  name: string;
  color: string;
  avatar?: string;
  x: number;
  y: number;
  canvasId: string;
}

// Проверенные публичные сигнальные серверы y-webrtc и STUN-серверы
const SIGNALING = [
  'wss://y-webrtc.fly.dev',
  'wss://y-webrtc-signaling.fly.dev',
  'wss://signaling.fly.dev',
];
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const SHARED_KEYS = ['notes', 'canvases', 'tasks', 'spaces'] as const;
const MEMBER_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#f97316'];

type SharedKey = (typeof SHARED_KEYS)[number];

function sharedItems(workspace: Workspace, key: SharedKey): { id: Id }[] {
  switch (key) {
    case 'notes':
      return workspace.notes;
    case 'canvases':
      return workspace.canvases;
    case 'tasks':
      return workspace.tasks;
    default:
      return workspace.spaces;
  }
}

function readRoomParam(): string {
  return new URLSearchParams(window.location.search).get('room') ?? '';
}

export const VIEW_LABELS: Record<ViewKind, string> = {
  home: 'Главная',
  note: 'Заметка',
  canvas: 'Канвас',
  knowledge: 'База знаний',
  tasks: 'Задачи',
  calendar: 'Календарь',
  graph: 'Граф связей',
};

export const VIEW_ICONS: Record<ViewKind, string> = {
  home: 'home',
  note: 'note',
  canvas: 'canvas',
  knowledge: 'database',
  tasks: 'check-square',
  calendar: 'calendar',
  graph: 'network',
};

function loadWorkspace(): Workspace {
  const seed = createSeed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as Partial<Workspace> | null;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return seed;

    const demoNoteIds = new Set([
      'n_strategy', 'n_competitors', 'n_scenarios', 'n_features', 'n_mvp',
      'n_design', 'n_onboarding', 'n_retro', 'n_reading', 'n_book_notes',
    ]);
    const demoNodeIds = new Set([
      'cn_ideas', 'cn_projects', 'cn_org', 'cn_inspire', 'cn_plan', 'cn_links',
    ]);

    const notes = (Array.isArray(parsed.notes) ? parsed.notes : []).filter(
      (n) => !demoNoteIds.has(n.id),
    );
    let canvases: Canvas[] = (Array.isArray(parsed.canvases) ? (parsed.canvases as Canvas[]) : []).map((c) => ({
      ...c,
      nodes: (c.nodes ?? []).filter((node) => !demoNodeIds.has(node.id)),
      edges: (c.edges ?? []).filter((edge) => !demoNodeIds.has(edge.from) && !demoNodeIds.has(edge.to)),
      strokes: Array.isArray(c.strokes) ? c.strokes : [],
    }));
    if (canvases.length === 0) canvases = seed.canvases;

    // Пространства теперь создаёт сам пользователь, поэтому предустановленные убираем,
    // а заметки и канвасы, которые на них ссылались, остаются без пространства.
    const presetIds = ['sp_personal', 'sp_work', 'sp_projects', 'sp_study', 'sp_inspire'];
    const spaces = (Array.isArray(parsed.spaces) ? parsed.spaces : []).filter(
      (space) => !presetIds.includes(space.id),
    );
    const spaceIds = new Set(spaces.map((space) => space.id));
    const spaceOf = (id: Id | undefined) => (id && spaceIds.has(id) ? id : '');

    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : []).filter(
      (t) => !t.noteId || !demoNoteIds.has(t.noteId),
    );
    const bases = Array.isArray(parsed.bases) ? parsed.bases : [];

    const noteIds = new Set(notes.map((n) => n.id));
    const canvasIds = new Set(canvases.map((c) => c.id));
    let tabs = (Array.isArray(parsed.tabs) ? parsed.tabs : []).filter((t) => {
      if (t.kind === 'note') return !!t.refId && noteIds.has(t.refId);
      if (t.kind === 'canvas') return !!t.refId && canvasIds.has(t.refId);
      return true;
    });
    if (tabs.length === 0) tabs = seed.tabs;

    const activeTabId = tabs.some((t) => t.id === parsed.activeTabId) ? parsed.activeTabId! : tabs[0].id;
    const activeSpaceId =
      parsed.activeSpaceId === 'all' || spaces.some((s) => s.id === parsed.activeSpaceId)
        ? parsed.activeSpaceId!
        : 'all';

    return {
      version: 1,
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      user: parsed.user && typeof parsed.user.name === 'string' ? parsed.user : seed.user,
      spaces,
      notes: notes.map((n) => ({ ...n, spaceId: spaceOf(n.spaceId) })),
      canvases: canvases.map((c) => ({
        ...c,
        spaceId: spaceOf(c.spaceId),
        grid: false,
        strokes: Array.isArray(c.strokes) ? c.strokes : [],
      })),
      tasks: tasks.map((t) => ({ ...t, spaceId: spaceOf(t.spaceId) })),
      bases: bases.map((b) => ({
        ...b,
        rows: b.rows.map((r) => ({ ...r, spaceId: spaceOf(r.spaceId) })),
      })),
      tabs,
      activeTabId,
      activeSpaceId,
    };
  } catch {
    return seed;
  }
}

function tabTitle(kind: ViewKind, refId: Id | undefined, ws: Workspace): string {
  if (kind === 'note') return ws.notes.find((n) => n.id === refId)?.title ?? VIEW_LABELS.note;
  if (kind === 'canvas') return ws.canvases.find((c) => c.id === refId)?.name ?? VIEW_LABELS.canvas;
  return VIEW_LABELS[kind];
}

export interface StoreValue {
  ws: Workspace;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  deleteSpace: (id: Id) => void;
  collabStatus: CollabStatus;
  peers: Peer[];
  remoteCursors: RemoteCursor[];
  updateMyCursor: (cursor: { x: number; y: number; canvasId: string } | null) => void;
  room: string;
  shareLink: string;
  startSharing: () => void;
  stopSharing: () => void;
  copyShareLink: () => Promise<void>;
  notesById: Record<Id, Note>;
  canvasesById: Record<Id, Canvas>;
  spacesById: Record<Id, Space>;
  activeTab: Tab;
  activeSpace: Id | 'all';
  canUndo: boolean;
  canRedo: boolean;
  historyVersion: number;
  toastMessage: string | null;
  paletteOpen: boolean;
  paletteMode: 'all' | 'search';
  settingsOpen: boolean;
  toast: (message: string) => void;
  openPalette: (mode?: 'all' | 'search') => void;
  setPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  openTab: (kind: ViewKind, refId?: Id) => void;
  setActiveTab: (tabId: Id) => void;
  closeTab: (tabId: Id) => void;
  setActiveSpace: (spaceId: Id | 'all') => void;
  createSpace: (name: string, tone?: ToneKey) => Space;
  setUserName: (name: string) => void;
  setUserAvatar: (avatar: string | undefined) => void;
  createNote: (patch?: Partial<Note>, open?: boolean) => Note;
  updateNote: (id: Id, patch: Partial<Note>) => void;
  deleteNote: (id: Id) => void;
  createCanvas: (name?: string, spaceId?: Id) => Canvas;
  updateCanvas: (id: Id, patch: Partial<Canvas>) => void;
  mutateCanvas: (id: Id, fn: (canvas: Canvas) => Canvas, options?: { history?: boolean }) => void;
  deleteCanvas: (id: Id) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  createTask: (patch?: Partial<Task>) => Task;
  updateTask: (id: Id, patch: Partial<Task>) => void;
  deleteTask: (id: Id) => void;
  updateBase: (id: Id, fn: (base: KnowledgeBase) => KnowledgeBase) => void;
  exportJson: () => void;
  importJson: (file: File) => Promise<void>;
  resetDemo: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<Workspace>(() => loadWorkspace());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<'all' | 'search'>('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const past = useRef<Canvas[][]>([]);
  const future = useRef<Canvas[][]>([]);
  const toastTimer = useRef<number | undefined>(undefined);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const ydocRef = useRef<Y.Doc | null>(null);
  const roomReady = useRef(false);

  const deleteFromRoom = useCallback((key: SharedKey, id: Id) => {
    const doc = ydocRef.current;
    if (!doc || !roomReady.current) return;
    doc.transact(() => {
      doc.getMap(key).delete(id);
    }, 'local');
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
      } catch {
        /* storage full or unavailable */
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [ws]);

  const toast = useCallback((message: string) => {
    setToastMessage(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 2200);
  }, []);

  const openPalette = useCallback((mode: 'all' | 'search' = 'all') => {
    setPaletteMode(mode);
    setPaletteOpen(true);
  }, []);

  const notesById = useMemo(
    () => Object.fromEntries(ws.notes.map((n) => [n.id, n])) as Record<Id, Note>,
    [ws.notes],
  );
  const canvasesById = useMemo(
    () => Object.fromEntries(ws.canvases.map((c) => [c.id, c])) as Record<Id, Canvas>,
    [ws.canvases],
  );
  const spacesById = useMemo(
    () => Object.fromEntries(ws.spaces.map((s) => [s.id, s])) as Record<Id, Space>,
    [ws.spaces],
  );

  const openTab = useCallback((kind: ViewKind, refId?: Id) => {
    setWs((prev) => {
      const existing = prev.tabs.find((t) => t.kind === kind && t.refId === refId);
      if (existing) return { ...prev, activeTabId: existing.id };
      const tab: Tab = { id: uid('tab'), kind, refId, title: tabTitle(kind, refId, prev) };
      return { ...prev, tabs: [...prev.tabs, tab], activeTabId: tab.id };
    });
  }, []);

  const setActiveTab = useCallback((tabId: Id) => {
    setWs((prev) => ({ ...prev, activeTabId: tabId }));
  }, []);

  const closeTab = useCallback((tabId: Id) => {
    setWs((prev) => {
      const index = prev.tabs.findIndex((t) => t.id === tabId);
      if (index === -1) return prev;
      const tabs = prev.tabs.filter((t) => t.id !== tabId);
      if (!tabs.length) {
        const fallback: Tab = { id: uid('tab'), kind: 'home', title: VIEW_LABELS.home };
        return { ...prev, tabs: [fallback], activeTabId: fallback.id };
      }
      const activeTabId =
        prev.activeTabId === tabId ? tabs[Math.min(index, tabs.length - 1)].id : prev.activeTabId;
      return { ...prev, tabs, activeTabId };
    });
  }, []);

  const setActiveSpace = useCallback((spaceId: Id | 'all') => {
    setWs((prev) => ({ ...prev, activeSpaceId: spaceId }));
  }, []);

  const createSpace = useCallback(
    (name: string, tone: ToneKey = 'violet') => {
      const space: Space = { id: uid('sp'), name, tone };
      setWs((prev) => ({ ...prev, spaces: [...prev.spaces, space] }));
      return space;
    },
    [],
  );

  const setUserName = useCallback((name: string) => {
    setWs((prev) => ({ ...prev, user: { ...prev.user, name } }));
  }, []);

  const setUserAvatar = useCallback((avatar: string | undefined) => {
    setWs((prev) => ({ ...prev, user: { ...prev.user, avatar } }));
  }, []);

  const setTheme = useCallback((theme: 'dark' | 'light') => {
    document.documentElement.dataset.theme = theme;
    setWs((prev) => {
      const next = { ...prev, theme };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const deleteSpace = useCallback((id: Id) => {
    deleteFromRoom('spaces', id);
    setWs((prev) => ({
      ...prev,
      spaces: prev.spaces.filter((s) => s.id !== id),
      notes: prev.notes.map((n) => (n.spaceId === id ? { ...n, spaceId: '' } : n)),
      canvases: prev.canvases.map((c) => (c.spaceId === id ? { ...c, spaceId: '' } : c)),
      tasks: prev.tasks.map((t) => (t.spaceId === id ? { ...t, spaceId: '' } : t)),
      bases: prev.bases.map((b) => ({
        ...b,
        rows: b.rows.map((r) => (r.spaceId === id ? { ...r, spaceId: '' } : r)),
      })),
      activeSpaceId: prev.activeSpaceId === id ? 'all' : prev.activeSpaceId,
    }));
  }, [deleteFromRoom]);

  const createNote = useCallback((patch: Partial<Note> = {}, open = true) => {
    const timestamp = new Date().toISOString();
    const current = wsRef.current;
    const spaceId =
      patch.spaceId ?? (current.activeSpaceId !== 'all' ? current.activeSpaceId : (current.spaces[0]?.id ?? ''));
    const note: Note = {
      id: uid('n'),
      title: patch.title ?? 'Без названия',
      body: patch.body ?? '',
      spaceId,
      folder: patch.folder ?? 'Заметки',
      tags: patch.tags ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const tab: Tab = { id: uid('tab'), kind: 'note', refId: note.id, title: note.title };
    setWs((prev) => ({
      ...prev,
      notes: [note, ...prev.notes],
      tabs: open ? [...prev.tabs, tab] : prev.tabs,
      activeTabId: open ? tab.id : prev.activeTabId,
    }));
    return note;
  }, []);

  const updateNote = useCallback((id: Id, patch: Partial<Note>) => {
    setWs((prev) => ({
      ...prev,
      notes: prev.notes.map((n) =>
        n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n,
      ),
      tabs: prev.tabs.map((t) =>
        t.kind === 'note' && t.refId === id && patch.title ? { ...t, title: patch.title } : t,
      ),
    }));
  }, []);

  const deleteNote = useCallback((id: Id) => {
    deleteFromRoom('notes', id);
    setWs((prev) => {
      const tabs = prev.tabs.filter((t) => !(t.kind === 'note' && t.refId === id));
      const nextTabs = tabs.length ? tabs : [{ id: uid('tab'), kind: 'home' as ViewKind, title: 'Главная' }];
      return {
        ...prev,
        notes: prev.notes.filter((n) => n.id !== id),
        tasks: prev.tasks.filter((t) => t.noteId !== id),
        bases: prev.bases.map((b) => ({ ...b, rows: b.rows.filter((r) => r.noteId !== id) })),
        canvases: prev.canvases.map((c) => ({
          ...c,
          nodes: c.nodes.map((n) => (n.noteId === id ? { ...n, noteId: undefined } : n)),
        })),
        tabs: nextTabs,
        activeTabId: nextTabs.some((t) => t.id === prev.activeTabId) ? prev.activeTabId : nextTabs[0].id,
      };
    });
  }, [deleteFromRoom]);

  const createCanvas = useCallback((name = 'Новый канвас', spaceId?: Id) => {
    const timestamp = new Date().toISOString();
    const current = wsRef.current;
    const canvas: Canvas = {
      id: uid('cv'),
      name,
      description: 'Собери идеи в узлы и соедини их связями.',
      spaceId: spaceId ?? (current.activeSpaceId !== 'all' ? current.activeSpaceId : (current.spaces[0]?.id ?? '')),
      nodes: [
        {
          id: uid('cn'),
          x: 320,
          y: 220,
          w: 250,
          h: 112,
          title: 'Org',
          icon: '',
          tone: 'violet',
          kind: 'text',
          bullets: ['Заметки. Канвасы. Люди.'],
          items: [],
          links: [],
        },
      ],
      edges: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      grid: false,
      updatedAt: timestamp,
    };
    const tab: Tab = { id: uid('tab'), kind: 'canvas', refId: canvas.id, title: canvas.name };
    setWs((prev) => ({
      ...prev,
      canvases: [...prev.canvases, canvas],
      tabs: [...prev.tabs, tab],
      activeTabId: tab.id,
    }));
    return canvas;
  }, []);

  const updateCanvas = useCallback((id: Id, patch: Partial<Canvas>) => {
    setWs((prev) => ({
      ...prev,
      canvases: prev.canvases.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
      ),
      tabs: prev.tabs.map((t) =>
        t.kind === 'canvas' && t.refId === id && patch.name ? { ...t, title: patch.name } : t,
      ),
    }));
  }, []);

  const pushHistory = useCallback(() => {
    past.current.push(structuredClone(wsRef.current.canvases));
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
    setHistoryTick((v) => v + 1);
  }, []);

  const mutateCanvas = useCallback(
    (id: Id, fn: (canvas: Canvas) => Canvas, options: { history?: boolean } = {}) => {
      const history = options.history ?? true;
      if (history) pushHistory();
      setWs((prev) => ({
        ...prev,
        canvases: prev.canvases.map((c) =>
          c.id === id ? { ...fn(c), updatedAt: new Date().toISOString() } : c,
        ),
      }));
    },
    [pushHistory],
  );

  const deleteCanvas = useCallback((id: Id) => {
    deleteFromRoom('canvases', id);
    setWs((prev) => {
      const tabs = prev.tabs.filter((t) => !(t.kind === 'canvas' && t.refId === id));
      const nextTabs = tabs.length ? tabs : [{ id: uid('tab'), kind: 'home' as ViewKind, title: 'Главная' }];
      return {
        ...prev,
        canvases: prev.canvases.filter((c) => c.id !== id),
        tasks: prev.tasks.map((t) => (t.canvasId === id ? { ...t, canvasId: undefined } : t)),
        tabs: nextTabs,
        activeTabId: nextTabs.some((t) => t.id === prev.activeTabId) ? prev.activeTabId : nextTabs[0].id,
      };
    });
  }, [deleteFromRoom]);

  const undo = useCallback(() => {
    const snapshot = past.current.pop();
    if (!snapshot) return;
    future.current.push(structuredClone(wsRef.current.canvases));
    setWs((prev) => ({ ...prev, canvases: snapshot }));
    setHistoryTick((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    const snapshot = future.current.pop();
    if (!snapshot) return;
    past.current.push(structuredClone(wsRef.current.canvases));
    setWs((prev) => ({ ...prev, canvases: snapshot }));
    setHistoryTick((v) => v + 1);
  }, []);

  const createTask = useCallback((patch: Partial<Task> = {}) => {
    const current = wsRef.current;
    const task: Task = {
      id: uid('t'),
      title: patch.title ?? 'Новая задача',
      status: patch.status ?? 'backlog',
      priority: patch.priority ?? 'med',
      due: patch.due,
      spaceId:
        patch.spaceId ?? (current.activeSpaceId !== 'all' ? current.activeSpaceId : (current.spaces[0]?.id ?? '')),
      noteId: patch.noteId,
      canvasId: patch.canvasId,
      createdAt: new Date().toISOString(),
    };
    setWs((prev) => ({ ...prev, tasks: [...prev.tasks, task] }));
    return task;
  }, []);

  const updateTask = useCallback((id: Id, patch: Partial<Task>) => {
    setWs((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  const deleteTask = useCallback((id: Id) => {
    deleteFromRoom('tasks', id);
    setWs((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== id) }));
  }, [deleteFromRoom]);

  const updateBase = useCallback((id: Id, fn: (base: KnowledgeBase) => KnowledgeBase) => {
    setWs((prev) => ({
      ...prev,
      bases: prev.bases.map((b) => (b.id === id ? fn(b) : b)),
    }));
  }, []);

  const exportJson = useCallback(() => {
    downloadJson(`org-workspace-${new Date().toISOString().slice(0, 10)}.json`, ws);
  }, [ws]);

  const importJson = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = JSON.parse(text) as Workspace;
      if (!parsed || !Array.isArray(parsed.notes) || !Array.isArray(parsed.canvases)) {
        throw new Error('Некорректный файл рабочего пространства');
      }
      setWs({ ...createSeed(), ...parsed, version: 1 });
    },
    [],
  );

  const resetDemo = useCallback(() => {
    past.current = [];
    future.current = [];
    setWs(createSeed());
  }, []);

  // --- совместная работа: гибридный WebSocket (100% совместимость с Mac/Windows/моб) + WebRTC ---
  const [room, setRoom] = useState(readRoomParam);
  const [collabStatus, setCollabStatus] = useState<CollabStatus>(room ? 'connecting' : 'off');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const wsProviderRef = useRef<WebsocketProvider | null>(null);
  const webrtcProviderRef = useRef<WebrtcProvider | null>(null);
  const isCreatorRef = useRef(false);
  const applyingRemote = useRef(false);
  const myColor = useRef(MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)]);

  const updateMyCursor = useCallback((cursor: { x: number; y: number; canvasId: string } | null) => {
    wsProviderRef.current?.awareness.setLocalStateField('cursor', cursor);
    webrtcProviderRef.current?.awareness.setLocalStateField('cursor', cursor);
  }, []);

  useEffect(() => {
    if (!room) {
      setCollabStatus('off');
      setPeers([]);
      setRemoteCursors([]);
      return;
    }

    setCollabStatus('connecting');
    roomReady.current = false;
    const doc = new Y.Doc();
    ydocRef.current = doc;

    const roomName = `org-v2-${room}`;

    // 1. WebSocket провайдер (надёжно соединяет через интернет между разными сетями, Mac, Windows, мобильными)
    const wsProvider = new WebsocketProvider('wss://demos.yjs.dev/ws', roomName, doc);
    wsProviderRef.current = wsProvider;

    // 2. WebRTC провайдер (P2P резерв)
    const webrtcProvider = new WebrtcProvider(roomName, doc, {
      signaling: SIGNALING,
      peerOpts: {
        config: {
          iceServers: ICE_SERVERS,
        },
      },
    });
    webrtcProviderRef.current = webrtcProvider;

    const maps = SHARED_KEYS.map((key) => doc.getMap<Record<string, unknown>>(key));
    const meta = doc.getMap<unknown>('meta');

    const adoptRoom = () => {
      applyingRemote.current = true;
      setWs((prev) => {
        const next: Workspace = { ...prev };
        SHARED_KEYS.forEach((key, index) => {
          const incoming = Array.from(maps[index].values());
          if (incoming.length > 0) {
            if (key === 'notes') next.notes = incoming as unknown as Note[];
            else if (key === 'canvases') next.canvases = incoming as unknown as Canvas[];
            else if (key === 'tasks') next.tasks = incoming as unknown as Task[];
            else next.spaces = incoming as unknown as Space[];
          }
        });

        // Сохраняем тему текущего пользователя (тема не перезаписывается комнатой)
        next.theme = prev.theme;

        // Автоматически открываем общий канвас или проверяем валидность активных вкладок
        if (next.canvases.length > 0) {
          const canvasIds = new Set(next.canvases.map((c) => c.id));
          const urlCanvas = new URLSearchParams(window.location.search).get('canvas');
          const targetCanvasId = urlCanvas && canvasIds.has(urlCanvas) ? urlCanvas : next.canvases[0].id;

          const currentTab = next.tabs.find((t) => t.id === next.activeTabId);
          if (currentTab && currentTab.kind === 'canvas') {
            if (!currentTab.refId || !canvasIds.has(currentTab.refId)) {
              currentTab.refId = targetCanvasId;
              currentTab.title = tabTitle('canvas', targetCanvasId, next);
            }
          } else if (urlCanvas && canvasIds.has(urlCanvas)) {
            const existingTab = next.tabs.find((t) => t.kind === 'canvas' && t.refId === urlCanvas);
            if (existingTab) {
              next.activeTabId = existingTab.id;
            } else {
              const newTab: Tab = {
                id: uid('tab'),
                kind: 'canvas',
                refId: urlCanvas,
                title: tabTitle('canvas', urlCanvas, next),
              };
              next.tabs.push(newTab);
              next.activeTabId = newTab.id;
            }
          }
        }

        return next;
      });
      window.setTimeout(() => {
        applyingRemote.current = false;
      }, 0);
    };

    const openRoom = () => {
      if (roomReady.current) return;
      roomReady.current = true;
      const hasContent = maps.some((map) => map.size > 0) || meta.get('seeded') === true;
      if (hasContent) {
        adoptRoom();
      } else if (isCreatorRef.current) {
        // Создатель комнаты сразу наполняет её данными
        meta.set('seeded', true);
        doc.transact(() => {
          SHARED_KEYS.forEach((key, index) => {
            for (const item of sharedItems(wsRef.current, key)) {
              maps[index].set(item.id, item as unknown as Record<string, unknown>);
            }
          });
        }, 'local');
      }
    };

    // Если текущий клиент создал комнату через кнопку, сразу наполняем Yjs документ
    if (isCreatorRef.current) {
      openRoom();
    }

    let applyRemoteRaf: number | null = null;
    const applyRemote = (_event: any, tr: any) => {
      if (tr && tr.origin === 'local') return;
      if (!roomReady.current) {
        openRoom();
        return;
      }
      if (applyRemoteRaf !== null) return;
      applyRemoteRaf = requestAnimationFrame(() => {
        applyRemoteRaf = null;
        adoptRoom();
      });
    };

    maps.forEach((map) => map.observe(applyRemote));

    let awarenessThrottle: number | null = null;
    const syncAwareness = () => {
      const list: Peer[] = [];
      const cursors: RemoteCursor[] = [];
      const seen = new Set<number>();

      const checkPeer = (clientId: number, state: any) => {
        if (clientId === doc.clientID || seen.has(clientId)) return;
        seen.add(clientId);
        const user = state.user as { name?: string; color?: string; avatar?: string } | undefined;
        if (!user?.name) return;
        const peerName = user.name;
        const peerColor = user.color ?? MEMBER_COLORS[0];
        const peerAvatar = user.avatar;
        list.push({
          id: clientId,
          name: peerName,
          color: peerColor,
          avatar: peerAvatar,
        });
        const cursor = state.cursor as { x: number; y: number; canvasId: string } | undefined;
        if (cursor && typeof cursor.x === 'number' && typeof cursor.y === 'number') {
          cursors.push({
            id: clientId,
            name: peerName,
            color: peerColor,
            avatar: peerAvatar,
            x: cursor.x,
            y: cursor.y,
            canvasId: cursor.canvasId,
          });
        }
      };

      wsProvider.awareness.getStates().forEach((state, id) => checkPeer(id, state));
      webrtcProvider.awareness.getStates().forEach((state, id) => checkPeer(id, state));

      setPeers(list);
      setRemoteCursors(cursors);
      setCollabStatus(list.length > 0 || wsProvider.wsconnected ? 'online' : 'connecting');
    };

    const throttledSyncAwareness = () => {
      if (awarenessThrottle !== null) return;
      awarenessThrottle = window.setTimeout(() => {
        awarenessThrottle = null;
        syncAwareness();
      }, 45);
    };

    const userState = {
      name: wsRef.current.user.name,
      avatar: wsRef.current.user.avatar,
      color: myColor.current,
    };
    wsProvider.awareness.setLocalStateField('user', userState);
    webrtcProvider.awareness.setLocalStateField('user', userState);

    wsProvider.awareness.on('change', throttledSyncAwareness);
    webrtcProvider.awareness.on('change', throttledSyncAwareness);

    wsProvider.on('status', (e: { status: string }) => {
      if (e.status === 'connected') {
        openRoom();
        syncAwareness();
      }
    });

    wsProvider.on('sync', (isSynced: boolean) => {
      if (isSynced) {
        openRoom();
        syncAwareness();
      }
    });

    webrtcProvider.on('synced', ({ synced }: { synced: boolean }) => {
      if (synced) {
        openRoom();
        syncAwareness();
      }
    });

    const fallback = window.setTimeout(() => {
      openRoom();
      syncAwareness();
    }, 1500);

    return () => {
      window.clearTimeout(fallback);
      if (awarenessThrottle !== null) window.clearTimeout(awarenessThrottle);
      if (applyRemoteRaf !== null) cancelAnimationFrame(applyRemoteRaf);
      wsProvider.awareness.off('change', throttledSyncAwareness);
      webrtcProvider.awareness.off('change', throttledSyncAwareness);
      maps.forEach((map) => map.unobserve(applyRemote));
      wsProvider.destroy();
      webrtcProvider.destroy();
      doc.destroy();
      ydocRef.current = null;
      wsProviderRef.current = null;
      webrtcProviderRef.current = null;
      roomReady.current = false;
      setCollabStatus('off');
      setPeers([]);
      setRemoteCursors([]);
    };
  }, [room]);

  useEffect(() => {
    if (!room) return;
    const doc = ydocRef.current;
    if (!doc || !roomReady.current || applyingRemote.current) return;
    const timer = window.setTimeout(() => {
      if (!ydocRef.current || !roomReady.current || applyingRemote.current) return;
      ydocRef.current.transact(() => {
        SHARED_KEYS.forEach((key) => {
          const map = ydocRef.current!.getMap<Record<string, unknown>>(key);
          const local = sharedItems(wsRef.current, key);
          for (const item of local) {
            const remote = map.get(item.id);
            if (!remote || JSON.stringify(remote) !== JSON.stringify(item)) {
              map.set(item.id, item as unknown as Record<string, unknown>);
            }
          }
        });
      }, 'local');
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, [room, ws.notes, ws.canvases, ws.tasks, ws.spaces]);

  useEffect(() => {
    if (!room) return;
    const userState = {
      name: ws.user.name,
      avatar: ws.user.avatar,
      color: myColor.current,
    };
    wsProviderRef.current?.awareness.setLocalStateField('user', userState);
    webrtcProviderRef.current?.awareness.setLocalStateField('user', userState);
  }, [room, ws.user.name, ws.user.avatar]);

  const activeTab = useMemo(
    () => ws.tabs.find((t) => t.id === ws.activeTabId) ?? ws.tabs[0],
    [ws.tabs, ws.activeTabId],
  );

  const shareLink = useMemo(() => {
    if (!room) return '';
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('room', room);
    if (activeTab.kind === 'canvas' && activeTab.refId) {
      url.searchParams.set('canvas', activeTab.refId);
    }
    return url.toString();
  }, [room, activeTab]);

  const startSharing = useCallback(() => {
    isCreatorRef.current = true;
    const newRoom = Math.random().toString(36).slice(2, 10);
    const url = new URL(window.location.href);
    url.searchParams.set('room', newRoom);
    if (activeTab.kind === 'canvas' && activeTab.refId) {
      url.searchParams.set('canvas', activeTab.refId);
    }
    window.history.pushState({}, '', url.toString());
    setRoom(newRoom);
    try {
      navigator.clipboard?.writeText(url.toString());
      toast('Комната создана! Ссылка скопирована в буфер');
    } catch {
      toast('Комната создана!');
    }
  }, [activeTab, toast]);

  const stopSharing = useCallback(() => {
    isCreatorRef.current = false;
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('canvas');
    window.history.pushState({}, '', url.toString());
    setRoom('');
    toast('Вы вышли из комнаты');
  }, [toast]);

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      toast('Ссылка на комнату скопирована — отправь её другу');
    } catch {
      toast('Не удалось скопировать, скопируй ссылку вручную');
    }
  }, [shareLink, toast]);

  const value: StoreValue = {
    ws,
    theme: ws.theme ?? 'dark',
    setTheme,
    deleteSpace,
    collabStatus,
    peers,
    remoteCursors,
    updateMyCursor,
    room,
    shareLink,
    startSharing,
    stopSharing,
    copyShareLink,
    notesById,
    canvasesById,
    spacesById,
    activeTab,
    activeSpace: ws.activeSpaceId,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    historyVersion: historyTick,
    toastMessage,
    paletteOpen,
    paletteMode,
    settingsOpen,
    toast,
    openPalette,
    setPaletteOpen,
    setSettingsOpen,
    openTab,
    setActiveTab,
    closeTab,
    setActiveSpace,
    createSpace,
    setUserName,
    setUserAvatar,
    createNote,
    updateNote,
    deleteNote,
    createCanvas,
    updateCanvas,
    mutateCanvas,
    deleteCanvas,
    pushHistory,
    undo,
    redo,
    createTask,
    updateTask,
    deleteTask,
    updateBase,
    exportJson,
    importJson,
    resetDemo,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

export function useFilteredNotes(): Note[] {
  const { ws, activeSpace } = useStore();
  return useMemo(
    () =>
      activeSpace === 'all'
        ? ws.notes
        : ws.notes.filter((n) => n.spaceId === activeSpace),
    [ws.notes, activeSpace],
  );
}

export { tabTitle, STORAGE_KEY };

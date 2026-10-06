import type { Canvas, KnowledgeBase, Note, Space, Tab, Task, Workspace } from '../types';
import { uid } from '../lib/utils';

const now = new Date().toISOString();

export const SPACES: Space[] = [];

export const NOTES: Note[] = [];

export const CANVASES: Canvas[] = [
  {
    id: 'cv_main',
    name: 'Мой канвас',
    description: '',
    spaceId: '',
    nodes: [],
    edges: [],
    strokes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    grid: false,
    updatedAt: now,
  },
];

export const TASKS: Task[] = [];

export const BASES: KnowledgeBase[] = [];

export const TABS: Tab[] = [
  { id: uid('tab'), kind: 'canvas', refId: 'cv_main', title: 'Мой канвас' },
  { id: uid('tab'), kind: 'home', title: 'Главная' },
];

export function createSeed(): Workspace {
  return {
    version: 1,
    user: { name: 'Гость' },
    spaces: [],
    notes: [],
    canvases: CANVASES.map((item) => ({ ...item })),
    tasks: [],
    bases: [],
    tabs: TABS,
    activeTabId: TABS[0].id,
    activeSpaceId: 'all',
  };
}

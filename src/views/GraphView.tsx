import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { useStore } from '../store';
import { normalize } from '../lib/utils';
import type { Id } from '../types';

interface SimulationNode {
  id: Id;
  title: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  linksCount: number;
  tags: string[];
}

interface SimulationEdge {
  from: Id;
  to: Id;
}

export function GraphView() {
  const { ws, openTab, createNote, activeSpace, spacesById } = useStore();
  const [hoverId, setHoverId] = useState<Id | null>(null);
  const [search, setSearch] = useState('');
  const [showTags, setShowTags] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    nodeId: Id | null;
    startX: number;
    startY: number;
    moved: boolean;
    isPanning: boolean;
    panStartX: number;
    panStartY: number;
  }>({
    nodeId: null,
    startX: 0,
    startY: 0,
    moved: false,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
  });

  // Filter notes by active space
  const notes = useMemo(
    () => ws.notes.filter((n) => (activeSpace === 'all' ? true : n.spaceId === activeSpace)),
    [ws.notes, activeSpace],
  );

  // Parse links and build initial graph topology
  const { initialNodes, edges } = useMemo(() => {
    const titleToId = new Map<string, Id>();
    notes.forEach((n) => {
      titleToId.set(normalize(n.title), n.id);
    });

    const edgeMap = new Map<string, SimulationEdge>();
    const linkCounts = new Map<Id, number>();

    notes.forEach((note) => {
      const matches = note.body.match(/\[\[([^\]]+)\]\]/g) ?? [];
      matches.forEach((match) => {
        const linkTitle = match.slice(2, -2).trim();
        const targetId = titleToId.get(normalize(linkTitle));
        if (targetId && targetId !== note.id) {
          const key = [note.id, targetId].sort().join(':::');
          if (!edgeMap.has(key)) {
            edgeMap.set(key, { from: note.id, to: targetId });
            linkCounts.set(note.id, (linkCounts.get(note.id) ?? 0) + 1);
            linkCounts.set(targetId, (linkCounts.get(targetId) ?? 0) + 1);
          }
        }
      });
    });

    // Optionally link notes that share tags
    if (showTags) {
      const tagMap = new Map<string, Id[]>();
      notes.forEach((note) => {
        note.tags.forEach((tag) => {
          const t = normalize(tag);
          if (!tagMap.has(t)) tagMap.set(t, []);
          tagMap.get(t)!.push(note.id);
        });
      });
      tagMap.forEach((ids) => {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const key = [ids[i], ids[j]].sort().join(':::');
            if (!edgeMap.has(key)) {
              edgeMap.set(key, { from: ids[i], to: ids[j] });
              linkCounts.set(ids[i], (linkCounts.get(ids[i]) ?? 0) + 1);
              linkCounts.set(ids[j], (linkCounts.get(ids[j]) ?? 0) + 1);
            }
          }
        }
      });
    }

    const nList: SimulationNode[] = notes.map((note, index) => {
      const angle = (index / Math.max(1, notes.length)) * Math.PI * 2;
      const dist = 120 + Math.random() * 80;
      const count = linkCounts.get(note.id) ?? 0;
      return {
        id: note.id,
        title: note.title,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        radius: 6 + Math.min(16, count * 2.2),
        linksCount: count,
        tags: note.tags,
      };
    });

    return { initialNodes: nList, edges: Array.from(edgeMap.values()) };
  }, [notes, showTags]);

  const [simNodes, setSimNodes] = useState<SimulationNode[]>(initialNodes);
  const nodesRef = useRef<SimulationNode[]>(initialNodes);
  nodesRef.current = simNodes;

  // Sync when notes change
  useEffect(() => {
    setSimNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      return initialNodes.map((newNode) => {
        const existing = prevMap.get(newNode.id);
        if (existing) {
          return {
            ...newNode,
            x: existing.x,
            y: existing.y,
            vx: existing.vx,
            vy: existing.vy,
          };
        }
        return newNode;
      });
    });
  }, [initialNodes]);

  // Force-directed physics engine
  const alphaRef = useRef(1.0);
  const animFrameRef = useRef<number | null>(null);

  const wakeSimulation = useCallback(() => {
    alphaRef.current = 0.8;
  }, []);

  useEffect(() => {
    wakeSimulation();
  }, [edges.length, notes.length, showTags, wakeSimulation]);

  useEffect(() => {
    let active = true;

    const tick = () => {
      if (!active) return;
      if (alphaRef.current > 0.005) {
        const currentNodes = [...nodesRef.current];
        const nMap = new Map(currentNodes.map((n) => [n.id, n]));
        const alpha = alphaRef.current;
        const draggedId = dragRef.current.nodeId;

        // 1. Repulsion between all node pairs
        for (let i = 0; i < currentNodes.length; i++) {
          for (let j = i + 1; j < currentNodes.length; j++) {
            const a = currentNodes[i];
            const b = currentNodes[j];
            const dx = b.x - a.x || (Math.random() - 0.5);
            const dy = b.y - a.y || (Math.random() - 0.5);
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq) || 1;
            const minDist = a.radius + b.radius + 36;
            const force = (minDist * minDist * 45) / (distSq + 200);

            const fx = (dx / dist) * force * alpha;
            const fy = (dy / dist) * force * alpha;

            if (a.id !== draggedId) {
              a.vx -= fx;
              a.vy -= fy;
            }
            if (b.id !== draggedId) {
              b.vx += fx;
              b.vy += fy;
            }
          }
        }

        // 2. Spring attraction along edges
        edges.forEach((edge) => {
          const a = nMap.get(edge.from);
          const b = nMap.get(edge.to);
          if (!a || !b) return;

          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const targetDist = 90;
          const springForce = (dist - targetDist) * 0.035 * alpha;

          const fx = (dx / dist) * springForce;
          const fy = (dy / dist) * springForce;

          if (a.id !== draggedId) {
            a.vx += fx;
            a.vy += fy;
          }
          if (b.id !== draggedId) {
            b.vx -= fx;
            b.vy -= fy;
          }
        });

        // 3. Center gravity & velocity damping
        currentNodes.forEach((node) => {
          if (node.id === draggedId) return;

          // Center gravity
          node.vx -= node.x * 0.015 * alpha;
          node.vy -= node.y * 0.015 * alpha;

          // Damping (friction)
          node.vx *= 0.82;
          node.vy *= 0.82;

          // Velocity clamp
          const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
          if (speed > 25) {
            node.vx = (node.vx / speed) * 25;
            node.vy = (node.vy / speed) * 25;
          }

          node.x += node.vx;
          node.y += node.vy;
        });

        alphaRef.current *= 0.985;
        setSimNodes([...currentNodes]);
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [edges]);

  // Wheel zoom handling
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setZoom((z) => Math.min(2.5, Math.max(0.25, z * factor)));
  };

  // Dragging nodes or panning canvas
  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const nodeEl = target.closest('[data-graph-node-id]') as HTMLElement | null;

    if (nodeEl) {
      const id = nodeEl.dataset.graphNodeId as Id;
      dragRef.current = {
        nodeId: id,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        isPanning: false,
        panStartX: pan.x,
        panStartY: pan.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      wakeSimulation();
      return;
    }

    // Otherwise pan canvas
    dragRef.current = {
      nodeId: null,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      isPanning: true,
      panStartX: pan.x,
      panStartY: pan.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const { nodeId, isPanning, startX, startY, panStartX, panStartY } = dragRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true;
    }

    if (isPanning) {
      setPan({ x: panStartX + dx, y: panStartY + dy });
      return;
    }

    if (nodeId) {
      wakeSimulation();
      setSimNodes((prev) =>
        prev.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              x: n.x + dx / zoom,
              y: n.y + dy / zoom,
              vx: 0,
              vy: 0,
            };
          }
          return n;
        }),
      );
      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;
    }
  };

  const handlePointerUp = (_e: React.PointerEvent) => {
    const { nodeId, moved } = dragRef.current;
    if (nodeId && !moved) {
      openTab('note', nodeId);
    }
    dragRef.current.nodeId = null;
    dragRef.current.isPanning = false;
  };

  // Node position map
  const nodeMap = useMemo(() => new Map(simNodes.map((n) => [n.id, n])), [simNodes]);

  // Neighbors of hovered node
  const neighborIds = useMemo(() => {
    if (!hoverId) return new Set<Id>();
    const set = new Set<Id>([hoverId]);
    edges.forEach((e) => {
      if (e.from === hoverId) set.add(e.to);
      if (e.to === hoverId) set.add(e.from);
    });
    return set;
  }, [hoverId, edges]);

  // Filtered nodes
  const searchFilter = normalize(search);
  const matchedNodeIds = useMemo(() => {
    if (!searchFilter) return null;
    return new Set(
      notes
        .filter(
          (n) =>
            normalize(n.title).includes(searchFilter) ||
            n.tags.some((t) => normalize(t).includes(searchFilter)),
        )
        .map((n) => n.id),
    );
  }, [notes, searchFilter]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    wakeSimulation();
  };

  return (
    <div className="view graph-view-page">
      <div className="view-head">
        <div>
          <h1 className="view-title">Граф связей</h1>
          <p className="view-sub">
            Интерактивная карта знаний: {notes.length} заметок и {edges.length} связей. Перетаскивай
            узлы мышью, используй колёсико для зума, клик — открыть заметку.
          </p>
        </div>
        <div className="view-head-actions">
          <div className="graph-search-bar">
            <Icon name="search" size={14} />
            <input
              type="text"
              placeholder="Поиск по графу…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="clear-btn" onClick={() => setSearch('')}>
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
          <button
            className={`btn${showTags ? ' active' : ''}`}
            title="Связывать заметки с одинаковыми #тегами"
            onClick={() => setShowTags((v) => !v)}
          >
            <Icon name="network" size={15} />
            {showTags ? 'Теги включены' : 'Связи по тегам'}
          </button>
          <button className="btn" onClick={() => openTab('note')}>
            <Icon name="note" size={15} />
            К заметкам
          </button>
        </div>
      </div>

      <div
        className="graph-wrap"
        ref={containerRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {notes.length === 0 ? (
          <div className="graph-empty-state">
            <div className="graph-empty-icon">
              <Icon name="network" size={38} />
            </div>
            <h2>В пространстве пока нет заметок</h2>
            <p>
              Создай свои первые заметки и связывай их через <code>[[название]]</code>. Граф
              автоматически выстроит связи и живую карту твоих идей.
            </p>
            <button
              className="btn primary"
              onClick={() => {
                const created = createNote({ title: 'Первая мысль' });
                openTab('note', created.id);
              }}
            >
              <Icon name="plus" size={15} />
              Создать первую заметку
            </button>
          </div>
        ) : (
          <svg className="graph-svg">
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Background ambient center marker */}
              <circle cx={0} cy={0} r={4} fill="var(--line-strong)" opacity={0.35} />

              {/* Graph Edges */}
              {edges.map((edge) => {
                const a = nodeMap.get(edge.from);
                const b = nodeMap.get(edge.to);
                if (!a || !b) return null;

                const isConnectedToHover = hoverId && (edge.from === hoverId || edge.to === hoverId);
                const isDimmed = hoverId && !isConnectedToHover;

                return (
                  <line
                    key={`${edge.from}-${edge.to}`}
                    className={`graph-edge-line${isConnectedToHover ? ' hot' : ''}${isDimmed ? ' dimmed' : ''}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                  />
                );
              })}

              {/* Graph Nodes */}
              {simNodes.map((node) => {
                const isHovered = hoverId === node.id;
                const isNeighbor = neighborIds.has(node.id);
                const isDimmed = hoverId && !isNeighbor;
                const isMatched = matchedNodeIds ? matchedNodeIds.has(node.id) : true;

                return (
                  <g
                    key={node.id}
                    data-graph-node-id={node.id}
                    className={`graph-node-group${isHovered ? ' hovered' : ''}${isNeighbor ? ' neighbor' : ''}${isDimmed || !isMatched ? ' dimmed' : ''}`}
                    transform={`translate(${node.x}, ${node.y})`}
                    onPointerEnter={() => setHoverId(node.id)}
                    onPointerLeave={() => setHoverId(null)}
                  >
                    {/* Glowing outer halo on hover */}
                    {isHovered && (
                      <circle
                        r={node.radius + 8}
                        className="graph-node-halo"
                      />
                    )}

                    {/* Main node circle */}
                    <circle
                      r={node.radius}
                      className="graph-node-circle"
                    />

                    {/* Node title */}
                    <text
                      y={node.radius + 15}
                      className="graph-node-label"
                    >
                      {node.title.length > 22 ? `${node.title.slice(0, 20)}…` : node.title}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {/* Floating Controls */}
        <div className="graph-controls">
          <button className="icon-btn" title="Приблизить" onClick={() => setZoom((z) => Math.min(2.5, z * 1.2))}>
            <Icon name="plus" size={15} />
          </button>
          <button className="icon-btn" title="Отдалить" onClick={() => setZoom((z) => Math.max(0.25, z / 1.2))}>
            <Icon name="minus" size={15} />
          </button>
          <button className="icon-btn" title="Сбросить вид" onClick={resetView}>
            <Icon name="maximize" size={14} />
          </button>
        </div>

        {/* Legend / Hovered Note Info */}
        <div className="graph-info-badge">
          {hoverId ? (
            <span className="badge-highlight">
              <strong>{nodeMap.get(hoverId)?.title}</strong> · {nodeMap.get(hoverId)?.linksCount} связей (клик — открыть)
            </span>
          ) : (
            <span>
              Связи строятся из <code>[[ссылок]]</code> внутри заметок. Зум: {Math.round(zoom * 100)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

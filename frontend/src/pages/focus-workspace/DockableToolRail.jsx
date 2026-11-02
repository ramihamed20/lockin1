import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical } from 'lucide-react';
import { DEFAULT_DOCK, clampDock, readDock, snapDock } from './toolbarPosition.js';
import './dockable-tool-rail.css';

/** Chrome-only positioning. Ink, document state and tool settings stay with the reader. */
export function DockableToolRail({ children, railRef, readerRef, userId, arabic, onMove, ...props }) {
  const key = `lock-in.focus.tool-dock.v1:${userId || 'guest'}`;
  const [dock, setDock] = useState(() => {
    try { return readDock(JSON.parse(localStorage.getItem(key))); } catch { return { ...DEFAULT_DOCK }; }
  });
  const [host, setHost] = useState(null);
  const [menu, setMenu] = useState(false);
  const drag = useRef(null);
  const gripRef = useRef(null);
  const menuRef = useRef(null);
  const navRef = useRef(null);
  const movedRef = useRef(false);
  const [preview, setPreview] = useState(null);
  const vertical = dock.edge === 'left' || dock.edge === 'right';
  const labels = arabic ? { move: 'تحريك شريط الأدوات', top: 'أعلى', bottom: 'أسفل', left: 'يسار', right: 'يمين', float: 'عائم', help: 'اسحب للتحريك، أو اضغط لاختيار المكان. الأسهم للتحريك وHome للإرجاع.' } : { move: 'Move toolbar', top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right', float: 'Floating', help: 'Drag to move, or click to choose a position. Arrow keys move; Home resets.' };
  function save(next) {
    setDock(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* A layout preference must never block writing. */ }
  }
  const bounds = useCallback(() => {
    const rect = readerRef.current.getBoundingClientRect();
    const nav = navRef.current.getBoundingClientRect();
    return { left: rect.left + 8, right: Math.min(rect.right, window.innerWidth) - 8, top: Math.max(rect.top, nav.bottom) + 8, bottom: Math.min(rect.bottom, window.innerHeight) - 8 };
  }, [readerRef]);
  useEffect(() => {
    const rail = railRef.current;
    const nav = rail.closest('.workspace-v2-toolbar');
    navRef.current = nav;
    setHost(nav);
    nav.dataset.toolDock = dock.edge;
    const place = () => {
      if (drag.current) return;
      if (dock.edge === 'top') {
        rail.style.removeProperty('left'); rail.style.removeProperty('top');
      } else {
        const box = bounds();
        const size = rail.getBoundingClientRect();
        const point = clampDock({ x: dock.edge === 'left' ? box.left : dock.edge === 'right' ? box.right - size.width : box.left + dock.x * Math.max(0, box.right - box.left - size.width), y: dock.edge === 'bottom' ? box.bottom - size.height : box.top + dock.y * Math.max(0, box.bottom - box.top - size.height) }, box, size);
        const origin = nav.getBoundingClientRect();
        rail.style.left = `${point.x - origin.left}px`;
        rail.style.top = `${point.y - origin.top}px`;
      }
    };
    place();
    const observer = new window.ResizeObserver(place);
    observer.observe(readerRef.current); observer.observe(rail); observer.observe(nav);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [dock, railRef, readerRef, bounds]);
  useEffect(() => {
    if (!menu) return undefined;
    const closeOutside = event => {
      if (!gripRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setMenu(false);
    };
    const close = () => setMenu(false);
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', closeOutside); window.removeEventListener('resize', close); };
  }, [menu]);
  function start(event) {
    if (event.button !== 0 || drag.current) return;
    const rect = railRef.current.getBoundingClientRect();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: event.clientX - rect.left, dy: event.clientY - rect.top, original: dock, active: false };
    movedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    if (!current.active) {
      current.active = true; movedRef.current = true; setMenu(false); onMove?.();
      // Retain the current orientation while dragging; snap changes it only on release.
      navRef.current.dataset.toolDock = 'dragging';
      railRef.current.dataset.dragging = 'true';
    }
    const rail = railRef.current;
    const origin = navRef.current.getBoundingClientRect();
    const box = bounds();
    const point = clampDock({ x: event.clientX - current.dx, y: event.clientY - current.dy }, box, rail.getBoundingClientRect());
    rail.style.left = `${point.x - origin.left}px`; rail.style.top = `${point.y - origin.top}px`;
    setPreview(snapDock({ x: event.clientX, y: event.clientY }, box));
  }
  function finish(event, cancel = false) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null; setPreview(null);
    delete railRef.current.dataset.dragging;
    if (current.active) {
      const box = bounds(); const rect = railRef.current.getBoundingClientRect();
      const next = cancel ? current.original : { edge: snapDock({ x: event.clientX, y: event.clientY }, box), x: (rect.left - box.left) / Math.max(1, box.right - box.left - rect.width), y: (rect.top - box.top) / Math.max(1, box.bottom - box.top - rect.height) };
      navRef.current.dataset.toolDock = next.edge;
      save(readDock(next));
    }
    if (gripRef.current.hasPointerCapture(event.pointerId)) gripRef.current.releasePointerCapture(event.pointerId);
  }
  function keyboard(event) {
    if (event.key === 'Escape') { if (drag.current) finish({ pointerId: drag.current.id }, true); setMenu(false); return; }
    if (event.key === 'Home') { event.preventDefault(); onMove?.(); save({ ...DEFAULT_DOCK }); return; }
    const step = { ArrowLeft: [-.05, 0], ArrowRight: [.05, 0], ArrowUp: [0, -.05], ArrowDown: [0, .05] }[event.key];
    if (step) { event.stopPropagation(); event.preventDefault(); onMove?.(); save(readDock({ edge: 'float', x: dock.x + step[0], y: dock.y + step[1] })); }
  }
  const grip = <button type="button" className={`workspace-dock-grip${dock.edge === 'top' ? ' is-attached' : ''}`} ref={gripRef} aria-label={labels.move} title={labels.help} aria-expanded={menu} onPointerDown={start} onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={(event) => finish(event, true)} onKeyDown={keyboard} onClick={() => { if (!movedRef.current) setMenu((value) => !value); movedRef.current = false; }}><GripVertical size={16} aria-hidden="true" /></button>;
  const gripBox = menu ? gripRef.current?.getBoundingClientRect() : null;
  return <div {...props} className={`workspace-v3-primary workspace-tool-dock${vertical ? ' is-vertical' : ''}`} ref={railRef} data-dock-edge={dock.edge}>
    {dock.edge === 'top' ? host && createPortal(grip, host) : grip}
    {children}
    {menu && createPortal(<div style={{ position: 'fixed', top: Math.max(8, Math.min(window.innerHeight - 248, gripBox?.bottom || 40)), left: Math.max(8, Math.min(window.innerWidth - 156, gripBox?.left || 8)), right: 'auto', bottom: 'auto' }} className="workspace-dock-menu" ref={menuRef} role="group" aria-label={labels.move}>{['top', 'bottom', 'left', 'right', 'float'].map((edge) => <button key={edge} type="button" onKeyDown={keyboard} aria-pressed={dock.edge === edge} onClick={() => { onMove?.(); save(readDock({ ...dock, edge })); setMenu(false); gripRef.current.focus(); }}>{labels[edge]}</button>)}</div>, readerRef.current)}
    {preview && preview !== 'float' && createPortal(<span className={`workspace-dock-preview is-${preview}`} aria-hidden="true" />, readerRef.current)}
  </div>;
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Boxes,
  ClipboardList,
  Compass,
  Layers,
  Plane,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import {
  GlobalSearchResult,
  SearchRecordLike,
  SearchResultKind,
  searchWorkspace,
} from '../../lib/global-search';

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
  aircraft: SearchRecordLike[];
  tasks: SearchRecordLike[];
  programs: SearchRecordLike[];
  planningItems: SearchRecordLike[];
  navigationItems: Array<{ key: string; label: string }>;
  settingsItems: Array<{ id: string; title: string; description?: string }>;
  onSelect: (result: GlobalSearchResult) => void;
}

const KIND_LABELS: Record<SearchResultKind, string> = {
  navigation: 'شاشة',
  settings: 'إعدادات',
  aircraft: 'طائرة',
  task: 'مهمة',
  program: 'برنامج',
  package: 'حزمة عمل',
  component: 'مكوّن',
};

function KindIcon({ kind }: { kind: SearchResultKind }) {
  switch (kind) {
    case 'aircraft':
      return <Plane size={16} />;
    case 'task':
      return <ClipboardList size={16} />;
    case 'program':
      return <BookOpen size={16} />;
    case 'package':
      return <Layers size={16} />;
    case 'component':
      return <Boxes size={16} />;
    case 'settings':
      return <Settings2 size={16} />;
    default:
      return <Compass size={16} />;
  }
}

export default function GlobalSearch({
  open,
  onClose,
  aircraft,
  tasks,
  programs,
  planningItems,
  navigationItems,
  settingsItems,
  onSelect,
}: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(timer);
  }, [open]);

  const results = useMemo(
    () =>
      searchWorkspace({
        query,
        aircraft,
        tasks,
        programs,
        planningItems,
        navigationItems,
        settingsItems,
        limit: 16,
      }),
    [query, aircraft, tasks, programs, planningItems, navigationItems, settingsItems]
  );

  if (!open) return null;

  const safeIndex = results.length ? Math.min(activeIndex, results.length - 1) : 0;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (results.length ? (prev + 1) % results.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        results.length ? (prev - 1 + results.length) % results.length : 0
      );
      return;
    }
    if (e.key === 'Enter' && results[safeIndex]) {
      e.preventDefault();
      onSelect(results[safeIndex]);
    }
  }

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal global-search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="البحث الشامل"
        onKeyDown={handleKeyDown}
      >
        <div className="global-search-bar">
          <Search size={18} />
          <input
            ref={inputRef}
            type="search"
            aria-label="ابحث في الطائرات والمهام وحزم العمل والشاشات"
            placeholder="ابحث عن طائرة، مهمة، مرجع MPD، حزمة عمل، مكوّن أو شاشة…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
          />
          <kbd className="kbd-hint">Esc</kbd>
          <button type="button" className="iconbutton" onClick={onClose} aria-label="إغلاق البحث">
            <X size={18} />
          </button>
        </div>

        <div className="global-search-results" role="listbox" aria-label="نتائج البحث">
          {results.length ? (
            results.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={idx === safeIndex}
                className={`global-search-item${idx === safeIndex ? ' active' : ''}`}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <span className="global-search-icon">
                  <KindIcon kind={item.kind} />
                </span>
                <span className="global-search-text">
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <span className="badge">{KIND_LABELS[item.kind]}</span>
              </button>
            ))
          ) : (
            <div className="empty">لا توجد نتائج مطابقة لـ «{query}». جرّب تسجيل الطائرة أو مرجع المهمة.</div>
          )}
        </div>

        <div className="global-search-foot">
          <span>اختصار الفتح: Ctrl+K</span>
          <span>التنقل بالأسهم والفتح بـ Enter</span>
        </div>
      </section>
    </div>
  );
}

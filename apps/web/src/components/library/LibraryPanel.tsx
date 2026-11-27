import { useMemo, useState } from 'react';
import {
  PROVIDERS,
  searchCatalog,
  type CatalogEntry,
  type Provider,
} from '@mavisdraw/export/library';
import { useUIStore } from '../../stores/uiStore';
import { insertFromLibrary } from '../../editor/insertFromLibrary';
import { LibraryIcon } from './LibraryIcon';

const TABS: Array<Provider | 'all'> = ['all', 'generic', 'aws', 'gcp', 'azure', 'kubernetes'];

/** The shape each entry becomes, as a small outline beside its icon. */
function ShapeHint({ shape }: { shape: CatalogEntry['shape'] }) {
  if (shape === 'rectangle') return null;
  return (
    <span className="text-[10px] uppercase tracking-wide text-gray-400">
      {shape === 'cylinder' ? 'datastore' : 'queue'}
    </span>
  );
}

/**
 * Architecture shapes and cloud services: search, pick a provider, click to
 * put one on the canvas (with its icon and label).
 */
export default function LibraryPanel() {
  const setShowLibrary = useUIStore((s) => s.setShowLibrary);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Provider | 'all'>('all');

  const entries = useMemo(() => {
    const found = searchCatalog(query);
    return tab === 'all' ? found : found.filter((e) => e.provider === tab);
  }, [query, tab]);

  return (
    <section
      data-testid="library-panel"
      aria-label="Shape library"
      className="flex max-h-[70vh] w-72 flex-col rounded-lg border border-gray-200 bg-white shadow-lg"
    >
      <header className="flex items-center gap-2 border-b border-gray-100 p-2">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowLibrary(false);
            if (e.key === 'Enter' && entries[0]) insertFromLibrary(entries[0]);
          }}
          placeholder="Search: Postgres, S3, Kafka, Pod…"
          aria-label="Search the library"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowLibrary(false)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close the library"
        >
          ×
        </button>
      </header>
      <nav
        className="flex flex-wrap gap-1 border-b border-gray-100 px-2 py-1.5"
        aria-label="Providers"
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`rounded px-2 py-0.5 text-xs ${
              tab === t ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {t === 'all' ? 'All' : PROVIDERS[t].label}
          </button>
        ))}
      </nav>
      <ul className="flex-1 overflow-y-auto p-1" role="list">
        {entries.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-gray-400">Nothing called that</li>
        )}
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              data-testid="library-item"
              data-entry={entry.id}
              onClick={() => insertFromLibrary(entry)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              title={`Add ${entry.name}${entry.provider === 'generic' ? '' : ` (${PROVIDERS[entry.provider].label})`}`}
            >
              <LibraryIcon id={entry.icon} color={PROVIDERS[entry.provider].color} />
              <span className="min-w-0 flex-1 truncate text-gray-800">{entry.name}</span>
              <ShapeHint shape={entry.shape} />
              {tab === 'all' && entry.provider !== 'generic' && (
                <span className="text-[10px] text-gray-400">{PROVIDERS[entry.provider].label}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useEffect, useState } from 'react';
import {
  Package, Plus, Trash2, ExternalLink, Tag, Filter,
  ChevronDown, ChevronRight, X, Save, Search, Layers,
} from 'lucide-react';
import clsx from 'clsx';
import type { TrackedItem, CollectionInfo } from '../types';

const STATUSES = ['new', 'saved', 'applied', 'rejected', 'archived'] as const;

function statusColor(status: string): string {
  switch (status) {
    case 'new': return 'bg-accent/10 text-accent';
    case 'saved': return 'bg-blue-500/10 text-blue-400';
    case 'applied': return 'bg-purple-500/10 text-purple-400';
    case 'rejected': return 'bg-error/10 text-error';
    case 'archived': return 'bg-muted/10 text-muted';
    default: return 'bg-muted/10 text-muted';
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface ItemDetailProps {
  item: TrackedItem;
  onClose: () => void;
  onUpdate: (item: TrackedItem) => void;
  onDelete: (id: string) => void;
}

function ItemDetail({ item, onClose, onUpdate, onDelete }: ItemDetailProps) {
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.notes ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes }),
      });
      onUpdate({ ...item, status, notes, updatedAt: Date.now() });
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async () => {
    await fetch(`/api/items/${item.id}`, { method: 'DELETE' });
    onDelete(item.id);
  };

  return (
    <div className="bg-surface rounded-lg border border-border p-4 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-primary truncate">{item.title}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted">
            <span>{item.collection}</span>
            <span>·</span>
            <span>Created {timeAgo(item.createdAt)}</span>
            {item.matchScore !== undefined && (
              <>
                <span>·</span>
                <span className="text-accent">{item.matchScore}% match</span>
              </>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-muted hover:text-primary p-1"><X size={16} /></button>
      </div>

      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-accent hover:opacity-80 mb-3"
        >
          <ExternalLink size={12} /> {item.url}
        </a>
      )}

      {/* Status selector */}
      <div className="mb-3">
        <label className="block text-xs text-muted mb-1">Status</label>
        <div className="flex gap-1.5 flex-wrap">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={clsx(
                'px-2 py-1 rounded text-xs font-medium capitalize transition-colors',
                status === s ? statusColor(s) : 'bg-surface-elevated text-muted hover:text-primary'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Fields */}
      {Object.keys(item.fields).length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-muted mb-1.5">Fields</p>
          <div className="bg-surface-elevated rounded-lg border border-border p-2 space-y-1">
            {Object.entries(item.fields).map(([k, v]) => (
              <div key={k} className="flex gap-2 text-xs">
                <span className="text-muted w-28 flex-shrink-0 truncate">{k}</span>
                <span className="text-secondary break-words min-w-0">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {item.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {item.tags.map(t => (
            <span key={t} className="px-1.5 py-0.5 bg-accent/10 text-accent text-[10px] rounded">
              <Tag size={9} className="inline mr-0.5" />{t}
            </span>
          ))}
        </div>
      )}

      {/* Notes */}
      <div className="mb-3">
        <label className="block text-xs text-muted mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Add notes..."
          className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50 resize-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          <Save size={14} /> {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={handleDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-error/30 text-error rounded-lg text-sm hover:bg-error/10 transition-colors"
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  );
}

interface NewItemFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

function NewItemForm({ onCreated, onCancel }: NewItemFormProps) {
  const [title, setTitle] = useState('');
  const [collection, setCollection] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim() || !collection.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          collection: collection.trim(),
          url: url.trim(),
          notes: notes.trim() || undefined,
        }),
      });
      onCreated();
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <div className="bg-surface rounded-lg border border-border p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-primary">New Item</p>
        <button onClick={onCancel} className="text-muted hover:text-primary"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">Title</label>
          <input
            type="text" value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Item title"
            className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Collection</label>
          <input
            type="text" value={collection} onChange={e => setCollection(e.target.value)}
            placeholder="e.g. jobs, apartments"
            className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">URL</label>
        <input
          type="text" value={url} onChange={e => setUrl(e.target.value)}
          placeholder="https://..."
          className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Notes</label>
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)}
          rows={2} placeholder="Optional notes..."
          className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50 resize-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={saving || !title.trim() || !collection.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          <Plus size={14} /> {saving ? 'Creating...' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 border border-border rounded-lg text-sm text-secondary hover:text-primary transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ItemsView() {
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [filterCollection, setFilterCollection] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showCollections, setShowCollections] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCollection) params.set('collection', filterCollection);
      if (filterStatus) params.set('status', filterStatus);
      if (searchQuery) params.set('query', searchQuery);
      const [itemsRes, colRes] = await Promise.all([
        fetch(`/api/items?${params}`).then(r => r.json()),
        fetch('/api/items/collections').then(r => r.json()),
      ]);
      setItems(Array.isArray(itemsRes) ? itemsRes : []);
      setCollections(Array.isArray(colRes) ? colRes : []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [filterCollection, filterStatus, searchQuery]);

  const handleUpdate = (updated: TrackedItem) => {
    setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
  };

  const handleDelete = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    setSelectedItem(null);
    loadData();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-accent" />
          <h2 className="text-lg font-semibold text-primary">Tracked Items</h2>
          <span className="text-xs text-muted">({items.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCollections(!showCollections)}
            className={clsx(
              'flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors',
              showCollections ? 'bg-accent/10 text-accent' : 'text-muted hover:text-primary hover:bg-surface-elevated'
            )}
          >
            <Layers size={14} /> Collections
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors',
              showFilters ? 'bg-accent/10 text-accent' : 'text-muted hover:text-primary hover:bg-surface-elevated'
            )}
          >
            <Filter size={14} /> Filter
          </button>
          <button
            onClick={() => setShowNewForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={14} /> Add Item
          </button>
        </div>
      </div>

      {/* Collections panel */}
      {showCollections && (
        <div className="bg-surface rounded-lg border border-border p-4 mb-4">
          <h3 className="text-sm font-medium text-primary mb-2">Collections</h3>
          {collections.length === 0 ? (
            <p className="text-xs text-muted">No collections yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilterCollection('')}
                className={clsx(
                  'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                  !filterCollection ? 'bg-accent/10 text-accent' : 'bg-surface-elevated text-muted hover:text-primary'
                )}
              >
                All ({items.length})
              </button>
              {collections.map(c => (
                <button
                  key={c.name}
                  onClick={() => setFilterCollection(filterCollection === c.name ? '' : c.name)}
                  className={clsx(
                    'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                    filterCollection === c.name ? 'bg-accent/10 text-accent' : 'bg-surface-elevated text-muted hover:text-primary'
                  )}
                >
                  {c.name} ({c.count})
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-surface rounded-lg border border-border p-4 mb-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search items..."
                  className="w-full bg-surface-elevated border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Status</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary focus:outline-none focus:border-accent/50"
              >
                <option value="">All</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {(filterCollection || filterStatus || searchQuery) && (
            <button
              onClick={() => { setFilterCollection(''); setFilterStatus(''); setSearchQuery(''); }}
              className="text-xs text-accent hover:opacity-80"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* New item form */}
      {showNewForm && (
        <NewItemForm
          onCreated={() => { setShowNewForm(false); loadData(); }}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {/* Items list */}
      {loading ? (
        <div className="text-muted text-sm text-center py-8">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <Package size={40} className="mx-auto text-muted/30 mb-3" />
          <p className="text-muted text-sm">No tracked items yet.</p>
          <p className="text-muted text-xs mt-1">Items will appear here when the agent saves them during tasks, or add one manually.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map(item => (
            <div key={item.id}>
              <button
                onClick={() => setSelectedItem(selectedItem === item.id ? null : item.id)}
                className={clsx(
                  'w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center gap-3',
                  selectedItem === item.id ? 'bg-surface-elevated' : 'hover:bg-surface-elevated/50'
                )}
              >
                {selectedItem === item.id ? <ChevronDown size={14} className="text-muted flex-shrink-0" /> : <ChevronRight size={14} className="text-muted flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-primary truncate">{item.title}</span>
                    <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium capitalize', statusColor(item.status))}>{item.status}</span>
                    {item.matchScore !== undefined && (
                      <span className="text-[10px] text-accent">{item.matchScore}%</span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-0.5 flex items-center gap-2">
                    <span>{item.collection}</span>
                    {item.tags.length > 0 && <span>· {item.tags.join(', ')}</span>}
                    <span>· {timeAgo(item.updatedAt)}</span>
                  </div>
                </div>
              </button>
              {selectedItem === item.id && (
                <div className="ml-7 mt-1">
                  <ItemDetail
                    item={item}
                    onClose={() => setSelectedItem(null)}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

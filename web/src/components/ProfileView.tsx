import { useEffect, useRef, useState } from 'react';
import {
  User, FileText, Brain, Plus, Trash2, Upload, Save, X, Check,
} from 'lucide-react';
import type { UserProfile, UserDocument, MemoryEntry } from '../types';

// ─── Profile Section ────────────────────────────────────────────────────────────────────────────

interface ProfileFormProps {
  initialProfile: UserProfile;
}

function ProfileForm({ initialProfile }: ProfileFormProps) {
  const [form, setForm] = useState<UserProfile>({ ...initialProfile });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newAttrKey, setNewAttrKey] = useState('');
  const [newAttrVal, setNewAttrVal] = useState('');

  const handleChange = (field: keyof UserProfile, value: string) => {
    setForm(f => ({ ...f, [field]: value }));
  };

  const handleAttrChange = (key: string, value: string) => {
    setForm(f => ({ ...f, attributes: { ...(f.attributes ?? {}), [key]: value } }));
  };

  const handleAttrRemove = (key: string) => {
    setForm(f => {
      const attrs = { ...(f.attributes ?? {}) };
      delete attrs[key];
      return { ...f, attributes: attrs };
    });
  };

  const handleAttrAdd = () => {
    const k = newAttrKey.trim();
    const v = newAttrVal.trim();
    if (!k) return;
    setForm(f => ({ ...f, attributes: { ...(f.attributes ?? {}), [k]: v } }));
    setNewAttrKey('');
    setNewAttrVal('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <User size={16} className="text-accent" />
        <h2 className="text-lg font-semibold text-primary">Profile</h2>
      </div>

      <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
        {/* Two-column row for Name + Email */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">Name</label>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={e => handleChange('name', e.target.value)}
              placeholder="Your name"
              className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Email</label>
            <input
              type="email"
              value={form.email ?? ''}
              onChange={e => handleChange('email', e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
            />
          </div>
        </div>

        {/* Phone */}
        <div>
          <label className="block text-xs text-muted mb-1">Phone</label>
          <input
            type="text"
            value={form.phone ?? ''}
            onChange={e => handleChange('phone', e.target.value)}
            placeholder="+1 555 000 0000"
            className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
        </div>

        {/* Location */}
        <div>
          <label className="block text-xs text-muted mb-1">Location</label>
          <input
            type="text"
            value={form.location ?? ''}
            onChange={e => handleChange('location', e.target.value)}
            placeholder="City, Country"
            className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
        </div>

        {/* Summary */}
        <div>
          <label className="block text-xs text-muted mb-1">Summary</label>
          <textarea
            value={form.summary ?? ''}
            onChange={e => handleChange('summary', e.target.value)}
            rows={3}
            placeholder="Short bio or context for the agent…"
            className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50 resize-none"
          />
        </div>

        {/* Custom attributes */}
        {Object.keys(form.attributes ?? {}).length > 0 && (
          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-xs text-muted">Custom Attributes</p>
            {Object.entries(form.attributes ?? {}).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-xs text-muted w-32 flex-shrink-0 truncate">{k}</span>
                <input
                  type="text"
                  value={String(v)}
                  onChange={e => handleAttrChange(k, e.target.value)}
                  className="flex-1 bg-surface-elevated border border-border rounded-lg px-2 py-1 text-sm text-primary focus:outline-none focus:border-accent/50"
                />
                <button
                  onClick={() => handleAttrRemove(k)}
                  className="text-error hover:bg-error/10 rounded p-1 transition-colors"
                  title="Remove attribute"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new attribute */}
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted mb-2">Add Attribute</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newAttrKey}
              onChange={e => setNewAttrKey(e.target.value)}
              placeholder="key"
              className="w-28 bg-surface-elevated border border-border rounded-lg px-2 py-1 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
            />
            <input
              type="text"
              value={newAttrVal}
              onChange={e => setNewAttrVal(e.target.value)}
              placeholder="value"
              onKeyDown={e => e.key === 'Enter' && handleAttrAdd()}
              className="flex-1 bg-surface-elevated border border-border rounded-lg px-2 py-1 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
            />
            <button
              onClick={handleAttrAdd}
              disabled={!newAttrKey.trim()}
              className="flex items-center gap-1 px-2 py-1 border border-border rounded-lg text-xs text-secondary hover:text-primary hover:border-accent/40 transition-colors disabled:opacity-40"
            >
              <Plus size={12} /> Add
            </button>
          </div>
        </div>

        {/* Save button */}
        <div className="pt-2 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save Profile'}
          </button>
          {saved && <span className="text-xs text-accent">Profile updated</span>}
        </div>
      </div>
    </section>
  );
}

// ─── Documents Section ──────────────────────────────────────────────────────────────────

const DOC_TYPES = ['resume', 'notes', 'requirements', 'portfolio', 'reference'];

interface DocumentsSectionProps {
  docs: UserDocument[];
  onRefresh: () => void;
}

function DocumentsSection({ docs, onRefresh }: DocumentsSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('notes');
  const [docContent, setDocContent] = useState('');
  const [importing, setImporting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setDocContent(ev.target?.result as string ?? '');
    reader.readAsText(file);
    if (!docName) setDocName(file.name.replace(/\.[^.]+$/, ''));
  };

  const handleImport = async () => {
    if (!docName.trim() || !docContent.trim()) return;
    setImporting(true);
    try {
      await fetch('/api/memory/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: docName.trim(), type: docType, content: docContent }),
      });
      setDocName('');
      setDocType('notes');
      setDocContent('');
      setShowForm(false);
      onRefresh();
    } catch { /* ignore */ }
    setImporting(false);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/memory/documents/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch { /* ignore */ }
    setDeletingId(null);
  };

  const formatSize = (content: string) => {
    const bytes = new TextEncoder().encode(content).length;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-accent" />
          <h2 className="text-lg font-semibold text-primary">Documents</h2>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Upload size={14} /> Import Document
          </button>
        )}
      </div>

      {/* Import form */}
      {showForm && (
        <div className="bg-surface rounded-lg border border-border p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium text-primary">Import Document</p>
            <button onClick={() => setShowForm(false)} className="text-muted hover:text-primary transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Document Name</label>
              <input
                type="text"
                value={docName}
                onChange={e => setDocName(e.target.value)}
                placeholder="My Resume"
                className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Type</label>
              <select
                value={docType}
                onChange={e => setDocType(e.target.value)}
                className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary focus:outline-none focus:border-accent/50"
              >
                {DOC_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted">Content</label>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-xs text-accent hover:opacity-80 transition-opacity"
              >
                <Upload size={12} /> Upload .txt file
              </button>
              <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json" className="hidden" onChange={handleFileUpload} />
            </div>
            <textarea
              value={docContent}
              onChange={e => setDocContent(e.target.value)}
              rows={8}
              placeholder="Paste document content here…"
              className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50 resize-y font-mono"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleImport}
              disabled={importing || !docName.trim() || !docContent.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              <Plus size={14} /> {importing ? 'Importing…' : 'Import'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 border border-border rounded-lg text-sm text-secondary hover:text-primary hover:border-accent/40 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Document list */}
      {docs.length === 0 ? (
        <p className="text-muted text-sm">No documents imported yet.</p>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div key={doc.id} className="bg-surface rounded-lg border border-border p-3 flex items-center gap-3">
              <FileText size={16} className="text-muted flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-primary truncate">{doc.name}</p>
                <p className="text-xs text-muted">
                  {doc.type} · {formatSize(doc.content)} · {new Date(doc.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                disabled={deletingId === doc.id}
                className="text-error hover:bg-error/10 rounded p-1.5 transition-colors flex-shrink-0 disabled:opacity-40"
                title="Delete document"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Notes & Memory Section ─────────────────────────────────────────────────────────────────

const NOTE_CATEGORIES = ['general', 'preferences', 'context'];

interface NotesSectionProps {
  memory: Record<string, MemoryEntry[]>;
  onRefresh: () => void;
}

function NotesSection({ memory, onRefresh }: NotesSectionProps) {
  const [noteCategory, setNoteCategory] = useState('general');
  const [noteKey, setNoteKey] = useState('');
  const [noteValue, setNoteValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const handleSave = async () => {
    if (!noteKey.trim() || !noteValue.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/memory/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: noteKey.trim(), value: noteValue.trim(), category: noteCategory }),
      });
      setNoteKey('');
      setNoteValue('');
      onRefresh();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (key: string) => {
    setDeletingKey(key);
    try {
      await fetch(`/api/memory/notes/${encodeURIComponent(key)}`, { method: 'DELETE' });
      onRefresh();
    } catch { /* ignore */ }
    setDeletingKey(null);
  };

  const allFacts = Object.entries(memory).flatMap(([cat, facts]) =>
    facts.map(f => ({ ...f, category: f.category ?? cat }))
  );
  const byCategory: Record<string, MemoryEntry[]> = {};
  for (const fact of allFacts) {
    const cat = fact.category ?? 'general';
    (byCategory[cat] ??= []).push(fact);
  }

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Brain size={16} className="text-accent" />
        <h2 className="text-lg font-semibold text-primary">Notes &amp; Memory</h2>
      </div>

      {/* Add Note form */}
      <div className="bg-surface rounded-lg border border-border p-4 mb-4 space-y-3">
        <p className="text-sm font-medium text-primary">Add Note</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">Category</label>
            <select
              value={noteCategory}
              onChange={e => setNoteCategory(e.target.value)}
              className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary focus:outline-none focus:border-accent/50"
            >
              {NOTE_CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Key</label>
            <input
              type="text"
              value={noteKey}
              onChange={e => setNoteKey(e.target.value)}
              placeholder="e.g. preferred_language"
              className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Value</label>
          <textarea
            value={noteValue}
            onChange={e => setNoteValue(e.target.value)}
            rows={3}
            placeholder="The note content…"
            className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50 resize-none"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !noteKey.trim() || !noteValue.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          <Save size={14} /> {saving ? 'Saving…' : 'Save Note'}
        </button>
      </div>

      {/* Facts by category */}
      {Object.keys(byCategory).length === 0 ? (
        <p className="text-muted text-sm">No memory notes yet.</p>
      ) : (
        Object.entries(byCategory).map(([cat, facts]) => (
          <div key={cat} className="mb-4">
            <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">{cat}</h3>
            <div className="space-y-2">
              {facts.map(fact => (
                <div key={fact.key} className="bg-surface rounded-lg border border-border p-3 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted mb-0.5">{fact.key}</p>
                    <p className="text-sm text-secondary break-words">{String(fact.value)}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(fact.key)}
                    disabled={deletingKey === fact.key}
                    className="text-error hover:bg-error/10 rounded p-1 transition-colors flex-shrink-0 mt-0.5 disabled:opacity-40"
                    title="Delete note"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

// ─── Main ProfileView ────────────────────────────────────────────────────────────────────────────

export function ProfileView() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [docs, setDocs] = useState<UserDocument[]>([]);
  const [memory, setMemory] = useState<Record<string, MemoryEntry[]>>({});
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/profile').then(r => r.json()),
      fetch('/api/memory/documents').then(r => r.json()),
      fetch('/api/memory').then(r => r.json()),
    ])
      .then(([p, d, m]) => {
        setProfile(p ?? {});
        setDocs(Array.isArray(d) ? d : []);
        setMemory(m ?? {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  const refreshDocs = () => {
    fetch('/api/memory/documents')
      .then(r => r.json())
      .then(d => setDocs(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  const refreshMemory = () => {
    fetch('/api/memory')
      .then(r => r.json())
      .then(m => setMemory(m ?? {}))
      .catch(() => {});
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted text-sm">Loading…</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
      <ProfileForm initialProfile={profile ?? {}} />
      <div className="border-t border-border mb-8" />
      <DocumentsSection docs={docs} onRefresh={refreshDocs} />
      <div className="border-t border-border mb-8" />
      <NotesSection memory={memory} onRefresh={refreshMemory} />
    </div>
  );
}

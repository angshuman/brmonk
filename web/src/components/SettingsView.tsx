import { useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, Code, Puzzle, FileText, Tag,
} from 'lucide-react';
import clsx from 'clsx';
import type { SkillInfo } from '../types';

export function SettingsView() {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(setConfig).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async (key: string, value: string) => {
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      setConfig(c => ({ ...c, [key]: value }));
    } catch { /* ignore */ }
    setSaving(false);
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted text-sm">Loading...</div>;
  }

  const editableKeys = ['provider', 'model', 'headless', 'maxSteps', 'browserBackend', 'verbose'];

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-primary mb-4">Settings</h2>

      <div className="space-y-3">
        {editableKeys.map(key => {
          const val = config[key];
          return (
            <div key={key} className="bg-surface rounded-lg border border-border p-3 flex items-center gap-3">
              <label className="text-sm text-muted w-40 flex-shrink-0">{key}</label>
              <input
                type="text"
                defaultValue={val != null ? String(val) : ''}
                onBlur={(e) => {
                  const newVal = e.target.value;
                  if (newVal !== String(val ?? '')) {
                    handleSave(key, newVal);
                  }
                }}
                className="flex-1 bg-surface-elevated border border-border rounded px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
          );
        })}
      </div>

      {saving && <p className="text-xs text-muted mt-2">Saving...</p>}

      <h3 className="text-md font-semibold text-primary mt-8 mb-3">All Configuration</h3>
      <pre className="bg-surface rounded-lg border border-border p-4 text-xs text-secondary overflow-x-auto">
        {JSON.stringify(config, null, 2)}
      </pre>
    </div>
  );
}

// ─── Skill Detail Panel ────────────────────────────────────────────────────────────────

function SkillDetail({ skill, onClose }: { skill: SkillInfo; onClose: () => void }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4 mt-2 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-primary">{skill.name}</h3>
            <span className="text-[10px] text-muted">v{skill.version}</span>
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-surface-elevated text-muted">{skill.type}</span>
          </div>
          <p className="text-xs text-secondary mt-1">{skill.description}</p>
          {skill.author && <p className="text-xs text-muted mt-0.5">Author: {skill.author}</p>}
          {skill.directory && <p className="text-xs text-muted mt-0.5">Dir: {skill.directory}</p>}
        </div>
        <button onClick={onClose} className="text-muted hover:text-primary text-xs">close</button>
      </div>

      {/* Tags */}
      {skill.tags && skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.map(t => (
            <span key={t} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-surface-elevated text-muted text-[10px] rounded">
              <Tag size={9} />{t}
            </span>
          ))}
        </div>
      )}

      {/* Tools */}
      <div>
        <p className="text-xs text-muted font-medium mb-1.5 flex items-center gap-1">
          <Code size={12} /> Tools ({skill.tools.length})
        </p>
        <div className="space-y-1.5">
          {skill.tools.map(t => (
            <div key={t.name} className="bg-surface-elevated rounded px-2.5 py-1.5">
              <span className="text-xs font-medium text-accent">{t.name}</span>
              <p className="text-xs text-muted mt-0.5">{t.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      {skill.actions && skill.actions.length > 0 && (
        <div>
          <p className="text-xs text-muted font-medium mb-1.5">Actions</p>
          {skill.actions.map(a => (
            <div key={a.name} className="bg-surface-elevated rounded px-2.5 py-1.5 mb-1">
              <span className="text-xs font-medium text-primary">{a.name}</span>
              <p className="text-xs text-muted mt-0.5">Steps: {a.steps.join(' → ')}</p>
            </div>
          ))}
        </div>
      )}

      {/* Environment */}
      {skill.env && (skill.env.required?.length || skill.env.optional?.length) && (
        <div>
          <p className="text-xs text-muted font-medium mb-1">Environment</p>
          {skill.env.required?.length ? (
            <p className="text-xs text-secondary">Required: {skill.env.required.join(', ')}</p>
          ) : null}
          {skill.env.optional?.length ? (
            <p className="text-xs text-secondary">Optional: {skill.env.optional.join(', ')}</p>
          ) : null}
        </div>
      )}

      {/* Instructions */}
      {skill.instructions && (
        <div>
          <p className="text-xs text-muted font-medium mb-1 flex items-center gap-1">
            <FileText size={12} /> Instructions
          </p>
          <pre className="bg-surface-elevated rounded-lg border border-border p-3 text-xs text-secondary whitespace-pre-wrap max-h-60 overflow-y-auto">
            {skill.instructions}
          </pre>
        </div>
      )}

      {/* System Prompt (builtin) */}
      {skill.systemPrompt && (
        <div>
          <p className="text-xs text-muted font-medium mb-1">System Prompt</p>
          <pre className="bg-surface-elevated rounded-lg border border-border p-3 text-xs text-secondary whitespace-pre-wrap max-h-60 overflow-y-auto">
            {skill.systemPrompt}
          </pre>
        </div>
      )}
    </div>
  );
}

export function SkillsView() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [detailedSkill, setDetailedSkill] = useState<SkillInfo | null>(null);

  useEffect(() => {
    fetch('/api/skills').then(r => r.json()).then(setSkills).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleExpand = async (name: string) => {
    if (expandedSkill === name) {
      setExpandedSkill(null);
      setDetailedSkill(null);
      return;
    }
    setExpandedSkill(name);
    // Fetch detailed info
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        setDetailedSkill(data);
      }
    } catch { /* ignore */ }
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted text-sm">Loading...</div>;
  }

  const builtinSkills = skills.filter(s => s.type === 'builtin');
  const userSkills = skills.filter(s => s.type === 'user-defined');

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
      <div className="flex items-center gap-2 mb-4">
        <Puzzle size={16} className="text-accent" />
        <h2 className="text-lg font-semibold text-primary">Skills</h2>
        <span className="text-xs text-muted">({skills.length} total)</span>
      </div>

      {skills.length === 0 ? (
        <p className="text-muted text-sm">No skills loaded.</p>
      ) : (
        <>
          {builtinSkills.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Built-in ({builtinSkills.length})</p>
              <div className="space-y-1">
                {builtinSkills.map(s => (
                  <div key={s.name}>
                    <button
                      onClick={() => handleExpand(s.name)}
                      className={clsx(
                        'w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center gap-2',
                        expandedSkill === s.name ? 'bg-surface-elevated' : 'hover:bg-surface-elevated/50'
                      )}
                    >
                      {expandedSkill === s.name ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-primary">{s.name}</span>
                          <span className="text-[10px] text-muted">v{s.version}</span>
                        </div>
                        <p className="text-xs text-secondary truncate">{s.description}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {s.tools.slice(0, 3).map(t => (
                          <span key={t.name} className="px-1.5 py-0.5 bg-accent/10 text-accent text-[10px] rounded">{t.name}</span>
                        ))}
                        {s.tools.length > 3 && <span className="text-[10px] text-muted">+{s.tools.length - 3}</span>}
                      </div>
                    </button>
                    {expandedSkill === s.name && detailedSkill && (
                      <div className="ml-6">
                        <SkillDetail skill={detailedSkill} onClose={() => { setExpandedSkill(null); setDetailedSkill(null); }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {userSkills.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">User-defined ({userSkills.length})</p>
              <div className="space-y-1">
                {userSkills.map(s => (
                  <div key={s.name}>
                    <button
                      onClick={() => handleExpand(s.name)}
                      className={clsx(
                        'w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center gap-2',
                        expandedSkill === s.name ? 'bg-surface-elevated' : 'hover:bg-surface-elevated/50'
                      )}
                    >
                      {expandedSkill === s.name ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-primary">{s.name}</span>
                          <span className="text-[10px] text-muted">v{s.version}</span>
                          {s.tags && s.tags.map(t => (
                            <span key={t} className="px-1 py-0.5 bg-surface-elevated text-muted text-[9px] rounded">{t}</span>
                          ))}
                        </div>
                        <p className="text-xs text-secondary truncate">{s.description}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {s.tools.slice(0, 3).map(t => (
                          <span key={t.name} className="px-1.5 py-0.5 bg-accent/10 text-accent text-[10px] rounded">{t.name}</span>
                        ))}
                        {s.tools.length > 3 && <span className="text-[10px] text-muted">+{s.tools.length - 3}</span>}
                      </div>
                    </button>
                    {expandedSkill === s.name && detailedSkill && (
                      <div className="ml-6">
                        <SkillDetail skill={detailedSkill} onClose={() => { setExpandedSkill(null); setDetailedSkill(null); }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-8 text-xs text-muted">
        <p>Skills extend the agent with specialized tools and workflows.</p>
        <p className="mt-1">Use <code className="px-1 py-0.5 bg-surface-elevated rounded">brmonk skills init &lt;name&gt;</code> to create a new skill, or <code className="px-1 py-0.5 bg-surface-elevated rounded">brmonk skills install &lt;path&gt;</code> to install one.</p>
      </div>
    </div>
  );
}

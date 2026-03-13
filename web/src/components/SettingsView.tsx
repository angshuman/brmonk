import { useEffect, useState } from 'react';
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

export function SkillsView() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/skills').then(r => r.json()).then(setSkills).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted text-sm">Loading...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-primary mb-4">Skills</h2>

      {skills.length === 0 ? (
        <p className="text-muted text-sm">No skills loaded.</p>
      ) : (
        <div className="space-y-3">
          {skills.map(s => (
            <div key={s.name} className="bg-surface rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-medium text-primary">{s.name}</h3>
                <span className="text-[11px] text-muted">v{s.version}</span>
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-surface-elevated text-muted">{s.type}</span>
              </div>
              <p className="text-xs text-secondary mb-2">{s.description}</p>
              <div className="flex flex-wrap gap-1">
                {s.tools.map(t => (
                  <span key={t} className="px-1.5 py-0.5 bg-accent/10 text-accent text-[11px] rounded">{t}</span>
                ))}
              </div>
              {s.tags && s.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {s.tags.map(t => (
                    <span key={t} className="px-1.5 py-0.5 bg-surface-elevated text-muted text-[10px] rounded">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

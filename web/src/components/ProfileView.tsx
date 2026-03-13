import { useEffect, useState } from 'react';
import type { UserProfile } from '../types';

export function ProfileView() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [memory, setMemory] = useState<Record<string, unknown[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/profile').then(r => r.json()),
      fetch('/api/memory').then(r => r.json()),
    ]).then(([p, m]) => {
      setProfile(p);
      setMemory(m);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted text-sm">Loading...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-primary mb-4">Profile</h2>

      {profile && Object.keys(profile).length > 0 ? (
        <div className="bg-surface rounded-lg border border-border p-4 mb-6">
          {profile.name && <p className="text-sm"><span className="text-muted">Name:</span> {profile.name}</p>}
          {profile.email && <p className="text-sm mt-1"><span className="text-muted">Email:</span> {profile.email}</p>}
          {profile.phone && <p className="text-sm mt-1"><span className="text-muted">Phone:</span> {profile.phone}</p>}
          {profile.location && <p className="text-sm mt-1"><span className="text-muted">Location:</span> {profile.location}</p>}
          {profile.summary && <p className="text-sm mt-2 text-secondary">{profile.summary}</p>}
          {profile.attributes && Object.keys(profile.attributes).length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              {Object.entries(profile.attributes).map(([k, v]) => (
                <p key={k} className="text-sm"><span className="text-muted">{k}:</span> {JSON.stringify(v)}</p>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-muted text-sm mb-6">No profile set. Use <code className="text-accent">brmonk profile set</code> to create one.</p>
      )}

      <h2 className="text-lg font-semibold text-primary mb-4">Memory</h2>
      {Object.entries(memory).map(([category, facts]) => (
        <div key={category} className="mb-4">
          <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-2">{category}</h3>
          {(facts as Array<{ id: string; content: string }>).length > 0 ? (
            <div className="space-y-2">
              {(facts as Array<{ id: string; content: string }>).map(f => (
                <div key={f.id} className="bg-surface rounded-lg border border-border p-3 text-sm text-secondary">
                  {f.content}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-xs">No facts in this category.</p>
          )}
        </div>
      ))}
    </div>
  );
}

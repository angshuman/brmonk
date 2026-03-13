import { useEffect, useState } from 'react';
import { useAppStore } from '../hooks/useSession';
import { StatusBar } from './StatusBar';
import { ThoughtChain } from './ThoughtChain';
import { ChatInput } from './ChatInput';
import {
  Zap, CheckCircle, XCircle, AlertTriangle, Wrench, Globe, Clock,
  ListOrdered, ChevronDown, ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import type { StoredSession } from '../types';

function StoredSessionView({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTools, setShowTools] = useState(false);
  const [showUrls, setShowUrls] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/sessions/${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setSession(data))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted text-sm">Loading session...</div>;
  }

  if (!session) {
    return <div className="flex-1 flex items-center justify-center text-muted text-sm">Session not found.</div>;
  }

  const statusIcon = session.status === 'completed'
    ? <CheckCircle size={20} className="text-success" />
    : session.status === 'failed'
    ? <XCircle size={20} className="text-error" />
    : <AlertTriangle size={20} className="text-warning" />;

  const statusColor = session.status === 'completed' ? 'text-success'
    : session.status === 'failed' ? 'text-error' : 'text-warning';

  const formatDate = (d: string | number) => {
    const date = new Date(d);
    return date.toLocaleString();
  };

  const duration = session.completedAt && session.startedAt
    ? (() => {
        const ms = new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime();
        const secs = Math.floor(ms / 1000);
        if (secs < 60) return `${secs}s`;
        const mins = Math.floor(secs / 60);
        return `${mins}m ${secs % 60}s`;
      })()
    : null;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Session header */}
      <div className="px-6 py-4 border-b border-border bg-surface">
        <div className="flex items-start gap-3 mb-3">
          {statusIcon}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-primary">{session.task}</h2>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted">
              <span className={clsx('capitalize font-medium', statusColor)}>{session.status}</span>
              {session.steps !== undefined && (
                <span className="flex items-center gap-1"><ListOrdered size={12} />{session.steps} steps</span>
              )}
              {duration && (
                <span className="flex items-center gap-1"><Clock size={12} />{duration}</span>
              )}
              {session.startedAt && (
                <span>{formatDate(session.startedAt)}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Result */}
      <div className="px-6 py-4">
        {session.result && (
          <div className="mb-6">
            <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Result</h3>
            <div className={clsx(
              'rounded-lg border p-4 text-sm whitespace-pre-wrap break-words',
              session.status === 'completed'
                ? 'bg-success/5 border-success/20 text-primary'
                : session.status === 'failed'
                ? 'bg-error/5 border-error/20 text-primary'
                : 'bg-warning/5 border-warning/20 text-primary'
            )}>
              {session.result}
            </div>
          </div>
        )}

        {session.summary && (
          <div className="mb-6">
            <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Summary</h3>
            <p className="text-sm text-secondary">{session.summary}</p>
          </div>
        )}

        {/* Tools Used */}
        {session.toolsUsed && session.toolsUsed.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setShowTools(!showTools)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-primary transition-colors"
            >
              {showTools ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Wrench size={12} />
              Tools Used ({session.toolsUsed.length})
            </button>
            {showTools && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {session.toolsUsed.map(t => (
                  <span key={t} className="px-2 py-1 bg-accent/10 text-accent text-xs rounded">{t}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* URLs Visited */}
        {session.urls && session.urls.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setShowUrls(!showUrls)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-primary transition-colors"
            >
              {showUrls ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Globe size={12} />
              URLs ({session.urls.length})
            </button>
            {showUrls && (
              <div className="mt-2 space-y-1">
                {session.urls.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-accent hover:opacity-80 truncate"
                  >
                    {url}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SessionView() {
  const { activeSessionId, sessions, storedSessions, sessionEvents } = useAppStore();

  if (!activeSessionId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <Zap size={48} className="text-accent/30 mb-4" />
          <h2 className="text-xl font-semibold text-primary mb-2">brmonk</h2>
          <p className="text-muted text-sm text-center max-w-md">
            AI-powered browser automation. Describe a task and let the agent handle it.
          </p>
        </div>
        <ChatInput />
      </div>
    );
  }

  // Determine if this is an active session or a stored one
  const isActive = sessions.some(s => s.id === activeSessionId);
  const hasEvents = (sessionEvents.get(activeSessionId)?.length ?? 0) > 0;
  const isStored = storedSessions.some(s => s.sessionId === activeSessionId);

  // If it's a stored session with no live events, show the stored view
  if (!isActive && isStored && !hasEvents) {
    return (
      <div className="flex flex-col h-full">
        <StoredSessionView sessionId={activeSessionId} />
        <ChatInput />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <StatusBar sessionId={activeSessionId} />
      <ThoughtChain sessionId={activeSessionId} />
      <ChatInput />
    </div>
  );
}

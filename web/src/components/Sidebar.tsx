import { useAppStore } from '../hooks/useSession';
import { Plus, User, Puzzle, Settings, Menu, X } from 'lucide-react';
import clsx from 'clsx';

function statusColor(status: string): string {
  switch (status) {
    case 'running': return 'bg-accent animate-pulse-dot';
    case 'completed': return 'bg-success';
    case 'failed': return 'bg-error';
    case 'paused': return 'bg-warning';
    default: return 'bg-muted';
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

export function Sidebar() {
  const {
    sessions, storedSessions, activeSessionId, sidebarOpen,
    currentView, toggleSidebar, selectSession, setView,
  } = useAppStore();

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="fixed top-3 left-3 z-50 p-2 rounded-lg bg-surface border border-border lg:hidden"
        onClick={toggleSidebar}
      >
        {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      <aside className={clsx(
        'fixed lg:static inset-y-0 left-0 z-40 w-64 bg-surface border-r border-border flex flex-col transition-transform duration-200',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Header */}
        <div className="p-4 border-b border-border">
          <h1 className="text-sm font-semibold tracking-wider text-muted uppercase">brmonk</h1>
        </div>

        {/* New Task */}
        <div className="p-3">
          <button
            onClick={() => { setView('session'); selectSession(''); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            New Task
          </button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto px-2">
          {sessions.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-[11px] font-medium text-muted uppercase tracking-wider">Active</p>
              {sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  className={clsx(
                    'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors mb-0.5',
                    activeSessionId === s.id && currentView === 'session'
                      ? 'bg-surface-elevated text-primary'
                      : 'text-secondary hover:bg-surface-elevated/50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', statusColor(s.status))} />
                    <span className="truncate">{s.task}</span>
                  </div>
                  <div className="text-[11px] text-muted mt-0.5 pl-4">{timeAgo(s.startedAt)}</div>
                </button>
              ))}
            </div>
          )}

          {storedSessions.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[11px] font-medium text-muted uppercase tracking-wider">History</p>
              {storedSessions.slice(0, 20).map(s => (
                <button
                  key={s.sessionId}
                  onClick={() => selectSession(s.sessionId)}
                  className={clsx(
                    'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors mb-0.5',
                    activeSessionId === s.sessionId && currentView === 'session'
                      ? 'bg-surface-elevated text-primary'
                      : 'text-secondary hover:bg-surface-elevated/50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', statusColor(s.status))} />
                    <span className="truncate">{s.task}</span>
                  </div>
                  <div className="text-[11px] text-muted mt-0.5 pl-4">
                    {s.startedAt ? timeAgo(s.startedAt) : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bottom nav */}
        <div className="border-t border-border p-2 space-y-0.5">
          {([
            ['profile', User, 'Profile'],
            ['skills', Puzzle, 'Skills'],
            ['settings', Settings, 'Settings'],
          ] as const).map(([view, Icon, label]) => (
            <button
              key={view}
              onClick={() => setView(view)}
              className={clsx(
                'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                currentView === view
                  ? 'bg-surface-elevated text-primary'
                  : 'text-secondary hover:bg-surface-elevated/50'
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}

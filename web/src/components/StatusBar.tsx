import { useAppStore } from '../hooks/useSession';
import clsx from 'clsx';

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    running: 'bg-accent/10 text-accent',
    completed: 'bg-success/10 text-success',
    failed: 'bg-error/10 text-error',
    'max-steps': 'bg-warning/10 text-warning',
    paused: 'bg-warning/10 text-warning',
    waiting_for_user: 'bg-warning/10 text-warning',
  };
  return colors[status] ?? 'bg-muted/10 text-muted';
}

export function StatusBar({ sessionId }: { sessionId: string }) {
  const { sessions, storedSessions, sessionEvents, sessionStatuses } = useAppStore();

  const active = sessions.find(s => s.id === sessionId);
  const stored = storedSessions.find(s => s.sessionId === sessionId);
  const task = active?.task ?? stored?.task ?? sessionId;
  const status = sessionStatuses.get(sessionId) ?? active?.status ?? stored?.status ?? 'unknown';
  const events = sessionEvents.get(sessionId) ?? [];

  // Find latest page-navigated event
  const lastNav = [...events].reverse().find(e => e.type === 'page-navigated');
  const currentUrl = lastNav?.type === 'page-navigated' ? lastNav.url : null;

  // Find latest step event
  const lastStep = [...events].reverse().find(e => e.type === 'step');
  const stepInfo = lastStep?.type === 'step' ? `${lastStep.step}/${lastStep.maxSteps}` : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface text-sm min-h-[40px]">
      <span className="truncate text-primary font-medium flex-1">{task}</span>
      {stepInfo && <span className="text-muted text-xs flex-shrink-0">Step {stepInfo}</span>}
      {currentUrl && <span className="text-muted text-xs truncate max-w-[200px]">{currentUrl}</span>}
      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium capitalize flex-shrink-0', statusBadge(status))}>
        {status.replace(/_/g, ' ')}
      </span>
    </div>
  );
}

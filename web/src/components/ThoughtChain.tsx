import { useEffect, useRef } from 'react';
import { useAppStore } from '../hooks/useSession';
import { StepCard } from './StepCard';

export function ThoughtChain({ sessionId }: { sessionId: string }) {
  const { sessionEvents, autoScroll } = useAppStore();
  const events = sessionEvents.get(sessionId) ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events.length, autoScroll]);

  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm">
        Waiting for agent to start...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {events.map((event, i) => (
        <StepCard key={i} event={event} isLast={i === events.length - 1} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

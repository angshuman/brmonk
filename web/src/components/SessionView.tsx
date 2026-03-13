import { useAppStore } from '../hooks/useSession';
import { StatusBar } from './StatusBar';
import { ThoughtChain } from './ThoughtChain';
import { ChatInput } from './ChatInput';
import { Zap } from 'lucide-react';

export function SessionView() {
  const { activeSessionId } = useAppStore();

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

  return (
    <div className="flex flex-col h-full">
      <StatusBar sessionId={activeSessionId} />
      <ThoughtChain sessionId={activeSessionId} />
      <ChatInput />
    </div>
  );
}

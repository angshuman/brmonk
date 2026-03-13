import { useState, useRef, useCallback } from 'react';
import { SendHorizontal, Square, Play } from 'lucide-react';
import { useAppStore } from '../hooks/useSession';

export function ChatInput() {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeSessionId, sessionStatuses, startTask, sendMessage, resolveUserAction, stopSession } = useAppStore();

  const status = activeSessionId ? sessionStatuses.get(activeSessionId) : null;
  const isRunning = status === 'running';
  const isWaitingUser = status === 'waiting_for_user';

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (activeSessionId && isRunning) {
      sendMessage(trimmed);
    } else {
      startTask(trimmed);
    }
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, activeSessionId, isRunning, startTask, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  };

  return (
    <div className="border-t border-border bg-surface p-3">
      {isWaitingUser && (
        <button
          onClick={resolveUserAction}
          className="w-full mb-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-background font-medium text-sm hover:bg-accent/90 transition-colors"
        >
          <Play size={16} />
          Continue (action completed)
        </button>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="What should we work on next?"
          rows={1}
          className="flex-1 resize-none bg-surface-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50 transition-colors"
        />
        {isRunning ? (
          <button
            onClick={stopSession}
            className="flex-shrink-0 p-2.5 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors"
            title="Stop"
          >
            <Square size={18} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="flex-shrink-0 p-2.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Send"
          >
            <SendHorizontal size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

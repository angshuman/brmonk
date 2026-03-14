import { useEffect, useState } from 'react';
import { useAppStore } from '../hooks/useSession';
import {
  Monitor, Maximize2, Minimize2, RefreshCw, Globe, Clock,
  Eye, EyeOff,
} from 'lucide-react';
import clsx from 'clsx';

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString();
}

function ScreenshotImage({ data, onFullscreen }: { data: string; onFullscreen: () => void }) {
  return (
    <div className="relative group cursor-pointer" onClick={onFullscreen}>
      <img
        src={`data:image/jpeg;base64,${data}`}
        alt="Browser viewport"
        className="w-full h-full object-contain bg-black rounded"
        draggable={false}
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded flex items-center justify-center">
        <Maximize2 size={24} className="text-white/0 group-hover:text-white/70 transition-colors" />
      </div>
    </div>
  );
}

function FullscreenOverlay({ data, url, onClose }: { data: string; url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="relative max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
        <img
          src={`data:image/jpeg;base64,${data}`}
          alt="Browser viewport fullscreen"
          className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
        />
        <div className="absolute top-3 right-3 flex gap-2">
          <button
            onClick={onClose}
            className="p-2 bg-black/50 hover:bg-black/70 rounded-lg text-white/80 hover:text-white transition-colors"
          >
            <Minimize2 size={16} />
          </button>
        </div>
        {url && (
          <div className="absolute bottom-3 left-3 right-3 bg-black/60 rounded-lg px-3 py-1.5 text-white/70 text-xs truncate">
            {url}
          </div>
        )}
      </div>
    </div>
  );
}

export function BrowserViewport({ sessionId }: { sessionId: string }) {
  const { browserScreenshots, browserViewportVisible, sessionStatuses } = useAppStore();
  const screenshot = browserScreenshots.get(sessionId);
  const status = sessionStatuses.get(sessionId);
  const isActive = status === 'running' || status === 'waiting-for-user' || status === 'paused';
  const [fullscreen, setFullscreen] = useState(false);
  const [fetchingInitial, setFetchingInitial] = useState(true);
  const [initialScreenshot, setInitialScreenshot] = useState<{ data: string; url: string; timestamp: number } | null>(null);

  // On mount, try to fetch latest screenshot from API (in case we missed WebSocket events)
  useEffect(() => {
    if (screenshot) {
      setFetchingInitial(false);
      return;
    }

    fetch(`/api/sessions/${sessionId}/screenshot`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.data) {
          setInitialScreenshot(data);
        }
      })
      .catch(() => {})
      .finally(() => setFetchingInitial(false));
  }, [sessionId, screenshot]);

  const displayScreenshot = screenshot ?? initialScreenshot;

  if (!browserViewportVisible) return null;

  if (!displayScreenshot && !isActive) return null;

  return (
    <>
      <div className="flex flex-col h-full border-l border-border bg-surface">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Monitor size={14} className="text-accent" />
            <span className="font-medium text-primary">Browser</span>
            {isActive && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                Live
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {displayScreenshot && (
              <button
                onClick={() => setFullscreen(true)}
                className="p-1 rounded hover:bg-surface-elevated transition-colors text-muted hover:text-primary"
                title="Fullscreen"
              >
                <Maximize2 size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Viewport content */}
        <div className="flex-1 min-h-0 p-2 flex items-center justify-center overflow-hidden">
          {displayScreenshot ? (
            <ScreenshotImage
              data={displayScreenshot.data}
              onFullscreen={() => setFullscreen(true)}
            />
          ) : fetchingInitial ? (
            <div className="flex flex-col items-center gap-2 text-muted">
              <RefreshCw size={20} className="animate-spin" />
              <span className="text-xs">Loading viewport...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted">
              <Monitor size={32} className="text-muted/30" />
              <span className="text-xs text-center">
                {isActive
                  ? 'Waiting for browser activity...'
                  : 'No browser session'}
              </span>
            </div>
          )}
        </div>

        {/* Footer with URL and timestamp */}
        {displayScreenshot && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border text-[11px] text-muted">
            <Globe size={11} className="flex-shrink-0" />
            <span className="truncate flex-1">{displayScreenshot.url || 'about:blank'}</span>
            <Clock size={11} className="flex-shrink-0" />
            <span className="flex-shrink-0">{formatTimestamp(displayScreenshot.timestamp)}</span>
          </div>
        )}
      </div>

      {/* Fullscreen overlay */}
      {fullscreen && displayScreenshot && (
        <FullscreenOverlay
          data={displayScreenshot.data}
          url={displayScreenshot.url}
          onClose={() => setFullscreen(false)}
        />
      )}
    </>
  );
}

/** Small toggle button for showing/hiding the viewport */
export function BrowserViewportToggle() {
  const { browserViewportVisible, toggleBrowserViewport } = useAppStore();

  return (
    <button
      onClick={toggleBrowserViewport}
      className={clsx(
        'p-1.5 rounded transition-colors',
        browserViewportVisible
          ? 'bg-accent/10 text-accent hover:bg-accent/20'
          : 'text-muted hover:bg-surface-elevated hover:text-primary'
      )}
      title={browserViewportVisible ? 'Hide browser viewport' : 'Show browser viewport'}
    >
      {browserViewportVisible ? <Eye size={14} /> : <EyeOff size={14} />}
    </button>
  );
}

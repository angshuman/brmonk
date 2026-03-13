import { create } from 'zustand';
import type { AgentEvent, SessionSummary, StoredSession } from '../types';
import { BrmonkWebSocket } from '../lib/ws';

interface AppStore {
  // Sessions
  sessions: SessionSummary[];
  storedSessions: StoredSession[];
  activeSessionId: string | null;
  sessionEvents: Map<string, AgentEvent[]>;
  sessionStatuses: Map<string, string>;

  // UI State
  sidebarOpen: boolean;
  currentView: 'session' | 'profile' | 'skills' | 'settings';
  autoScroll: boolean;

  // WebSocket
  wsClient: BrmonkWebSocket | null;
  connected: boolean;

  // Actions
  initialize: () => void;
  startTask: (task: string) => void;
  sendMessage: (message: string) => void;
  selectSession: (sessionId: string) => void;
  resolveUserAction: () => void;
  stopSession: () => void;
  addEvent: (sessionId: string, event: AgentEvent) => void;
  setView: (view: 'session' | 'profile' | 'skills' | 'settings') => void;
  toggleSidebar: () => void;
  setAutoScroll: (val: boolean) => void;
  fetchSessions: () => Promise<void>;
}

export const useAppStore = create<AppStore>((set, get) => ({
  sessions: [],
  storedSessions: [],
  activeSessionId: null,
  sessionEvents: new Map(),
  sessionStatuses: new Map(),
  sidebarOpen: true,
  currentView: 'session',
  autoScroll: true,
  wsClient: null,
  connected: false,

  initialize: () => {
    const ws = new BrmonkWebSocket();

    ws.onConnection((connected) => {
      set({ connected });
      if (connected) {
        get().fetchSessions();
      }
    });

    ws.onMessage((msg) => {
      const state = get();

      if (msg.type === 'session-created') {
        const sessionId = msg.sessionId;
        const newSession: SessionSummary = {
          id: sessionId,
          task: msg.task,
          status: 'running',
          startedAt: Date.now(),
          eventCount: 0,
        };
        set({
          sessions: [newSession, ...state.sessions],
          activeSessionId: sessionId,
          sessionEvents: new Map(state.sessionEvents).set(sessionId, []),
          sessionStatuses: new Map(state.sessionStatuses).set(sessionId, 'running'),
        });
        // Subscribe to this session
        ws.send({ type: 'subscribe', sessionId });
        return;
      }

      if (msg.type === 'event-replay') {
        const events = new Map(state.sessionEvents);
        events.set(msg.sessionId, msg.events);
        set({ sessionEvents: events });
        return;
      }

      // All other messages are AgentEvents
      if ('sessionId' in msg) {
        state.addEvent(msg.sessionId, msg as AgentEvent);
      }
    });

    ws.connect();
    set({ wsClient: ws });

    // Initial fetch
    get().fetchSessions();
  },

  startTask: (task: string) => {
    const ws = get().wsClient;
    if (ws) {
      ws.send({ type: 'start-task', task });
    }
  },

  sendMessage: (message: string) => {
    const { wsClient, activeSessionId } = get();
    if (wsClient && activeSessionId) {
      wsClient.send({ type: 'send-message', sessionId: activeSessionId, message });
    }
  },

  selectSession: (sessionId: string) => {
    const { wsClient, sessionEvents } = get();
    set({ activeSessionId: sessionId, currentView: 'session' });

    // If we don't have events for this session, subscribe
    if (!sessionEvents.has(sessionId) && wsClient) {
      wsClient.send({ type: 'subscribe', sessionId });
    }
  },

  resolveUserAction: () => {
    const { wsClient, activeSessionId } = get();
    if (wsClient && activeSessionId) {
      wsClient.send({ type: 'user-action-resolved', sessionId: activeSessionId });
    }
  },

  stopSession: () => {
    const { wsClient, activeSessionId } = get();
    if (wsClient && activeSessionId) {
      wsClient.send({ type: 'stop', sessionId: activeSessionId });
    }
  },

  addEvent: (sessionId: string, event: AgentEvent) => {
    const state = get();
    const events = new Map(state.sessionEvents);
    const existing = events.get(sessionId) ?? [];
    events.set(sessionId, [...existing, event]);

    const statuses = new Map(state.sessionStatuses);
    if (event.type === 'status') {
      statuses.set(sessionId, event.status);
      // Update session summary too
      const sessions = state.sessions.map(s =>
        s.id === sessionId ? { ...s, status: event.status } : s
      );
      set({ sessionEvents: events, sessionStatuses: statuses, sessions });
    } else {
      set({ sessionEvents: events, sessionStatuses: statuses });
    }
  },

  setView: (view) => set({ currentView: view }),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  setAutoScroll: (val) => set({ autoScroll: val }),

  fetchSessions: async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        set({
          sessions: data.active ?? [],
          storedSessions: data.stored ?? [],
        });
      }
    } catch {
      // Ignore fetch errors
    }
  },
}));

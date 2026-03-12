export interface LogEntry {
  timestamp: number;
  type: 'action' | 'result' | 'thought' | 'error' | 'info';
  message: string;
}

export interface SessionState {
  id: string;
  task: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'waiting-for-user';
  currentStep: number;
  maxSteps: number;
  plan: string[];
  planProgress: number;
  log: LogEntry[];
  currentAction: string;
  result: string | null;
  domain: string;
  startTime: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface SessionsHistoryState {
  selectedIndex: number;
  detailView: boolean;
  scrollOffset: number;
}

export interface AppState {
  currentView: 'dashboard' | 'session' | 'input' | 'action-required' | 'profile' | 'sessions-history';
  sessions: SessionState[];
  activeSessionIndex: number;
  profile: {
    name: string;
    documentCount: number;
    itemCount: number;
    collections: string[];
    paths: {
      baseDir: string;
      profileFile: string;
      documentsDir: string;
      itemsDir: string;
      memoryDir: string;
      sessionsDir: string;
      skillsDir: string;
    };
    documentNames: string[];
  } | null;
  memoryCount: number;
  actionPrompt: string;
  actionType: 'login' | 'captcha' | 'confirmation';
  inputBuffer: string;
  messageInputMode: boolean;
  messageBuffer: string;
  sessionsHistory: SessionsHistoryState;
  sessionResults: import('../memory/types.js').SessionResult[];
}

export function createInitialState(): AppState {
  return {
    currentView: 'dashboard',
    sessions: [],
    activeSessionIndex: -1,
    profile: null,
    memoryCount: 0,
    actionPrompt: '',
    actionType: 'confirmation',
    inputBuffer: '',
    messageInputMode: false,
    messageBuffer: '',
    sessionsHistory: { selectedIndex: 0, detailView: false, scrollOffset: 0 },
    sessionResults: [],
  };
}

export function addSession(state: AppState, id: string, task: string): void {
  state.sessions.push({
    id,
    task,
    status: 'running',
    currentStep: 0,
    maxSteps: 50,
    plan: [],
    planProgress: 0,
    log: [],
    currentAction: '',
    result: null,
    domain: '',
    startTime: Date.now(),
    totalInputTokens: 0,
    totalOutputTokens: 0,
  });
  state.activeSessionIndex = state.sessions.length - 1;
}

export function getActiveSession(state: AppState): SessionState | null {
  if (state.activeSessionIndex < 0 || state.activeSessionIndex >= state.sessions.length) {
    return null;
  }
  return state.sessions[state.activeSessionIndex] ?? null;
}

export function addLogEntry(session: SessionState, type: LogEntry['type'], message: string): void {
  session.log.push({ timestamp: Date.now(), type, message });
  // Keep log bounded
  if (session.log.length > 200) {
    session.log = session.log.slice(-150);
  }
}

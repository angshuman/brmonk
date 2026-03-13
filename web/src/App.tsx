import { useEffect } from 'react';
import { useAppStore } from './hooks/useSession';
import { useTheme } from './hooks/useTheme';
import { Sidebar } from './components/Sidebar';
import { SessionView } from './components/SessionView';
import { ProfileView } from './components/ProfileView';
import { SettingsView, SkillsView } from './components/SettingsView';
import { Sun, Moon, Wifi, WifiOff } from 'lucide-react';

export default function App() {
  const { initialize, currentView, connected } = useAppStore();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    initialize();
  }, [initialize]);

  const renderMain = () => {
    switch (currentView) {
      case 'profile': return <ProfileView />;
      case 'skills': return <SkillsView />;
      case 'settings': return <SettingsView />;
      default: return <SessionView />;
    }
  };

  return (
    <div className="h-full flex">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-border">
          <div className="flex items-center gap-1 text-[11px]">
            {connected ? (
              <><Wifi size={12} className="text-success" /><span className="text-success">Connected</span></>
            ) : (
              <><WifiOff size={12} className="text-error" /><span className="text-error">Disconnected</span></>
            )}
          </div>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded hover:bg-surface-elevated transition-colors text-muted"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
        {renderMain()}
      </main>
    </div>
  );
}

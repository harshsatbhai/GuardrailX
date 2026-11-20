import { useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import DashboardPage from "./pages/DashboardPage";
import Sidebar from "./components/Sidebar";
import useTheme from "./hooks/useTheme";
import useChatSessions from "./hooks/useChatSessions";
import { DomainProvider } from "./context/DomainContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AuthPage from "./pages/AuthPage";
import AccountControls from "./components/AccountControls";

export default function App() {
  return <AuthProvider><AppContent /></AuthProvider>;
}

function AppContent() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const location = useLocation();
  const {
    sessions, activeId, messages,
    setMessages, autoTitle, newChat,
    selectSession, deleteSession, renameSession,
  } = useChatSessions(user);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = () => setSidebarOpen((v) => !v);

  if (location.pathname === "/login" || location.pathname === "/signup") {
    return <Routes><Route path="/login" element={<AuthPage mode="login" />} /><Route path="/signup" element={<AuthPage mode="signup" />} /></Routes>;
  }

  return (
    <DomainProvider>
      <div className="flex h-screen bg-base overflow-hidden theme-transition">
        <AccountControls />
        <Sidebar
        sessions={sessions}
        activeId={activeId}
        onNewChat={newChat}
        onSelect={(id) => { selectSession(id); if (window.innerWidth < 1024) setSidebarOpen(false); }}
        onDelete={deleteSession}
        onRename={renameSession}
        theme={theme}
        onToggleTheme={toggleTheme}
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Routes>
          <Route
            path="/"
            element={
              <ChatPage
                key={activeId}
                messages={messages}
                setMessages={setMessages}
                autoTitle={autoTitle}
                sessionId={activeId}
                onSidebarToggle={toggleSidebar}
                isSidebarOpen={sidebarOpen}
              />
            }
          />
          <Route
            path="/dashboard"
            element={
              <DashboardPage
                theme={theme}
                onSidebarToggle={toggleSidebar}
                isSidebarOpen={sidebarOpen}
              />
            }
          />
        </Routes>
        </main>
      </div>
    </DomainProvider>
  );
}

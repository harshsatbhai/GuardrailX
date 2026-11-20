import { useCallback, useEffect, useRef, useState } from "react";
import { getChatSessions, saveChatSessions } from "../api";

function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function createSession(title = "New Chat") { return { id: generateId(), title, messages: [], createdAt: Date.now(), updatedAt: Date.now() }; }
function blankState() { const session = createSession(); return { sessions: [session], activeId: session.id }; }

export default function useChatSessions(user) {
  const [sessionData, setSessionData] = useState(blankState);
  const [hydrated, setHydrated] = useState(false);
  const sessionsRef = useRef(sessionData.sessions);
  useEffect(() => { sessionsRef.current = sessionData.sessions; }, [sessionData.sessions]);
  useEffect(() => {
    let active = true;
    setHydrated(false);
    if (!user) { setSessionData(blankState()); setHydrated(true); return () => { active = false; }; }
    getChatSessions().then((sessions) => {
      if (!active) return;
      const data = sessions.length ? { sessions, activeId: sessions[0].id } : blankState();
      setSessionData(data); sessionsRef.current = data.sessions; setHydrated(true);
    }).catch(() => { if (active) { setSessionData(blankState()); setHydrated(true); } });
    return () => { active = false; };
  }, [user?.id]);
  useEffect(() => {
    if (!user || !hydrated) return;
    const timer = setTimeout(() => { saveChatSessions(sessionsRef.current).catch(() => {}); }, 350);
    return () => clearTimeout(timer);
  }, [sessionData.sessions, user?.id, hydrated]);
  const sessions = sessionData.sessions;
  const activeId = sessionData.activeId && sessions.some((s) => s.id === sessionData.activeId) ? sessionData.activeId : sessions[0]?.id;
  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const change = (transform) => setSessionData((previous) => transform(previous));
  const newChat = useCallback(() => { const session = createSession(); change((previous) => ({ sessions: [session, ...previous.sessions], activeId: session.id })); }, []);
  const selectSession = useCallback((id) => change((previous) => ({ ...previous, activeId: id })), []);
  const deleteSession = useCallback((id) => change((previous) => { const next = previous.sessions.filter((session) => session.id !== id); const allSessions = next.length ? next : [createSession()]; return { sessions: allSessions, activeId: previous.activeId === id ? allSessions[0].id : previous.activeId }; }), []);
  const renameSession = useCallback((id, title) => change((previous) => ({ ...previous, sessions: previous.sessions.map((session) => session.id === id ? { ...session, title: title.trim() || "New Chat", updatedAt: Date.now() } : session) })), []);
  const setMessages = useCallback((updater) => change((previous) => ({ ...previous, sessions: previous.sessions.map((session) => session.id === previous.activeId ? { ...session, messages: typeof updater === "function" ? updater(session.messages) : updater, updatedAt: Date.now() } : session) })), []);
  const autoTitle = useCallback((text) => { const title = text.length > 45 ? `${text.slice(0, 45)}...` : text; change((previous) => ({ ...previous, sessions: previous.sessions.map((session) => session.id === previous.activeId && session.title === "New Chat" ? { ...session, title } : session) })); }, []);
  return { sessions, activeId, messages: activeSession?.messages ?? [], newChat, selectSession, deleteSession, renameSession, setMessages, autoTitle };
}

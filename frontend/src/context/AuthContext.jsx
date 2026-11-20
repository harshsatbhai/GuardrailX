import { createContext, useContext, useEffect, useState } from "react";
import { attachToken, login, signup } from "../api";

const AUTH_KEY = "guardrailx-auth";
const AuthContext = createContext(null);

function loadAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { return null; }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(loadAuth);
  // Set Axios authentication during render so child effects that load chat
  // history always have the token on their first request.
  attachToken(auth?.token);
  useEffect(() => {
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  }, [auth]);
  async function authenticate(request) { const result = await request(); attachToken(result.token); setAuth(result); return result; }
  return <AuthContext.Provider value={{ user: auth?.user ?? null, token: auth?.token ?? null, login: (identity, password) => authenticate(() => login(identity, password)), signup: (username, email, password) => authenticate(() => signup(username, email, password)), logout: () => setAuth(null) }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

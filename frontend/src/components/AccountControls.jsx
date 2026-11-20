import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function AccountControls() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => { const close = (event) => { if (!menuRef.current?.contains(event.target)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  if (!user) return <div className="fixed right-4 top-4 z-30 flex items-center gap-2"><Link to="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-panel hover:text-ink">Log in</Link><Link to="/signup" className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent/85">Sign up</Link></div>;
  return <div ref={menuRef} className="fixed right-4 top-4 z-30"><button onClick={() => setOpen((value) => !value)} aria-label="Open profile menu" className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-white shadow-md hover:bg-accent/85">{user.username.slice(0, 1).toUpperCase()}</button>{open && <div className="absolute right-0 mt-2 w-52 rounded-xl border border-border bg-panel p-1.5 shadow-xl"><div className="flex items-center gap-2 border-b border-border px-2.5 py-2.5"><UserRound size={15} className="text-accent" /><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{user.username}</p><p className="truncate text-xs text-muted">{user.email}</p></div></div><button onClick={logout} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-danger/10 hover:text-danger"><LogOut size={15} />Log out</button></div>}</div>;
}

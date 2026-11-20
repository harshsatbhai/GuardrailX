import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function AuthPage({ mode }) {
  const isSignup = mode === "signup";
  const navigate = useNavigate();
  const { login, signup } = useAuth();
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  async function submit(event) {
    event.preventDefault(); setError(""); setLoading(true);
    try { if (isSignup) await signup(form.username, form.email, form.password); else await login(form.username, form.password); navigate("/", { replace: true }); }
    catch (err) { setError(err.response?.data?.error || "We could not complete that request. Please try again."); }
    finally { setLoading(false); }
  }
  return <main className="min-h-screen bg-base flex items-center justify-center px-4 py-10"><section className="w-full max-w-md rounded-2xl border border-border bg-panel p-7 sm:p-9 shadow-xl shadow-black/10"><Link to="/" className="mb-8 inline-flex items-center gap-2 text-ink hover:opacity-80"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent"><ShieldCheck size={19} /></span><span className="font-bold tracking-tight">GuardrailX</span></Link><h1 className="text-2xl font-semibold text-ink">{isSignup ? "Create your account" : "Welcome back"}</h1><p className="mt-2 text-sm leading-relaxed text-muted">{isSignup ? "Save your chats securely and access them whenever you return." : "Sign in to access your saved chat history."}</p><form className="mt-7 space-y-4" onSubmit={submit}>{isSignup && <label className="block text-sm font-medium text-ink">Username<input required minLength="3" maxLength="32" autoComplete="username" value={form.username} onChange={update("username")} className="mt-1.5 w-full rounded-lg border border-border bg-base px-3 py-2.5 text-ink outline-none focus:border-accent" placeholder="your_name" /></label>}<label className="block text-sm font-medium text-ink">{isSignup ? "Email" : "Username or email"}<input required autoComplete={isSignup ? "email" : "username"} value={isSignup ? form.email : form.username} onChange={update(isSignup ? "email" : "username")} className="mt-1.5 w-full rounded-lg border border-border bg-base px-3 py-2.5 text-ink outline-none focus:border-accent" placeholder={isSignup ? "you@example.com" : "your_name"} /></label><label className="block text-sm font-medium text-ink">Password<input required minLength="8" type="password" autoComplete={isSignup ? "new-password" : "current-password"} value={form.password} onChange={update("password")} className="mt-1.5 w-full rounded-lg border border-border bg-base px-3 py-2.5 text-ink outline-none focus:border-accent" placeholder="At least 8 characters" /></label>{error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}<button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-medium text-white hover:bg-accent/85 disabled:opacity-60">{loading ? <Loader2 className="animate-spin" size={17} /> : <>{isSignup ? "Create account" : "Log in"}<ArrowRight size={16} /></>}</button></form><p className="mt-6 text-center text-sm text-muted">{isSignup ? "Already have an account?" : "New to GuardrailX?"} <Link className="font-medium text-accent hover:underline" to={isSignup ? "/login" : "/signup"}>{isSignup ? "Log in" : "Create an account"}</Link></p></section></main>;
}

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Logo from "@/components/Logo";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const nodes = useMemo(
    () =>
      Array.from({ length: 14 }, (_, index) => ({
        id: index,
        x: Math.random() * 70 + 15,
        y: Math.random() * 60 + 20,
        radius: Math.random() * 1.4 + 1.1,
        delay: Math.random() * 6,
      })),
    []
  );

  const connections = useMemo(() => {
    const segments: { from: number; to: number; delay: number }[] = [];
    const seen = new Set<string>();

    nodes.forEach((node, index) => {
      const neighbors = [
        nodes[(index + 1) % nodes.length],
        nodes[(index + 4) % nodes.length],
      ];

      neighbors.forEach((target) => {
        if (!target) return;
        const key = node.id < target.id ? `${node.id}-${target.id}` : `${target.id}-${node.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        segments.push({
          from: node.id,
          to: target.id,
          delay: Math.random() * 8,
        });
      });
    });

    return segments;
  }, [nodes]);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error("Please fill in all fields");
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;
        
        toast.success("Account created successfully!");
        navigate("/projects");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
        
        toast.success("Login successful");
        navigate("/projects");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black px-6 py-16 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(167,199,231,0.12),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(199,184,231,0.1),_transparent_65%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0.35),_rgba(0,0,0,0.92))]" />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-20 h-80 w-80 rounded-full bg-[#A7C7E7]/12 blur-[140px]" />
        <div className="absolute -bottom-32 -right-16 h-[24rem] w-[24rem] rounded-full bg-[#C7B8E7]/10 blur-[180px]" />
        <div className="absolute left-1/2 top-1/2 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#A7C7E7]/12" />
      </div>

      <svg
        className="pointer-events-none absolute inset-0 h-full w-full animate-network-float"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="network-line-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(167,199,231,0.12)" />
            <stop offset="50%" stopColor="rgba(199,184,231,0.28)" />
            <stop offset="100%" stopColor="rgba(167,199,231,0.12)" />
          </linearGradient>
        </defs>

        {connections.map((segment, index) => {
          const from = nodes[segment.from];
          const to = nodes[segment.to];
          if (!from || !to) return null;

          return (
            <line
              key={`segment-${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="url(#network-line-gradient)"
              strokeWidth="0.28"
              strokeLinecap="round"
              className="network-line"
              style={{ animationDelay: `-${segment.delay}s` }}
            />
          );
        })}
      </svg>

      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-12">
        <div className="flex flex-col items-center gap-8 text-center">
          <div className="relative flex flex-col items-center gap-6">
            <div className="relative flex items-center justify-center">
              <div className="absolute h-36 w-36 rounded-full border border-[#A7C7E7]/25" />
              <div className="absolute h-36 w-36 rounded-full bg-[conic-gradient(from_45deg,_rgba(167,199,231,0)_0deg,_rgba(199,184,231,0.65)_180deg,_rgba(167,199,231,0)_360deg)] opacity-90 animate-orbit" />
              <div className="absolute h-36 w-36 rounded-full bg-[#A7C7E7]/20 blur-3xl animate-glow-pulse" />
              <Logo
                className="pointer-events-none flex-col items-center gap-3 text-slate-100"
                textClassName="text-4xl uppercase tracking-[0.65em] text-slate-100"
              />
            </div>
            <p className="max-w-xl text-sm text-slate-400 md:text-base">
              Log into the Celion data core to orchestrate migrations through a living mesh of intelligence, where every connection is illuminated and responsive.
            </p>
          </div>

          <div className="w-full max-w-md rounded-[2.5rem] border border-white/10 bg-white/10 p-8 shadow-[0_40px_160px_rgba(0,0,0,0.55)] backdrop-blur-3xl">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-5">
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-14 rounded-full border-white/10 bg-white/10 px-6 text-base text-slate-100 placeholder:text-slate-400/70 focus-visible:border-[#A7C7E7]/60 focus-visible:ring-2 focus-visible:ring-[#A7C7E7]/60 focus-visible:ring-offset-0"
                  disabled={loading}
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-14 rounded-full border-white/10 bg-white/10 px-6 text-base text-slate-100 placeholder:text-slate-400/70 focus-visible:border-[#C7B8E7]/60 focus-visible:ring-2 focus-visible:ring-[#C7B8E7]/60 focus-visible:ring-offset-0"
                  disabled={loading}
                />
              </div>
              <Button
                type="submit"
                className="group relative flex h-14 w-full items-center justify-center rounded-full bg-gradient-to-r from-[#A7C7E7]/80 via-[#B9C1E7]/80 to-[#C7B8E7]/80 text-base font-semibold text-slate-950 shadow-[0_0_28px_rgba(167,199,231,0.3)] transition-all duration-500 hover:shadow-[0_0_40px_rgba(199,184,231,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A7C7E7] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={loading}
              >
                <span className="absolute inset-[-1px] rounded-full bg-gradient-to-r from-[#A7C7E7]/50 via-transparent to-[#C7B8E7]/50 opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100" />
                <span className="relative">{loading ? "Loading..." : isSignUp ? "Sign Up" : "Login"}</span>
              </Button>
            </form>

            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="mt-8 w-full text-center text-sm text-slate-400 transition-colors hover:text-[#A7C7E7]"
              disabled={loading}
            >
              {isSignUp ? "Already have an account? Log in" : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>

        <div className="relative mt-6 w-max text-xs uppercase tracking-[0.5em] text-slate-500">
          Be independent
          <span className="animate-underline pointer-events-none absolute left-1/2 top-full mt-3 h-px w-24 -translate-x-1/2 bg-gradient-to-r from-transparent via-[#A7C7E7]/60 to-transparent" />
        </div>
      </div>
    </div>
  );
};

export default Login;

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#020617] px-6 py-16 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(8,47,73,0.55),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(14,116,144,0.45),_transparent_62%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(8,11,27,0.96),_rgba(2,6,23,0.94))]" />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-20 h-96 w-96 rounded-full bg-cyan-500/15 blur-[120px]" />
        <div className="absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-amber-400/10 blur-[180px]" />
        <div className="absolute left-1/2 top-1/2 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-500/10" />
      </div>

      <svg
        className="pointer-events-none absolute inset-0 h-full w-full animate-network-float"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="network-line-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(56,189,248,0.15)" />
            <stop offset="50%" stopColor="rgba(251,191,36,0.45)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0.15)" />
          </linearGradient>
          <radialGradient id="network-node-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(251,191,36,0.6)" />
            <stop offset="55%" stopColor="rgba(56,189,248,0.8)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0.1)" />
          </radialGradient>
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

        {nodes.map((node) => (
          <circle
            key={`node-${node.id}`}
            cx={node.x}
            cy={node.y}
            r={node.radius}
            fill="url(#network-node-gradient)"
            className="network-node"
            style={{ animationDelay: `-${node.delay}s` }}
          />
        ))}
      </svg>

      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-12">
        <div className="flex flex-col items-center gap-8 text-center">
          <div className="relative flex flex-col items-center gap-6">
            <div className="relative flex items-center justify-center">
              <div className="absolute h-36 w-36 rounded-full border border-cyan-300/30" />
              <div className="absolute h-36 w-36 rounded-full bg-[conic-gradient(from_45deg,_rgba(56,189,248,0)_0deg,_rgba(56,189,248,0.8)_180deg,_rgba(56,189,248,0)_360deg)] opacity-90 animate-orbit" />
              <div className="absolute h-36 w-36 rounded-full bg-cyan-400/25 blur-3xl animate-glow-pulse" />
              <Logo
                className="pointer-events-none flex-col items-center gap-3 text-slate-100"
                textClassName="text-4xl uppercase tracking-[0.65em] text-slate-100"
              />
            </div>
            <p className="max-w-xl text-sm text-slate-400 md:text-base">
              Log into the Celion data core to orchestrate migrations through a living mesh of intelligence, where every connection is illuminated and responsive.
            </p>
          </div>

          <div className="w-full max-w-md rounded-[2.5rem] border border-white/10 bg-white/10 p-8 shadow-[0_40px_160px_rgba(8,47,73,0.45)] backdrop-blur-3xl">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-5">
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-14 rounded-full border-white/10 bg-white/10 px-6 text-base text-slate-100 placeholder:text-slate-400/70 focus-visible:border-cyan-400/60 focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-0"
                  disabled={loading}
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-14 rounded-full border-white/10 bg-white/10 px-6 text-base text-slate-100 placeholder:text-slate-400/70 focus-visible:border-amber-300/60 focus-visible:ring-2 focus-visible:ring-amber-300/70 focus-visible:ring-offset-0"
                  disabled={loading}
                />
              </div>
              <Button
                type="submit"
                className="group relative flex h-14 w-full items-center justify-center rounded-full bg-gradient-to-r from-cyan-400/80 via-sky-500/80 to-amber-300/80 text-base font-semibold text-slate-950 shadow-[0_0_32px_rgba(56,189,248,0.38)] transition-all duration-500 hover:shadow-[0_0_44px_rgba(34,211,238,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={loading}
              >
                <span className="absolute inset-[-1px] rounded-full bg-gradient-to-r from-cyan-400/60 via-transparent to-amber-200/60 opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100" />
                <span className="relative">{loading ? "Loading..." : isSignUp ? "Sign Up" : "Login"}</span>
              </Button>
            </form>

            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="mt-8 w-full text-center text-sm text-slate-400 transition-colors hover:text-cyan-200"
              disabled={loading}
            >
              {isSignUp ? "Already have an account? Log in" : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>

        <div className="relative mt-6 w-max text-xs uppercase tracking-[0.5em] text-slate-500">
          Be independent
          <span className="animate-underline pointer-events-none absolute left-1/2 top-full mt-3 h-px w-24 -translate-x-1/2 bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
        </div>
      </div>
    </div>
  );
};

export default Login;

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
      Array.from({ length: 6 }, (_, index) => ({
        id: index,
        x: Math.random() * 70 + 15,
        y: Math.random() * 60 + 20,
        radius: Math.random() * 1.4 + 1.4,
        delay: Math.random() * 4,
      })),
    []
  );

  const connections = useMemo(() => {
    if (nodes.length < 2) {
      return [];
    }

    const pairs: { from: number; to: number }[] = [];

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        pairs.push({ from: nodes[i].id, to: nodes[j].id });
      }
    }

    const shuffled = [...pairs].sort(() => Math.random() - 0.5);

    return shuffled.slice(0, 5).map((pair) => ({
      ...pair,
      delay: Math.random() * 6,
    }));
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
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="network-line-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(210 57% 78%)" />
            <stop offset="100%" stopColor="hsl(259 49% 81%)" />
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
              strokeWidth="0.35"
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
            fill="white"
            className="network-node"
            style={{ animationDelay: `-${node.delay}s` }}
          />
        ))}
      </svg>

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-6 text-center">
          <Logo className="flex-col items-center gap-2 text-slate-100" textClassName="text-3xl tracking-[0.55em] text-slate-100" />
          <p className="text-sm text-slate-400">Sign in to continue.</p>
        </div>

        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-900/70 p-8 shadow-lg backdrop-blur">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-5">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 rounded-xl border-white/10 bg-black/40 px-4 text-base text-slate-100 placeholder:text-slate-500 focus-visible:border-[#A7C7E7]/60 focus-visible:ring-2 focus-visible:ring-[#A7C7E7]/40 focus-visible:ring-offset-0"
                disabled={loading}
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-xl border-white/10 bg-black/40 px-4 text-base text-slate-100 placeholder:text-slate-500 focus-visible:border-[#C7B8E7]/60 focus-visible:ring-2 focus-visible:ring-[#C7B8E7]/40 focus-visible:ring-offset-0"
                disabled={loading}
              />
            </div>
            <Button
              type="submit"
              className="relative flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#A7C7E7] to-[#C7B8E7] text-sm font-semibold text-slate-950 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A7C7E7] focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-70"
              disabled={loading}
            >
              <span className="relative">{loading ? "Loading..." : isSignUp ? "Sign Up" : "Login"}</span>
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="mt-8 w-full text-center text-xs text-slate-500 transition-colors hover:text-[#A7C7E7]"
            disabled={loading}
          >
            {isSignUp ? "Already have an account? Log in" : "Don't have an account? Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;

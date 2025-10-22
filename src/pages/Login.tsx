import { useState } from "react";
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
    <div className="app-shell flex items-center justify-center px-6 py-16">
      <div className="z-10 flex w-full max-w-4xl flex-col items-center gap-12">
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo
            className="flex-col items-center gap-2 text-foreground"
            textClassName="text-3xl tracking-[0.55em] text-foreground"
          />
          <p className="text-sm text-muted-foreground">Melde dich an, um fortzufahren.</p>
        </div>

        <div className="app-surface w-full max-w-md px-10 py-12">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-4">
              <Input
                type="email"
                placeholder="E-Mail-Adresse"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 rounded-2xl border border-border/60 bg-transparent px-4 text-sm focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0"
                disabled={loading}
              />
              <Input
                type="password"
                placeholder="Passwort"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-2xl border border-border/60 bg-transparent px-4 text-sm focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0"
                disabled={loading}
              />
            </div>
            <Button
              type="submit"
              className="h-12 w-full rounded-2xl bg-foreground text-background text-sm font-semibold transition-colors hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? "Lädt..." : isSignUp ? "Registrieren" : "Anmelden"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="mt-10 w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
            disabled={loading}
          >
            {isSignUp ? "Bereits ein Konto? Jetzt anmelden" : "Noch kein Konto? Jetzt registrieren"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;

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
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[hsl(210,40%,97%)] px-6 py-12 text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.25),transparent_55%)]"
      />

      <div className="relative z-10 w-full max-w-md space-y-10">
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo className="flex-col items-center gap-2 text-foreground" textClassName="text-2xl tracking-[0.55em]" />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Willkommen bei Celion</h1>
            <p className="text-sm text-muted-foreground">
              {isSignUp ? "Erstellen Sie Ihr Konto, um loszulegen." : "Melden Sie sich an, um Ihre Migrationen zu verwalten."}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/90 p-8 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <Input
                type="email"
                placeholder="E-Mail-Adresse"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 rounded-xl border-border/70 bg-background px-4 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
                disabled={loading}
              />
              <Input
                type="password"
                placeholder="Passwort"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-xl border-border/70 bg-background px-4 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
                disabled={loading}
              />
            </div>
            <Button
              type="submit"
              className="h-11 w-full rounded-xl text-sm font-medium shadow-sm transition-colors disabled:opacity-70"
              disabled={loading}
            >
              {loading ? "Wird geladen..." : isSignUp ? "Registrieren" : "Anmelden"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="mt-8 w-full text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            disabled={loading}
          >
            {isSignUp ? "Bereits registriert? Jetzt anmelden" : "Noch kein Konto? Jetzt registrieren"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;

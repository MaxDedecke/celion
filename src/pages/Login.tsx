import { useState } from "react";
import { useNavigate } from "react-router-dom";
import DataFlowLoader from "@/components/DataFlowLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Logo from "@/components/Logo";
import { toast } from "sonner";
import { databaseClient } from "@/api/databaseClient";
import { useMinimumLoader } from "@/hooks/useMinimumLoader";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const loaderVisible = useMinimumLoader(loading, 1000);
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
        const { error } = await databaseClient.signUp(email, password);

        if (error) throw error;
        
        toast.success("Account created successfully!");
        navigate("/dashboard");
      } else {
        const { error } = await databaseClient.signInWithPassword(email, password);

        if (error) throw error;
        
        toast.success("Login successful");
        navigate("/dashboard");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell relative flex items-center justify-center px-6 py-16">
      {loaderVisible && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 backdrop-blur-md transition-opacity">
          <DataFlowLoader size="lg" />
        </div>
      )}
      <div className="z-10 flex w-full max-w-4xl flex-col items-center gap-12">
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo
            className="flex-col items-center gap-2 text-foreground"
            textClassName="text-3xl tracking-[0.55em] text-foreground"
            imageClassName="h-24 w-24"
          />
          <p className="text-sm text-muted-foreground">Melde dich an, um fortzufahren.</p>
        </div>

        <div className="app-surface relative w-full max-w-md px-10 py-12">
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
              className="flex h-12 w-full items-center justify-center rounded-2xl bg-foreground text-background text-sm font-semibold transition-colors hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? (
                <>
                  <DataFlowLoader size="sm" className="w-16" />
                  <span className="sr-only">Anfrage wird verarbeitet</span>
                </>
              ) : isSignUp ? "Registrieren" : "Anmelden"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;


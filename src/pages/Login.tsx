import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Logo from "@/components/Logo";
import { toast } from "sonner";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email && password) {
      toast.success("Login successful");
      navigate("/dashboard");
    } else {
      toast.error("Please fill in all fields");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      {/* Dotted pattern background */}
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `radial-gradient(circle, hsl(var(--primary)) 1px, transparent 1px)`,
          backgroundSize: "20px 20px",
          maskImage: "radial-gradient(ellipse 600px 400px at center, black 40%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse 600px 400px at center, black 40%, transparent 70%)"
        }}
      />

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="flex justify-center mb-12">
          <Logo />
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 bg-card border-border rounded-full px-6"
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 bg-card border-border rounded-full px-6"
          />
          <Button 
            type="submit"
            className="w-full h-12 rounded-full bg-secondary hover:bg-secondary/90 text-secondary-foreground font-medium"
          >
            Login
          </Button>
        </form>

        <p className="text-center text-muted-foreground mt-20 text-sm">
          Be independent
        </p>
      </div>
    </div>
  );
};

export default Login;

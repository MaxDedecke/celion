import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import DataFlowLoader from "@/components/DataFlowLoader";
import { useMinimumLoader } from "@/hooks/useMinimumLoader";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const loaderVisible = useMinimumLoader(loading, 1000);

  useEffect(() => {
    const run = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          navigate("/projects");
        } else {
          navigate("/");
        }
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [navigate]);

  if (loaderVisible) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center p-6">
        <DataFlowLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen items-center justify-center p-6">
      <DataFlowLoader size="md" />
    </div>
  );
};

export default Index;

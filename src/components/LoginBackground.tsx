import { cn } from "@/lib/utils";

interface MigrationPathProps {
  className?: string;
  scale?: number;
  opacity?: number;
  delay?: number;
  drift?: "slow" | "medium" | "fast";
  rotation?: number;
}

const MigrationPath = ({ 
  className, 
  scale = 1, 
  opacity = 0.15, 
  delay = 0, 
  drift = "slow",
  rotation = 0,
}: MigrationPathProps) => {
  const driftClass = {
    slow: "animate-drift-slow",
    medium: "animate-drift-medium",
    fast: "animate-drift-fast",
  }[drift];

  return (
    <div 
      className={cn("migration-path", driftClass, className)}
      style={{ 
        transform: `scale(${scale}) rotate(${rotation}deg)`, 
        opacity,
        animationDelay: `${delay}s`,
      }}
    >
      <span className="bg-node bg-node-1" style={{ animationDelay: `${delay}s` }} />
      <span className="bg-edge-wrapper">
        <span className="bg-edge bg-edge-1" style={{ animationDelay: `${delay + 0.6}s` }} />
      </span>
      <span className="bg-node bg-node-2" style={{ animationDelay: `${delay + 1.3}s` }} />
      <span className="bg-edge-wrapper">
        <span className="bg-edge bg-edge-2" style={{ animationDelay: `${delay + 2}s` }} />
      </span>
      <span className="bg-node bg-node-3" style={{ animationDelay: `${delay + 2.6}s` }} />
    </div>
  );
};

const LoginBackground = () => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Top left - large, slow */}
      <MigrationPath 
        className="absolute top-[12%] left-[3%]" 
        scale={1.1} 
        opacity={0.12} 
        delay={0} 
        drift="slow"
        rotation={-8}
      />
      
      {/* Bottom right - medium */}
      <MigrationPath 
        className="absolute bottom-[18%] right-[5%]" 
        scale={1.3} 
        opacity={0.1} 
        delay={1.5} 
        drift="medium"
        rotation={5}
      />
      
      {/* Top right - small, fast */}
      <MigrationPath 
        className="absolute top-[8%] right-[15%]" 
        scale={0.7} 
        opacity={0.08} 
        delay={3} 
        drift="fast"
        rotation={15}
      />
      
      {/* Bottom left - medium */}
      <MigrationPath 
        className="absolute bottom-[25%] left-[8%]" 
        scale={0.9} 
        opacity={0.09} 
        delay={2} 
        drift="medium"
        rotation={-12}
      />
      
      {/* Center left - subtle */}
      <MigrationPath 
        className="absolute top-[45%] left-[-2%]" 
        scale={0.6} 
        opacity={0.06} 
        delay={4} 
        drift="slow"
        rotation={-3}
      />
      
      {/* Center right - subtle */}
      <MigrationPath 
        className="absolute top-[55%] right-[-3%]" 
        scale={0.8} 
        opacity={0.07} 
        delay={2.5} 
        drift="fast"
        rotation={10}
      />
    </div>
  );
};

export default LoginBackground;

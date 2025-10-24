import { cn } from "@/lib/utils";

const Logo = ({
  className = "",
  textClassName = "text-2xl",
  imageClassName = "h-10 w-10",
  onClick,
}: {
  className?: string;
  textClassName?: string;
  imageClassName?: string;
  onClick?: () => void;
}) => {
  return (
    <button
      className={cn("flex items-center gap-2", className)}
      onClick={onClick}
      type="button"
    >
      <img
        src="/placeholder.svg"
        alt="Celion logo"
        className={cn("pt-2", imageClassName)}
      />
      <span className={cn("font-bold text-foreground", textClassName)}>Celion</span>
    </button>
  );
};

export default Logo;

import { useState } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

interface InfoTooltipProps extends Pick<ComponentPropsWithoutRef<typeof TooltipContent>, "side" | "align"> {
  content: ReactNode;
  className?: string;
  iconClassName?: string;
  "aria-label"?: string;
}

const InfoTooltip = ({
  content,
  className,
  iconClassName,
  side = "right",
  align = "center",
  "aria-label": ariaLabel = "Weitere Hinweise",
}: InfoTooltipProps) => {
  const [open, setOpen] = useState(false);

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  return (
    <Tooltip open={open} delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors",
            "hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
            className,
          )}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
          onFocus={handleClose}
          onBlur={handleClose}
          onPointerDown={handleClose}
        >
          <Info className={cn("h-4 w-4", iconClassName)} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        className="max-w-xs text-xs leading-relaxed"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
};

export default InfoTooltip;

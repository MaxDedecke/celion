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
      className={`flex items-center gap-2 ${className}`}
      onClick={onClick}
      type="button"
    >
      <img
        src="/placeholder.svg"
        alt="Celion logo"
        className={imageClassName}
      />
      <span className={`font-bold text-foreground ${textClassName}`}>celion</span>
    </button>
  );
};

export default Logo;

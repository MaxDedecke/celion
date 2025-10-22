const Logo = ({
  className = "",
  textClassName = "text-2xl",
  onClick,
}: {
  className?: string;
  textClassName?: string;
  onClick?: () => void;
}) => {
  return (
    <button
      className={`flex items-center gap-2 ${className}`}
      onClick={onClick}
      type="button"
    >
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 5C11.7157 5 5 11.7157 5 20C5 28.2843 11.7157 35 20 35" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-primary"/>
        <path d="M20 35C28.2843 35 35 28.2843 35 20C35 11.7157 28.2843 5 20 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-secondary"/>
        <circle cx="20" cy="12" r="2" fill="currentColor" className="text-primary"/>
        <circle cx="28" cy="20" r="2" fill="currentColor" className="text-secondary"/>
      </svg>
      <span className={`font-bold text-foreground ${textClassName}`}>celion</span>
    </button>
  );
};

export default Logo;

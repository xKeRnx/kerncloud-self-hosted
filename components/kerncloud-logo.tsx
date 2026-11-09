interface KernCloudLogoProps {
  size?: number;
  className?: string;
}

export function KernCloudLogo({ size = 32, className }: KernCloudLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="KeRnCloud logo"
    >
      {/* Outer hexagonal ring */}
      <path
        d="M16 2L28 9V23L16 30L4 23V9L16 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        className="text-primary"
      />
      {/* Inner K shape */}
      <path
        d="M11 10V22M11 16L20 10M11 16L20 22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary"
      />
      {/* Dot accent */}
      <circle cx="23" cy="16" r="1.5" className="fill-primary" />
    </svg>
  );
}

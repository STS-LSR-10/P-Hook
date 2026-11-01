import { cn } from "@/lib/utils";

/** The mascot (public/logo.png, also the picture on the LINE cards). `size` is the box it fits in. */
function Mark({
  size,
  className,
  variant = "default",
}: {
  size: number;
  className?: string;
  variant?: "default" | "error";
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={variant === "error" ? "/error-logo.png" : "/logo.png"}
      alt="พี่ฮูก (P'Hook)"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

/** Logo with an optional "P'Hook" wordmark under the mark. */
export function Logo({
  size = 96,
  withWordmark = false,
  variant = "default",
  className,
}: {
  size?: number;
  withWordmark?: boolean;
  /** "error" is the warning owl (public/error-logo.png) for failure screens. */
  variant?: "default" | "error";
  className?: string;
}) {
  if (!withWordmark) return <Mark size={size} className={className} variant={variant} />;
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <Mark size={size} variant={variant} />
      <p className="text-2xl font-bold tracking-tight" aria-hidden>
        <span className="text-foreground">Jod</span>
        <span className="text-primary">Tang</span>
      </p>
    </div>
  );
}

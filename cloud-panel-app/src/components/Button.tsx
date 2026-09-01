import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  const variantClass = variant === "primary" ? "" : variant;
  return <button className={`${variantClass} ${className}`.trim()} {...rest} />;
}

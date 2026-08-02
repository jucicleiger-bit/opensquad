interface SkeletonProps {
  height?: number;
  width?: string | number;
}

export function Skeleton({ height = 16, width = "100%" }: SkeletonProps) {
  return (
    <div
      style={{
        height,
        width,
        borderRadius: 8,
        background: "var(--surface-2)",
        animation: "pulse 1.4s ease-in-out infinite",
      }}
    />
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p style={{ margin: 0, fontWeight: 700, color: "var(--soft)" }}>{title}</p>
      {description ? <p style={{ margin: "6px 0 0" }}>{description}</p> : null}
    </div>
  );
}

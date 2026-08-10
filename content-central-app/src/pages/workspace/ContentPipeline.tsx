import type { ContentItem } from "@/api/client";
import { contentPipelineSteps } from "./contentDisplay";
import styles from "./ContentPipeline.module.css";

interface ContentPipelineProps {
  item: ContentItem;
  title?: string;
}

export function ContentPipeline({ item, title = "Pipeline deste criativo" }: ContentPipelineProps) {
  return (
    <div className={styles.pipeline} aria-label={title}>
      <div className={styles.title}>{title}</div>
      <div className={styles.steps}>
        {contentPipelineSteps(item).map((step) => (
          <div key={step.id} className={`${styles.step} ${styles[step.tone]}`} title={step.detail}>
            <div className={styles.stepHead}>
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.agent}>{step.agent}</span>
            </div>
            <div className={styles.label}>{step.label}</div>
            <div className={styles.detail}>{step.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

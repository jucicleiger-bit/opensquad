import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import styles from "./Dialog.module.css";

interface DialogProps {
  onClose: () => void;
  titleId: string;
  children: ReactNode;
  overlayClassName?: string;
  overlayStyle?: CSSProperties;
  contentClassName?: string;
  contentStyle?: CSSProperties;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function Dialog({
  onClose,
  titleId,
  children,
  overlayClassName = "",
  overlayStyle,
  contentClassName = "",
  contentStyle,
}: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  // Callers routinely pass an inline onClose (a new function identity every
  // render). Reading it through a ref keeps the effect below mount/unmount
  // only — depending on onClose directly would re-run it on every keystroke
  // inside the dialog (any parent state update re-renders the caller), each
  // time re-stealing focus back to the first focusable element mid-typing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const content = contentRef.current;
    const focusable = content?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] || content)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose read via ref, see above
  }, []);

  return (
    <div
      className={`${styles.overlay} ${overlayClassName}`.trim()}
      style={overlayStyle}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className={`${styles.content} ${contentClassName}`.trim()}
        style={contentStyle}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

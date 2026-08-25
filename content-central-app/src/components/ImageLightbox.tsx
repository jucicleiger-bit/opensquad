import { Button } from "./Button";
import { Dialog } from "./Dialog";
import styles from "./ImageLightbox.module.css";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  fileName?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, fileName, onClose }: ImageLightboxProps) {
  async function handleDownload() {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName || "imagem.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Cross-origin host blocking fetch (no CORS) — open it in a new tab so
      // the user can still save it manually instead of silently failing.
      window.open(src, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <Dialog onClose={onClose} titleId="image-lightbox-title" overlayClassName={styles.overlay} contentClassName={styles.content}>
      <h2 id="image-lightbox-title" className="sr-only">
        {fileName || "Visualização de imagem"}
      </h2>
      <img src={src} alt={alt || "Imagem"} className={styles.image} />
      <div className={styles.toolbar}>
        <Button type="button" variant="secondary" onClick={handleDownload}>
          Baixar imagem
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </Dialog>
  );
}

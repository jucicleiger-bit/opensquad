import { forwardRef, type ReactNode } from "react";
import styles from "./InstagramMockup.module.css";

export interface InstagramMockupHighlight {
  label: string;
  // Pre-rendered content for the ring bubble (a photo <img>, an icon tile,
  // whatever the caller wants) — InstagramMockup stays pure presentation and
  // never assumes photos specifically.
  content?: ReactNode;
}

export interface InstagramMockupProps {
  businessName: string;
  handle: string;
  avatarUrl?: string;
  bio: string;
  link?: string;
  posts: number | null;
  followers: number | null;
  following: number | null;
  highlights: InstagramMockupHighlight[];
  // Pre-rendered content for each grid cell (a photo <img>, an icon tile
  // component, etc.) — same "caller decides what a cell looks like"
  // contract as highlights.content.
  gridItems: ReactNode[];
}

// Never invents a number the operator/AI hasn't actually confirmed — an
// empty count reads as "—", same discipline the rest of Content Central
// already follows for anything that could otherwise look like a real,
// verified figure.
function formatCount(value: number | null): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 15 15 9M10 6l1.4-1.4a4 4 0 0 1 5.6 5.6L15.6 11.6M14 18l-1.4 1.4a4 4 0 0 1-5.6-5.6L8.4 12.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A clean, self-contained "profile card" — pure presentation, no network
// calls, so every keystroke in the editor that feeds this component updates
// the preview instantly. Deliberately not a phone/OS chrome replica (no fake
// status bar, no phone bezel, no app header icons) — just the profile
// content itself, exportable straight to PNG via the forwarded ref.
export const InstagramMockup = forwardRef<HTMLDivElement, InstagramMockupProps>(function InstagramMockup(
  { businessName, handle, avatarUrl, bio, link, posts, followers, following, highlights, gridItems },
  ref,
) {
  const initial = (businessName || handle || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className={styles.card} ref={ref}>
      {handle ? <div className={styles.handleLabel}>{handle}</div> : null}

      <div className={styles.profileRow}>
        <div className={styles.avatar}>
          {avatarUrl ? <img src={avatarUrl} alt="Foto de perfil" /> : <span>{initial}</span>}
        </div>
        <div className={styles.stats}>
          <div>
            <b>{formatCount(posts)}</b>
            <span>publicações</span>
          </div>
          <div>
            <b>{formatCount(followers)}</b>
            <span>seguidores</span>
          </div>
          <div>
            <b>{formatCount(following)}</b>
            <span>seguindo</span>
          </div>
        </div>
      </div>

      <div className={styles.bioBlock}>
        <div className={styles.bioName}>{businessName || "Sua marca"}</div>
        {bio ? <div className={styles.bioText}>{bio}</div> : null}
        {link ? (
          <div className={styles.bioLink}>
            <LinkIcon />
            <span>{link}</span>
          </div>
        ) : null}
      </div>

      {highlights.length ? (
        <div className={styles.highlights}>
          {highlights.map((highlight, index) => (
            <div className={styles.highlight} key={`${highlight.label}-${index}`}>
              <div className={styles.highlightRing}>{highlight.content ?? null}</div>
              <span>{highlight.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.grid}>
        {gridItems.length ? (
          gridItems.map((item, index) => (
            <div className={styles.gridCell} key={index}>
              {item}
            </div>
          ))
        ) : (
          <div className={styles.gridEmpty}>Sem fotos ainda</div>
        )}
      </div>
    </div>
  );
});

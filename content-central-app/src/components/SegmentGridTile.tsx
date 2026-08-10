// A grid/highlight tile for the prospecting preview — a fixed, real
// AI-photographed image from a registered segment template (see
// registerSegmentTemplate in content-central.js), with a live CSS color
// overlay on top. The photo itself never regenerates per prospect; only the
// overlay color changes, instantly, client-side — `mix-blend-mode: color`
// re-hues the photo (replacing its hue/saturation, keeping its real
// lighting/shading) rather than just painting a flat tint over it, so it
// still reads as a photo, not a colored square.

export const DEFAULT_BRAND_COLOR = "#8B5E3C";

// How strongly the accent replaces the photo's own color — high enough that
// the brand color reads clearly at a glance, low enough that the product
// photography underneath still looks like a photo instead of a flat shape.
const OVERLAY_OPACITY = 0.72;

export interface SegmentGridTileProps {
  imageUrl: string;
  alt: string;
  accent: string;
}

export function SegmentGridTile({ imageUrl, alt, accent }: SegmentGridTileProps) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <img
        src={imageUrl}
        alt={alt}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          // The source photos are 4:5 (feed) or 9:16 (story), always taller
          // than the square/circular slots they land in here — headlines
          // sit near the top of the design, so anchoring the crop to the
          // top keeps them from being cut off by a centered crop.
          objectFit: "cover",
          objectPosition: "top",
          display: "block",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: accent,
          mixBlendMode: "color",
          opacity: OVERLAY_OPACITY,
        }}
      />
    </div>
  );
}

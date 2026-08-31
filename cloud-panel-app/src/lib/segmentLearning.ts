function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "data"
  );
}

export const SEGMENT_LEVELS = ["setor", "nicho", "especialidade"] as const;
export type SegmentLevel = (typeof SEGMENT_LEVELS)[number];

// Mirrors src/content-central.js's segmentNodePathsFromFields verbatim.
// Each kept segment is tagged with the field it came from (group:/
// category:/specialty:) — two projects only share a node when they have
// the IDENTICAL set of populated fields with identical values.
// Note the positional quirk this feeds into segmentNodeLabelFromFields:
// callers assign SEGMENT_LEVELS[index] to each returned path by its
// POSITION in this array, not by which real field it came from — so when
// group is missing, the first returned path (built from category) still
// gets level "setor", not "nicho". See segmentNodeLabelFromFields below.
export function segmentNodePathsFromFields(group: string, category: string, specialty: string): string[] {
  const g = group.trim();
  const c = category.trim();
  const s = specialty.trim();
  const parts = [
    g ? `group:${slugify(g)}` : "",
    c ? `category:${slugify(c)}` : "",
    s ? `specialty:${slugify(s)}` : "",
  ].filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

// Mirrors src/content-central.js's segmentNodeLabelFromFields verbatim —
// `level` is assigned POSITIONALLY by the caller (SEGMENT_LEVELS[index] on
// segmentNodePathsFromFields's result), not by which real field a path
// segment came from. This is a known quirk of the local system (a project
// with no Setor set skips straight to a "nicho"-labeled first path) —
// reproduced here on purpose so the cloud reads the same stored nodes the
// same way local does.
export function segmentNodeLabelFromFields(group: string, category: string, specialty: string, level: SegmentLevel): string {
  const g = group.trim();
  const c = category.trim();
  const s = specialty.trim();
  if (level === "setor") return g;
  if (level === "nicho") return [g, c].filter(Boolean).join(" / ");
  return [g, c, s].filter(Boolean).join(" / ");
}

export interface SegmentNodeRef {
  path: string;
  label: string;
  level: SegmentLevel;
}

export function segmentNodesForProject(group: string, category: string, specialty: string): SegmentNodeRef[] {
  return segmentNodePathsFromFields(group, category, specialty).map((path, index) => ({
    path,
    label: segmentNodeLabelFromFields(group, category, specialty, SEGMENT_LEVELS[index]),
    level: SEGMENT_LEVELS[index],
  }));
}

export interface LearningEntry {
  id: string;
  bucket: string;
  kind: "text" | "image";
  text: string;
  title: string;
  storagePath?: string;
  source: string;
  createdAt: string;
  [key: string]: unknown;
}

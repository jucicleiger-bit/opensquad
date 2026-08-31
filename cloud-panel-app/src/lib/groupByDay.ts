// src/lib/groupByDay.ts
export interface DayGroup<T> {
  day: string;
  items: T[];
}

const NO_DATE_LABEL = "Sem data";

export function groupByDay<T>(items: T[], getDate: (item: T) => string | null): DayGroup<T>[] {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const day = getDate(item) || NO_DATE_LABEL;
    const existing = byDay.get(day);
    if (existing) existing.push(item);
    else byDay.set(day, [item]);
  }
  const days = [...byDay.keys()].filter((d) => d !== NO_DATE_LABEL).sort();
  if (byDay.has(NO_DATE_LABEL)) days.push(NO_DATE_LABEL);
  return days.map((day) => ({ day, items: byDay.get(day)! }));
}

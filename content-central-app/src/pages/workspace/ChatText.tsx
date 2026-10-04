import type { ReactNode } from "react";

// The cérebro answers in light Markdown: **bold**, "- " and "1. " lists.
// Shown formatted instead of raw asterisks. Older answers carried tables;
// their rows read as "a · b" and the |---| separator lines are dropped.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.length > 4 && part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part,
  );
}

export function ChatText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^\|?[\s:|-]*-{3,}[\s:|-]*$/.test(line)) continue;
    const item = /^(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = Boolean(item[1]);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(item[2]);
      continue;
    }
    flush();
    if (!line) continue;
    const row = line.startsWith("|") ? line.split("|").map((cell) => cell.trim()).filter(Boolean).join(" · ") : line;
    blocks.push(<p key={blocks.length}>{inline(row)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

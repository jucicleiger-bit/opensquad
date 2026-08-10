import { channelFullLabel } from "@/pages/workspace/contentDisplay";

interface ChannelCheckboxGroupProps {
  channels: string[];
  selected: Set<string>;
  onToggle: (channel: string) => void;
  // Two same-named checkboxes ("Instagram Feed") on the same page collide on
  // accessible name for screen readers/testing-library queries — this is
  // what the "Datas comemorativas" bug (GenerateContent.tsx) came from.
  // Required so every caller has to make its checkboxes distinguishable.
  ariaLabel: (channel: string) => string;
}

export function ChannelCheckboxGroup({ channels, selected, onToggle, ariaLabel }: ChannelCheckboxGroupProps) {
  return (
    <>
      {channels.map((channel) => (
        <label key={channel} className="pill" style={{ width: "max-content" }}>
          <input type="checkbox" checked={selected.has(channel)} onChange={() => onToggle(channel)} aria-label={ariaLabel(channel)} />
          {channelFullLabel(channel)}
        </label>
      ))}
    </>
  );
}

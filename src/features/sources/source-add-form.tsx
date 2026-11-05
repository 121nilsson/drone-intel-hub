import { DOMAINS, type Domain } from "@/entities/drone/types";
import { PLATFORMS, type SourcePlatform } from "@/entities/source/types";
import { Input, Select, Textarea } from "@/shared/ui/fields";
import { Btn } from "@/shared/ui/primitives";

export type SourceDraft = {
  name: string;
  platform: SourcePlatform;
  handle: string;
  domain: Domain;
  notes: string;
};

/**
 * The draft lives in the page, not here: the Add tab unmounts when another tab is selected,
 * and an unsent source must survive that.
 */
export function AddSourceForm({
  f,
  setF,
  onAdd,
}: {
  f: SourceDraft;
  setF: (f: SourceDraft) => void;
  onAdd: () => void;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <Input
        placeholder="Name"
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
        aria-label="Source name"
      />
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={f.platform}
          onChange={(e) => setF({ ...f, platform: e.target.value as SourcePlatform })}
          aria-label="Platform"
        >
          {PLATFORMS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
        <Select
          value={f.domain}
          onChange={(e) => setF({ ...f, domain: e.target.value as Domain })}
          aria-label="Domain"
        >
          {DOMAINS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </Select>
      </div>
      <Input
        placeholder="URL or @handle"
        value={f.handle}
        onChange={(e) => setF({ ...f, handle: e.target.value })}
        aria-label="URL or @handle"
      />
      <Textarea
        rows={3}
        placeholder="Notes"
        value={f.notes}
        onChange={(e) => setF({ ...f, notes: e.target.value })}
        aria-label="Notes"
      />
      <Btn onClick={onAdd} disabled={!f.name.trim() || !f.handle.trim()}>
        Add to watchlist
      </Btn>
    </div>
  );
}

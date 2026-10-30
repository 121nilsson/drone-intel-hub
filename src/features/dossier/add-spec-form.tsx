"use client";

import { useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/shared/ui/fields";
import { Btn } from "@/shared/ui/primitives";
import { useServices } from "@/shared/infra/services";
import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { ANALYST_SOURCE } from "@/entities/drone/claim-review";
import { attributeSemantic } from "@/entities/drone/spec-engine";
import { canonicalUnitForSemantic } from "@/entities/normalization/semantic";
import { normalizeQuantity } from "@/entities/normalization/units";

interface AddSpecFormProps {
  droneId: string;
  droneName: string;
  specs: SpecAttribute[];
}

/**
 * Manual specification entry for a dossier page. Lets an analyst record a manufacturer or
 * observed figure as an analyst-owned claim on an attribute (existing or new). The claim is
 * reviewed "confirmed" by the analyst, so it feeds consensus like any other source.
 */
export function AddSpecForm({ droneId, droneName, specs }: AddSpecFormProps) {
  const existingKeys = specs.map((s) => s.key);
  const svc = useServices();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedKey, setSelectedKey] = useState(existingKeys[0] ?? "");
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [value, setValue] = useState("");
  const [evidence, setEvidence] = useState("");
  const [source, setSource] = useState(ANALYST_SOURCE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError("");
      setSubmitting(true);
      try {
        const at = new Date().toISOString();
        const key = mode === "new" ? newKey.trim() : selectedKey || existingKeys[0];
        const label =
          mode === "new" ? newLabel.trim() : specs.find((s) => s.key === selectedKey)?.label || key;

        if (!key || !label) throw new Error("Key and label are required");
        if (!value.trim()) throw new Error("Value is required");

        // Parse the value like addAnalystClaim does: quantity first, then bare number, then text.
        const normalized = normalizeQuantity(value.trim());
        const numeric = Number(value.trim());
        const claimValue =
          normalized?.canonicalValue ?? (Number.isFinite(numeric) ? numeric : value.trim());

        const claim: SpecClaim = {
          id: crypto.randomUUID(),
          value: claimValue,
          ...(normalized
            ? {
                raw: value.trim(),
                normalized,
                normalizationConfidence: normalized.confidence,
              }
            : Number.isFinite(numeric)
              ? {}
              : { raw: value.trim() }),
          ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
          source: source.trim() || ANALYST_SOURCE,
          date: at,
          extractionEngine: "analyst",
          review: { verdict: "confirmed", at, by: "analyst" },
        };

        // Compute semantic/canonicalUnit for a new attribute; reuse the existing spec's for a known one.
        const existing = specs.find((s) => s.key === key);
        const semantic = existing?.semantic ?? attributeSemantic({ key, label });
        const canonicalUnit = existing?.canonicalUnit ?? canonicalUnitForSemantic(semantic);

        const spec: SpecAttribute = {
          key,
          label,
          ...(unit ? { unit } : {}),
          ...(semantic ? { semantic } : {}),
          ...(canonicalUnit ? { canonicalUnit } : {}),
          claims: [claim],
          discoveredBy: "analyst",
        };

        const drone = svc.drones.get(droneId);
        if (!drone) throw new Error("Drone not found");

        const existingIdx = drone.specs.findIndex((s) => s.key === key);
        const next: Drone = {
          ...drone,
          specs:
            existingIdx >= 0
              ? drone.specs.map((s, i) =>
                  i === existingIdx ? { ...s, claims: [...s.claims, claim] } : s,
                )
              : [...drone.specs, spec],
          updatedAt: at,
        };

        svc.drones.upsert(next, (fresh) => {
          // Re-apply against the freshest stored copy on conflict.
          const freshIdx = fresh.specs.findIndex((s) => s.key === key);
          if (freshIdx >= 0) {
            return {
              ...fresh,
              specs: fresh.specs.map((s, i) =>
                i === freshIdx ? { ...s, claims: [...s.claims, claim] } : s,
              ),
            };
          }
          return { ...fresh, specs: [...fresh.specs, spec] };
        });

        setOpen(false);
        setMode("existing");
        setSelectedKey("");
        setNewKey("");
        setNewLabel("");
        setUnit("");
        setValue("");
        setEvidence("");
        setSource(ANALYST_SOURCE);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    },
    [
      droneId,
      svc.drones,
      mode,
      selectedKey,
      existingKeys,
      specs,
      newKey,
      newLabel,
      unit,
      value,
      evidence,
      source,
    ],
  );

  const attributeOptions =
    mode === "existing" ? (
      <Select
        value={selectedKey}
        onChange={(e) => setSelectedKey(e.target.value)}
        aria-label="Existing attribute"
        className="w-full"
      >
        {existingKeys.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </Select>
    ) : (
      <>
        <div className="space-y-2">
          <Label>Key</Label>
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="max_speed"
          />
        </div>
        <div className="space-y-2">
          <Label>Label</Label>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Maximum speed"
          />
        </div>
      </>
    );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <>
        <SheetTrigger asChild>
          <Btn variant="ghost">Add specification</Btn>
        </SheetTrigger>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Add specification</SheetTitle>
            <SheetDescription>
              Record a manufacturer or observed figure for {droneName}. Stored as an analyst claim
              on {mode === "existing" ? "an existing attribute" : "a new attribute"}.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={submit} className="space-y-4 p-4">
            {error && (
              <p className="text-xs text-destructive bg-destructive/10 p-2 rounded">{error}</p>
            )}
            <div className="space-y-2">
              <Label>Attribute</Label>
              <div className="flex gap-2">
                <Btn
                  variant={mode === "existing" ? "primary" : "ghost"}
                  onClick={() => setMode("existing")}
                >
                  Existing
                </Btn>
                <Btn variant={mode === "new" ? "primary" : "ghost"} onClick={() => setMode("new")}>
                  New
                </Btn>
              </div>
              {attributeOptions}
            </div>
            <div className="space-y-2">
              <Label>Value</Label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. 150 or 150 km/h"
              />
            </div>
            <div className="space-y-2">
              <Label>Unit (optional)</Label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="e.g. km/h"
              />
            </div>
            <div className="space-y-2">
              <Label>Evidence (optional)</Label>
              <Textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="Verbatim quote from the source"
              />
            </div>
            <div className="space-y-2">
              <Label>Source</Label>
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Analyst"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Btn variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Btn>
              <Btn type="submit" variant="primary" disabled={submitting}>
                {submitting ? "Saving…" : "Add claim"}
              </Btn>
            </div>
          </form>
        </SheetContent>
      </>
    </Sheet>
  );
}

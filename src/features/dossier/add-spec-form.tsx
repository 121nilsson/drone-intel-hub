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
import { Field, Input, Select, Textarea } from "@/shared/ui/fields";
import { Btn, Segmented } from "@/shared/ui/primitives";
import { useServices } from "@/shared/infra/use-services";
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

type Mode = "existing" | "new";

/**
 * Manual specification entry for a dossier page. Lets an analyst record a manufacturer or
 * observed figure as an analyst-owned claim on an attribute (existing or new). The claim is
 * reviewed "confirmed" by the analyst, so it feeds consensus like any other source.
 */
export function AddSpecForm({ droneId, droneName, specs }: AddSpecFormProps) {
  const svc = useServices();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("existing");
  const [selectedKey, setSelectedKey] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [value, setValue] = useState("");
  const [evidence, setEvidence] = useState("");
  const [source, setSource] = useState(ANALYST_SOURCE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Until the analyst picks, the select shows (and the form uses) the first attribute.
  const activeKey = specs.some((s) => s.key === selectedKey) ? selectedKey : (specs[0]?.key ?? "");

  const resetForm = useCallback(() => {
    setMode("existing");
    setSelectedKey("");
    setNewKey("");
    setNewLabel("");
    setUnit("");
    setValue("");
    setEvidence("");
    setSource(ANALYST_SOURCE);
    setError("");
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError("");
      setSubmitting(true);
      try {
        const at = new Date().toISOString();
        const key = mode === "new" ? newKey.trim() : activeKey;
        const label =
          mode === "new" ? newLabel.trim() : specs.find((s) => s.key === key)?.label || key;

        if (!key || !label) throw new Error("Key and label are required");
        if (!value.trim()) throw new Error("Value is required");

        // A bare number plus a unit is read as the figure in that unit ("150" + "km/h"), so the
        // unit field takes part in normalisation for an existing attribute as well as a new one.
        const typed = value.trim();
        const numeric = Number(typed);
        const text = unit.trim() && Number.isFinite(numeric) ? `${typed} ${unit.trim()}` : typed;

        // Parse the value like addAnalystClaim does: quantity first, then bare number, then text.
        const normalized = normalizeQuantity(text, {
          semantic: attributeSemantic({ key, label }),
        });
        const claimValue =
          normalized?.canonicalValue ?? (Number.isFinite(numeric) ? numeric : typed);

        const claim: SpecClaim = {
          id: crypto.randomUUID(),
          value: claimValue,
          ...(normalized
            ? {
                raw: text,
                normalized,
                normalizationConfidence: normalized.confidence,
              }
            : Number.isFinite(numeric)
              ? {}
              : { raw: typed }),
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
          ...(unit.trim() ? { unit: unit.trim() } : {}),
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
        resetForm();
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
      activeKey,
      specs,
      newKey,
      newLabel,
      unit,
      value,
      evidence,
      source,
      resetForm,
    ],
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Cancel, Escape and a tap outside all leave a clean form for the next time.
        if (!next) resetForm();
      }}
    >
      <SheetTrigger asChild>
        <Btn variant="ghost">Add specification</Btn>
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add specification</SheetTitle>
          <SheetDescription>
            Record a manufacturer or observed figure for {droneName}. Stored as an analyst claim on{" "}
            {mode === "existing" ? "an existing attribute" : "a new attribute"}.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="space-y-4 p-4">
          {error && (
            <p role="alert" className="bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <Segmented
            label="Attribute"
            value={mode}
            onChange={setMode}
            options={[
              { value: "existing", label: "Existing attribute" },
              { value: "new", label: "New attribute" },
            ]}
          />
          {mode === "existing" ? (
            <Field label="Attribute">
              {(id) => (
                <Select
                  id={id}
                  value={activeKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                  className="w-full"
                >
                  {specs.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <>
              <Field label="Key">
                {(id) => (
                  <Input
                    id={id}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="max_speed"
                  />
                )}
              </Field>
              <Field label="Label">
                {(id) => (
                  <Input
                    id={id}
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Maximum speed"
                  />
                )}
              </Field>
            </>
          )}
          <Field label="Value">
            {(id) => (
              <Input
                id={id}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. 150 or 150 km/h"
              />
            )}
          </Field>
          <Field
            label="Unit (optional)"
            hint="Read together with a bare number: 150 with km/h is 150 km/h."
          >
            {(id) => (
              <Input
                id={id}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="e.g. km/h"
              />
            )}
          </Field>
          <Field label="Evidence (optional)">
            {(id) => (
              <Textarea
                id={id}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="Verbatim quote from the source"
              />
            )}
          </Field>
          <Field label="Source">
            {(id) => (
              <Input
                id={id}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Analyst"
              />
            )}
          </Field>
          <div className="flex justify-end gap-2 pt-4">
            <Btn
              variant="ghost"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Btn>
            <Btn type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Saving…" : "Add claim"}
            </Btn>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

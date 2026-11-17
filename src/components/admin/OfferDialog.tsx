"use client";
import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { applicationsContent } from "@/lib/admin/applicationsContent";
import type { AdminLang } from "@/lib/admin/nav";
import { FormField } from "./ui/form-field";
import { Segmented } from "./ui/segmented";

export type OfferDetails = { mode: "email" | "later"; note?: string };

// Offers either go out by email now, or are marked only because staff will
// contact the candidate directly (phone, in person) — never a silent guess.
export function OfferDialog({
  lang,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  lang: AdminLang;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (details: OfferDetails) => void;
}) {
  const t = applicationsContent[lang].offerDialog;
  const [mode, setMode] = useState<"email" | "later">("email"),
    [note, setNote] = useState("");

  function reset() {
    setMode("email");
    setNote("");
  }

  function close() {
    if (pending) return;
    reset();
    onOpenChange(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ mode, note: note.trim() || undefined });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent showCloseButton={!pending} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.help}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <fieldset disabled={pending} className="m-0 grid gap-4 border-0 p-0">
            <Segmented
              label={t.title}
              value={mode}
              onChange={setMode}
              disabled={pending}
              options={[
                { value: "email", label: t.modeEmail },
                { value: "later", label: t.modeLater },
              ]}
            />
            {mode === "email" ? (
              <FormField label={t.note} htmlFor="offer-note">
                <Textarea
                  id="offer-note"
                  rows={5}
                  className="min-h-32 field-sizing-content"
                  value={note}
                  maxLength={1000}
                  placeholder={t.notePlaceholder}
                  onChange={(event) => setNote(event.target.value)}
                />
              </FormField>
            ) : (
              <p className="m-0 text-xs text-muted-foreground">{t.confirm}</p>
            )}
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={close}
            >
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : null}
              {pending ? t.sending : t.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

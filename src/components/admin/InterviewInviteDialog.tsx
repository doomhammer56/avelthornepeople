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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { applicationsContent } from "@/lib/admin/applicationsContent";
import type { AdminLang } from "@/lib/admin/nav";
import { FormField } from "./ui/form-field";
import { Segmented } from "./ui/segmented";

export type InterviewDetails = {
  mode: "details" | "later";
  when?: string;
  location?: string;
  meetingLink?: string;
  note?: string;
};

// Collect interview specifics before the stage change fires, so the stage
// move and its invite email submit together as one request.
export function InterviewInviteDialog({
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
  onSubmit: (details: InterviewDetails) => void;
}) {
  const t = applicationsContent[lang].interviewDialog;
  const [mode, setMode] = useState<"details" | "later">("details"),
    [when, setWhen] = useState(""),
    [location, setLocation] = useState(""),
    [meetingLink, setMeetingLink] = useState(""),
    [note, setNote] = useState("");

  function reset() {
    setMode("details");
    setWhen("");
    setLocation("");
    setMeetingLink("");
    setNote("");
  }

  function close() {
    if (pending) return;
    reset();
    onOpenChange(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      mode,
      when: when.trim() || undefined,
      location: location.trim() || undefined,
      meetingLink: meetingLink.trim() || undefined,
      note: note.trim() || undefined,
    });
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
                { value: "details", label: t.modeDetails },
                { value: "later", label: t.modeLater },
              ]}
            />
            {mode === "details" ? (
              <>
                <FormField label={t.when} htmlFor="interview-when">
                  <Input
                    id="interview-when"
                    value={when}
                    maxLength={200}
                    placeholder={t.whenPlaceholder}
                    onChange={(event) => setWhen(event.target.value)}
                  />
                </FormField>
                <FormField label={t.location} htmlFor="interview-location">
                  <Input
                    id="interview-location"
                    value={location}
                    maxLength={200}
                    placeholder={t.locationPlaceholder}
                    onChange={(event) => setLocation(event.target.value)}
                  />
                </FormField>
                <FormField label={t.meetingLink} htmlFor="interview-link">
                  <Input
                    id="interview-link"
                    type="url"
                    value={meetingLink}
                    maxLength={500}
                    placeholder={t.meetingLinkPlaceholder}
                    onChange={(event) => setMeetingLink(event.target.value)}
                  />
                </FormField>
              </>
            ) : null}
            <FormField label={t.note} htmlFor="interview-note">
              <Textarea
                id="interview-note"
                rows={5}
                className="min-h-32 field-sizing-content"
                value={note}
                maxLength={1000}
                placeholder={t.notePlaceholder}
                onChange={(event) => setNote(event.target.value)}
              />
            </FormField>
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

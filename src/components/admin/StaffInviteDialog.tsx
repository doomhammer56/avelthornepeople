"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useAdminRouter as useRouter } from "./AdminNavigation";
import { CircleAlert, LoaderCircle, LockKeyhole, UserPlus } from "lucide-react";
import { AdminSelect } from "./AdminSelect";
import { staffRoles, roleScope } from "@/lib/auth/permissions";
import type { StaffRole } from "@/lib/auth/permissions";
import { roleLabel } from "@/lib/admin/nav";
import { staffCommand } from "@/server/team/contract";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Switch } from "@/components/ui/switch";
import { FormField } from "./ui/form-field";
import { Segmented } from "./ui/segmented";
import {
  sendStaffCommand,
  AdminRequestError,
  signInAgain,
} from "@/lib/admin/staffClient";
import { staffUiText } from "@/lib/admin/staffContent";
import type { AdminLang } from "@/lib/admin/nav";

// Keep invitations and existing-user linking distinct within the same staff dialog.
// Both modes retain the backend default of inactive read-only access for new members.
export function StaffInviteDialog({ lang }: { lang: AdminLang }) {
  const t = staffUiText[lang],
    router = useRouter();
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState<"invite" | "link">("invite"),
    [name, setName] = useState(""),
    [target, setTarget] = useState(""),
    [role, setRole] = useState<StaffRole>("READ_ONLY"),
    [activate, setActivate] = useState(true);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const inFlight = useRef(false);
  const nameId = useId();
  // Clear private form values when the dialog is intentionally dismissed.
  // Failed submissions remain open so staff can review and retry the same request.
  function closeDialog() {
    setOpen(false);
    setName("");
    setTarget("");
    setMode("invite");
    setRole("READ_ONLY");
    setActivate(true);
    setError("");
    request.current = null;
  }

  // Validate against the existing command contract before making a staff request.
  // Repeated attempts reuse their identity until the actual invitation payload changes.
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const fingerprint = JSON.stringify([
      mode,
      name.trim(),
      target.trim().toLowerCase(),
      role,
      activate,
    ]);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    const command = staffCommand.safeParse({
      action: mode,
      requestId: request.current.id,
      displayName: name.trim(),
      role,
      active: activate,
      ...(mode === "invite"
        ? { email: target.trim(), lang }
        : { userId: target.trim() }),
    });
    if (!command.success) {
      setError(t.invalid);
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const result = await sendStaffCommand(command.data);
      // Say exactly what happened: the role may not have applied, or the member
      // may exist while the email failed, and neither is a plain success.
      if (result.accessApplied === false) toast.warning(t.accessNotApplied);
      else if (mode === "invite" && result.emailSent === false)
        toast.warning(t.invitedNoMail);
      else if (mode === "link") toast.success(t.linked);
      else toast.success(activate ? t.invited : t.invitedInactive);
      closeDialog();
      router.refresh();
    } catch (caught) {
      if (caught instanceof AdminRequestError && caught.status === 401) {
        signInAgain(lang);
        return;
      }
      setError(
        caught instanceof AdminRequestError && caught.code === "email_exists"
          ? t.emailExists
          : caught instanceof AdminRequestError && caught.status === 409
            ? t.conflict
            : t.failed,
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" />
        {t.invite}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value && !pending) closeDialog();
        }}
      >
        <DialogContent showCloseButton={!pending} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{mode === "invite" ? t.invite : t.link}</DialogTitle>
            <DialogDescription>
              {mode === "invite" ? t.inviteHelp : t.linkHelp}
            </DialogDescription>
          </DialogHeader>
          <Segmented
            label={t.invite}
            value={mode}
            disabled={pending}
            onChange={(value) => {
              setMode(value);
              setTarget("");
              setError("");
            }}
            options={[
              { value: "invite", label: t.inviteMode },
              { value: "link", label: t.linkMode },
            ]}
          />
          <form onSubmit={submit} className="grid gap-4">
            <fieldset
              disabled={pending}
              className="m-0 grid gap-4 border-0 p-0"
            >
              <FormField label={t.name} htmlFor={nameId} hint={t.nameHelp}>
                <Input
                  id={nameId}
                  aria-describedby={`${nameId}-help`}
                  autoComplete="name"
                  value={name}
                  maxLength={100}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>
              <FormField
                label={mode === "invite" ? t.email : t.userId}
                htmlFor={`${nameId}-target`}
              >
                <Input
                  key={mode}
                  id={`${nameId}-target`}
                  type={mode === "invite" ? "email" : "text"}
                  autoComplete={mode === "invite" ? "email" : "off"}
                  value={target}
                  maxLength={mode === "invite" ? 254 : 36}
                  required
                  pattern={
                    mode === "link"
                      ? "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                      : undefined
                  }
                  onChange={(event) => setTarget(event.target.value)}
                />
              </FormField>
              <FormField label={t.inviteRole} hint={roleScope[role][lang]}>
                <AdminSelect
                  ariaLabel={t.inviteRole}
                  value={role}
                  disabled={pending}
                  options={staffRoles.map((r) => ({
                    value: r,
                    label: roleLabel[r][lang],
                  }))}
                  onChange={(value) => setRole(value as StaffRole)}
                />
              </FormField>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <Switch
                  checked={activate}
                  disabled={pending}
                  onCheckedChange={setActivate}
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <strong className="text-sm">{t.activateNow}</strong>
                  <span className="text-xs text-muted-foreground">
                    {t.activateNowHelp}
                  </span>
                </span>
              </label>
            </fieldset>
            <Alert>
              <LockKeyhole aria-hidden="true" />
              <AlertDescription>{t.inactive}</AlertDescription>
            </Alert>
            {error && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={closeDialog}
              >
                {t.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : null}
                {pending
                  ? mode === "invite"
                    ? t.sending
                    : t.linking
                  : mode === "invite"
                    ? t.sendInvite
                    : t.linkUser}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

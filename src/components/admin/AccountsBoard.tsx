"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  CircleAlert,
  History,
  Mail,
  MoreHorizontal,
  Trash2,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "./ui/empty-state";
import { EmptyValue } from "./ui/empty-value";
import { FormField } from "./ui/form-field";
import {
  useAdminRouter as useRouter,
  AdminLink as Link,
} from "./AdminNavigation";
import { AdminSelectCheckbox } from "./AdminSelectCheckbox";
import { BulkActionBar, BulkConfirmDialog } from "./BulkActionBar";
import { useRowSelection } from "@/lib/admin/useRowSelection";
import { tableContent } from "@/lib/admin/tableContent";
import { accountsActionContent } from "@/lib/admin/accountsActionContent";
import {
  sendStaffCommand,
  sendStaffPasswordReset,
  AdminRequestError,
  signInAgain,
} from "@/lib/admin/staffClient";
import { staffUiText } from "@/lib/admin/staffContent";
import { toast } from "sonner";
import { accountsContent } from "@/lib/admin/accountsContent";
import type { AdminAccount } from "@/lib/admin/adminAccounts";
import { roleLabel, type AdminLang } from "@/lib/admin/nav";
import type { StaffRole } from "@/server/auth/staff";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminSelect } from "./AdminSelect";
import { staffRoles, roleScope } from "@/lib/auth/permissions";
import { useAdminTimeZone } from "@/lib/admin/useAdminTimeZone";

type Props = {
  accounts: AdminAccount[];
  lang: AdminLang;
  currentUserId: string;
};

const roles = staffRoles;

// Present account identity, permissions and available actions as separate table columns.
// Access changes require an explicit review while retaining the existing versioned commands.
export function AccountsBoard({ accounts, lang, currentUserId }: Props) {
  const t = accountsContent[lang],
    messages = staffUiText[lang],
    router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    account: AdminAccount;
    role: StaffRole;
    active: boolean;
  } | null>(null);
  const [accessError, setAccessError] = useState("");
  const [resetPending, setResetPending] = useState(false);
  // Quick activate/deactivate from a row, and the same for a selection of rows.
  const [quick, setQuick] = useState<{
    account: AdminAccount;
    active: boolean;
  } | null>(null);
  // Permanent removal of a deactivated member, confirmed in its own dialog.
  const [removing, setRemoving] = useState<AdminAccount | null>(null);
  const [bulkActive, setBulkActive] = useState<boolean | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [operations, setOperations] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const requests = useRef(
    new Map<string, { fingerprint: string; id: string }>(),
  );
  const { timeZone } = useAdminTimeZone();
  const dates = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  // Keep provider reconciliation visible independently of the stored active status.
  // A completed local change may still need the existing synchronization retry.
  const pendingOperation = (account: AdminAccount) =>
    operations[account.id] ?? account.pendingOperationId ?? undefined;
  // Your own account and accounts mid-synchronization are never offered for selection.
  const selectable = accounts.filter(
    (account) => account.id !== currentUserId && !pendingOperation(account),
  );
  const selection = useRowSelection(
    selectable.map((account) => account.id),
    selectable.map((account) => account.id).join(","),
  );
  const tt = tableContent[lang];
  const ta = accountsActionContent[lang];
  const selectedAccounts = selectable.filter((account) =>
    selection.isSelected(account.id),
  );
  const bulkTargets = (active: boolean) =>
    selectedAccounts.filter((account) => account.active !== active);

  // Each member is changed in turn with their own version and request ID, through
  // the same audited command as a single change. The database still refuses to lock
  // out the last administrator or anyone changed since this page loaded.
  async function runBulk(active: boolean) {
    const targets = bulkTargets(active);
    setBulkPending(true);
    let ok = 0;
    let syncing = 0;
    for (const account of targets) {
      try {
        const result = await sendStaffCommand({
          action: "change",
          userId: account.id,
          role: account.role,
          active,
          expectedVersion: account.version,
          requestId: crypto.randomUUID(),
        });
        ok++;
        if (result.providerSync === "pending") syncing++;
      } catch (error) {
        if (error instanceof AdminRequestError && error.status === 401) {
          signInAgain(lang);
          return;
        }
      }
    }
    const failed = targets.length - ok;
    if (!failed)
      toast.success(ta.done(ok) + (syncing ? ta.syncPending(syncing) : ""));
    else if (ok) toast.error(ta.partial(ok, failed));
    else toast.error(ta.failed);
    setBulkPending(false);
    setBulkActive(null);
    selection.clear();
    router.refresh();
  }
  // Submit access changes and reconciliation through the existing staff endpoint.
  // Self-protection, versions and stable retry IDs preserve the backend safeguards.
  async function change(
    account: AdminAccount,
    role: StaffRole,
    active: boolean,
    operationId?: string,
  ) {
    if (inFlight.current || account.id === currentUserId) return false;
    inFlight.current = true;
    setPending(account.id);
    const command = operationId
      ? { action: "reconcile", operationId }
      : {
          action: "change",
          userId: account.id,
          role,
          active,
          expectedVersion: account.version,
        };
    const fingerprint = JSON.stringify(command);
    if (requests.current.get(account.id)?.fingerprint !== fingerprint)
      requests.current.set(account.id, {
        fingerprint,
        id: crypto.randomUUID(),
      });
    try {
      const result = await sendStaffCommand({
        ...command,
        requestId: requests.current.get(account.id)!.id,
      });
      requests.current.delete(account.id);
      setOperations((current) => {
        const next = { ...current };
        if (result.providerSync === "pending" && result.operationId)
          next[account.id] = result.operationId;
        else delete next[account.id];
        return next;
      });
      toast(
        result.providerSync === "pending" ? messages.pending : messages.success,
      );
      router.refresh();
      return true;
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        signInAgain(lang);
        return false;
      }
      const message =
        error instanceof AdminRequestError && error.status === 409
          ? messages.conflict
          : messages.failed;
      if (editing) setAccessError(message);
      else toast.error(message);
      router.refresh();
      return false;
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }
  // Deletes a deactivated member. The database refuses active members, yourself
  // and anyone with audit history, jobs or content tied to them; those cases are
  // explained rather than reported as a generic failure.
  async function remove(account: AdminAccount) {
    if (inFlight.current || account.id === currentUserId || account.active)
      return;
    inFlight.current = true;
    setPending(account.id);
    const fingerprint = JSON.stringify(["delete", account.id, account.version]);
    if (requests.current.get(account.id)?.fingerprint !== fingerprint)
      requests.current.set(account.id, {
        fingerprint,
        id: crypto.randomUUID(),
      });
    try {
      const result = await sendStaffCommand({
        action: "delete",
        userId: account.id,
        expectedVersion: account.version,
        requestId: requests.current.get(account.id)!.id,
      });
      requests.current.delete(account.id);
      if (result.providerDeleted === false)
        toast.warning(messages.deletedAuthLeft);
      else toast.success(messages.deleted);
      setRemoving(null);
      router.refresh();
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        signInAgain(lang);
        return;
      }
      toast.error(
        error instanceof AdminRequestError && error.code === "has_records"
          ? messages.deleteHasRecords
          : error instanceof AdminRequestError && error.status === 409
            ? messages.conflict
            : messages.deleteFailed,
      );
      setRemoving(null);
      router.refresh();
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }
  // Save only after the administrator reviews both role and activation together.
  // Failed requests leave the dialog open with its values intact for correction or review.
  async function saveAccess(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setAccessError("");
    if (await change(editing.account, editing.role, editing.active))
      setEditing(null);
  }

  async function handlePasswordReset() {
    if (!editing || resetPending) return;
    setResetPending(true);
    try {
      await sendStaffPasswordReset(editing.account.id, lang);
      toast.success(messages.passwordResetSent);
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        signInAgain(lang);
        return;
      }
      toast.error(messages.failed);
    } finally {
      setResetPending(false);
    }
  }

  return (
    <>
      <Card variant="panel" className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 className="m-0 text-[15px] font-semibold">{messages.members}</h2>
          <span className="text-xs text-muted-foreground">{timeZone}</span>
        </div>
        <BulkActionBar
          lang={lang}
          count={selection.count}
          busy={bulkPending}
          onClear={selection.clear}
        >
          {([false, true] as const).map((active) =>
            bulkTargets(active).length ? (
              <Button
                key={String(active)}
                variant="outline"
                size="sm"
                disabled={bulkPending}
                onClick={() => setBulkActive(active)}
              >
                {active ? ta.activate : ta.deactivate} (
                {bulkTargets(active).length})
              </Button>
            ) : null,
          )}
        </BulkActionBar>
        <div aria-busy={!!pending}>
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <AdminSelectCheckbox
                    label={tt.selectAll}
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    disabled={selectable.length === 0}
                    onChange={selection.toggleAll}
                  />
                </TableHead>
                <TableHead>{t.columns.member}</TableHead>
                <TableHead>{t.columns.role}</TableHead>
                <TableHead>{t.columns.scope}</TableHead>
                <TableHead>{t.columns.lastLogin}</TableHead>
                <TableHead>{t.columns.status}</TableHead>
                <TableHead className="text-right">{messages.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => {
                const isSelf = account.id === currentUserId;
                const syncing = pendingOperation(account);
                const locked = !!pending || isSelf || !!syncing;
                return (
                  <TableRow
                    key={account.id}
                    data-selected={selection.isSelected(account.id)}
                  >
                    <TableCell>
                      {isSelf || syncing ? null : (
                        <AdminSelectCheckbox
                          label={`${ta.selectRow}: ${account.name}`}
                          checked={selection.isSelected(account.id)}
                          onChange={() => selection.toggle(account.id)}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8 bg-accent" aria-hidden="true">
                          <AvatarFallback className="bg-accent text-[13px] font-bold text-primary">
                            {account.name.slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">
                            {account.name}
                          </span>
                          <span className="mt-0.5 block text-xs break-all text-muted-foreground">
                            {account.email}
                          </span>
                          {isSelf && (
                            <Badge
                              tone="accent"
                              className="mt-1 px-1.5 py-0.5 text-[11px]"
                            >
                              {messages.you}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        tone={account.role === "ADMIN" ? "accent" : "gray"}
                      >
                        {roleLabel[account.role][lang]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-64 text-xs leading-relaxed text-muted-foreground">
                      {account.scope[lang]}
                    </TableCell>
                    <TableCell title={timeZone}>
                      {Number.isFinite(Date.parse(account.lastLogin[lang])) ? (
                        dates.format(new Date(account.lastLogin[lang]))
                      ) : (
                        <EmptyValue />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1.5">
                        <Badge tone={account.active ? "green" : "gray"}>
                          {account.active ? t.active : t.disabled}
                        </Badge>
                        {syncing && (
                          <Badge tone="amber" role="status">
                            {messages.syncStatus}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {syncing && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!!pending || isSelf}
                            onClick={() =>
                              change(
                                account,
                                account.role,
                                account.active,
                                syncing,
                              )
                            }
                          >
                            <RefreshCw aria-hidden="true" />
                            {messages.retry}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={locked}
                          title={isSelf ? messages.self : undefined}
                          aria-label={`${messages.manage}: ${account.name}`}
                          onClick={() => {
                            setEditing({
                              account,
                              role: account.role,
                              active: account.active,
                            });
                            setAccessError("");
                          }}
                        >
                          <ShieldCheck aria-hidden="true" />
                          {messages.manage}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${messages.actions}: ${account.name}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={locked}
                              aria-label={`${account.active ? ta.deactivate : ta.activate}: ${account.name}`}
                              onClick={() =>
                                setQuick({ account, active: !account.active })
                              }
                            >
                              {account.active ? (
                                <UserX aria-hidden="true" />
                              ) : (
                                <UserCheck aria-hidden="true" />
                              )}
                              {account.active ? ta.deactivate : ta.activate}
                            </DropdownMenuItem>
                            {!account.active && !isSelf ? (
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={locked}
                                aria-label={`${messages.delete}: ${account.name}`}
                                onClick={() => setRemoving(account)}
                              >
                                <Trash2 aria-hidden="true" />
                                {messages.delete}
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              render={
                                <Link
                                  href={`/admin/log?lang=${lang}&actorId=${account.id}`}
                                  title={ta.activityHint}
                                  aria-label={`${ta.activity}: ${account.name}`}
                                >
                                  <History aria-hidden="true" />
                                  {ta.activity}
                                </Link>
                              }
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {!accounts.length && <EmptyState icon={Users} title={messages.empty} />}
      </Card>
      <BulkConfirmDialog
        lang={lang}
        open={quick !== null}
        title={
          quick
            ? quick.active
              ? ta.activateTitle(quick.account.name)
              : ta.deactivateTitle(quick.account.name)
            : ""
        }
        description={
          quick ? (quick.active ? ta.activateBody : ta.deactivateBody) : ""
        }
        confirmLabel={quick?.active ? ta.activate : ta.deactivate}
        destructive={quick?.active === false}
        pending={!!pending}
        onConfirm={async () => {
          if (!quick) return;
          await change(quick.account, quick.account.role, quick.active);
          setQuick(null);
        }}
        onCancel={() => setQuick(null)}
      />
      <BulkConfirmDialog
        lang={lang}
        open={removing !== null}
        title={removing ? `${messages.deleteTitle} (${removing.name})` : ""}
        description={messages.deleteBody}
        confirmLabel={messages.deleteConfirm}
        destructive
        pending={!!pending}
        onConfirm={() => removing && void remove(removing)}
        onCancel={() => setRemoving(null)}
      />
      <BulkConfirmDialog
        lang={lang}
        open={bulkActive !== null}
        title={
          bulkActive === null
            ? ""
            : bulkActive
              ? ta.bulkActivateTitle(bulkTargets(true).length)
              : ta.bulkDeactivateTitle(bulkTargets(false).length)
        }
        description={
          bulkActive === null
            ? ""
            : (bulkActive ? ta.bulkActivateBody : ta.bulkDeactivateBody) +
              (selectedAccounts.length > bulkTargets(bulkActive).length
                ? ta.skipped(
                    selectedAccounts.length - bulkTargets(bulkActive).length,
                  )
                : "")
        }
        confirmLabel={bulkActive ? ta.activate : ta.deactivate}
        destructive={bulkActive === false}
        pending={bulkPending}
        onConfirm={() => bulkActive !== null && void runBulk(bulkActive)}
        onCancel={() => setBulkActive(null)}
      />
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setEditing(null);
            setAccessError("");
          }
        }}
      >
        <DialogContent showCloseButton={!pending} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{messages.manage}</DialogTitle>
            <DialogDescription>{messages.manageDescription}</DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={saveAccess} className="grid gap-4">
              <div className="flex flex-col gap-0.5 rounded-lg bg-muted px-3 py-2.5">
                <strong className="text-sm">{editing.account.name}</strong>
                <span className="text-xs text-muted-foreground">
                  {editing.account.email}
                </span>
              </div>
              <FormField
                label={messages.role}
                hint={roleScope[editing.role][lang]}
              >
                <AdminSelect
                  ariaLabel={messages.role}
                  value={editing.role}
                  disabled={!!pending}
                  options={roles.map((role) => ({
                    value: role,
                    label: roleLabel[role][lang],
                  }))}
                  onChange={(role) =>
                    setEditing({ ...editing, role: role as StaffRole })
                  }
                />
              </FormField>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <Switch
                  checked={editing.active}
                  disabled={!!pending}
                  onCheckedChange={(checked) =>
                    setEditing({ ...editing, active: checked })
                  }
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <strong className="text-sm">{messages.access}</strong>
                  <span className="text-xs text-muted-foreground">
                    {messages.accessHelp}
                  </span>
                </span>
              </label>
              {accessError && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{accessError}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!pending}
                  onClick={() => setEditing(null)}
                >
                  {messages.cancel}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !!pending ||
                    (editing.role === editing.account.role &&
                      editing.active === editing.account.active)
                  }
                >
                  {pending ? messages.saving : messages.saveChanges}
                </Button>
              </DialogFooter>
              <Separator />
              <div className="flex flex-col items-start gap-2">
                <p className="m-0 text-xs text-muted-foreground">
                  {messages.changePasswordHelp}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!pending || resetPending}
                  onClick={handlePasswordReset}
                >
                  <Mail aria-hidden="true" />
                  {resetPending
                    ? messages.sendingReset
                    : messages.changePassword}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

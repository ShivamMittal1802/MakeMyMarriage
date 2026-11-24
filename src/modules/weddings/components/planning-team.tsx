"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Icon } from "@/components/landing/landing-icons";
import {
  ApiClientError,
  getJson,
  getResponse,
  mutateJson,
  postJson,
} from "@/lib/http/client";
import {
  memberInviteSchema,
  type InviteDto,
  type MemberDto,
  type MemberRole,
  type ListPage,
  type WeddingDto,
} from "../schemas";
import styles from "./planning-team.module.css";

const roles: MemberRole[] = ["manager", "bride", "groom"];
const labels: Record<MemberRole, string> = {
  manager: "Manager",
  bride: "Bride",
  groom: "Groom",
};
const permission = (role: MemberRole, owner = false) =>
  owner || role !== "manager"
    ? "Wedding planning and team management"
    : "Collaborate on wedding content";
function date(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase();
}
type DialogState =
  | { kind: "invite" }
  | { kind: "share"; invite: InviteDto; url: string }
  | { kind: "role"; member: MemberDto }
  | { kind: "remove"; member: MemberDto }
  | { kind: "revoke"; invite: InviteDto };
type Account = {
  membership: { weddingId: string; role: MemberRole; isOwner: boolean } | null;
};

export function PlanningTeam({
  wedding,
  currentUserId,
  currentRole,
  isOwner,
  initialMembers,
  initialInvitations,
}: {
  wedding: WeddingDto;
  currentUserId: string;
  currentRole: MemberRole;
  isOwner: boolean;
  initialMembers: ListPage<MemberDto>;
  initialInvitations: ListPage<InviteDto> | null;
}) {
  const router = useRouter();
  const base = `/api/v1/weddings/${wedding.id}`;
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [admin, setAdmin] = useState(isOwner || currentRole !== "manager");
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("manager");
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");
  const [mustRefresh, setMustRefresh] = useState(false);
  const [lostAccess, setLostAccess] = useState(false);
  const [expiryClock, setExpiryClock] = useState(0);
  const modal = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const sequence = useRef({ value: 0 });
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    const run = ++sequence.current.value;
    setRefreshing(true);
    setError("");
    try {
      const account = await getJson<Account>("/api/v1/me");
      if (run !== sequence.current.value) return false;
      if (account.membership?.weddingId !== wedding.id) {
        setLostAccess(true);
        setDialog(null);
        setInvitations(null);
        return false;
      }
      const allowed =
        account.membership.isOwner || account.membership.role !== "manager";
      setAdmin(allowed);
      if (!allowed) {
        setInvitations(null);
        setTab("members");
        setDialog(null);
      }
      const roster = await getResponse<ListPage<MemberDto>>(
        `${base}/members?status=active`,
      );
      const invited = allowed
        ? await getResponse<ListPage<InviteDto>>(
            `${base}/member-invitations?status=pending`,
          )
        : null;
      if (run !== sequence.current.value) return false;
      setMembers(roster);
      setInvitations(invited);
      setMustRefresh(false);
      return true;
    } catch (failure) {
      if (run !== sequence.current.value) return false;
      if (
        failure instanceof ApiClientError &&
        ["AUTHENTICATION_REQUIRED", "FORBIDDEN", "NOT_FOUND"].includes(
          failure.code,
        )
      ) {
        setInvitations(null);
        setDialog(null);
        setLostAccess(true);
      } else
        setError(
          failure instanceof Error
            ? failure.message
            : "Unable to load your planning team. Please retry.",
        );
      return false;
    } finally {
      if (run === sequence.current.value) setRefreshing(false);
    }
  }, [base, wedding.id]);
  useEffect(() => {
    const requests = sequence.current;
    const focused = () => {
      if (!busy.current && !modal.current?.open) void refresh();
    };
    const outside = (event: PointerEvent) => {
      for (const menu of panel.current?.querySelectorAll<HTMLDetailsElement>(
        "details[data-team-menu][open]",
      ) ?? [])
        if (event.target instanceof Node && !menu.contains(event.target))
          menu.open = false;
    };
    const initialRefresh = setTimeout(focused, 0);
    window.addEventListener("focus", focused);
    document.addEventListener("pointerdown", outside);
    return () => {
      clearTimeout(initialRefresh);
      window.removeEventListener("focus", focused);
      document.removeEventListener("pointerdown", outside);
      requests.value++;
    };
  }, [refresh]);
  useEffect(() => {
    const nextExpiry = Math.min(
      ...[
        ...(invitations?.data ?? []),
        ...(dialog && (dialog.kind === "share" || dialog.kind === "revoke")
          ? [dialog.invite]
          : []),
      ]
        .filter((item) => item.status === "pending")
        .map((item) => Date.parse(item.expiresAt))
        .filter((time) => time > expiryClock),
    );
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(
      () => setExpiryClock(Date.now()),
      Math.min(2_147_483_647, Math.max(1, nextExpiry - Date.now() + 1)),
    );
    return () => clearTimeout(timer);
  }, [invitations, expiryClock, dialog]);
  useEffect(() => {
    if (dialog && !modal.current?.open) modal.current?.showModal();
    else if (!dialog && modal.current?.open) modal.current.close();
  }, [dialog]);
  function open(next: DialogState) {
    if (busy.current) return;
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    for (const menu of panel.current?.querySelectorAll<HTMLDetailsElement>(
      "details[data-team-menu][open]",
    ) ?? [])
      menu.open = false;
    setDialogError("");
    setNotice("");
    setMustRefresh(false);
    if (next.kind === "invite") {
      setEmail("");
      setRole("manager");
    }
    if (next.kind === "role") setRole(next.member.role);
    setDialog(next);
  }
  function close() {
    if (busy.current) return;
    setDialog(null);
    setDialogError("");
    setMustRefresh(false);
    requestAnimationFrame(() => {
      if (opener.current?.isConnected && opener.current.getClientRects().length)
        opener.current.focus();
      else title.current?.focus();
    });
  }
  function failureMessage(failure: unknown) {
    const text =
      failure instanceof Error
        ? failure.message
        : "Unable to complete the request. Please try again.";
    setDialogError(text);
    if (
      failure instanceof ApiClientError &&
      [
        "REQUEST_UNCONFIRMED",
        "INTERNAL_ERROR",
        "DEPENDENCY_UNAVAILABLE",
        "VERSION_CONFLICT",
        "MEMBERSHIP_CHANGED",
        "ACCOUNT_CHANGED",
        "INVITATION_ACCEPTED",
        "LINK_UNAVAILABLE",
        "NOT_FOUND",
      ].includes(failure.code)
    )
      setMustRefresh(true);
    if (
      failure instanceof ApiClientError &&
      [
        "AUTHENTICATION_REQUIRED",
        "FORBIDDEN",
        "EMAIL_VERIFICATION_REQUIRED",
      ].includes(failure.code)
    ) {
      setMustRefresh(true);
      void refresh();
    }
  }
  async function share(invite: InviteDto, preserveOpener = false) {
    if (busy.current) return;
    if (!preserveOpener) open({ kind: "share", invite, url: "" });
    busy.current = true;
    setPending(true);
    setDialogError("");
    try {
      const result = await postJson<{ url: string; expiresAt: string }>(
        `${base}/member-invitations/${invite.id}/share-link`,
        {},
      );
      setDialog({
        kind: "share",
        invite: { ...invite, expiresAt: result.expiresAt },
        url: result.url,
      });
      await refresh();
    } catch (failure) {
      failureMessage(failure);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !dialog || mustRefresh) return;
    if (dialog.kind === "invite") {
      const parsed = memberInviteSchema.safeParse({ email, role });
      if (!parsed.success) {
        setDialogError(parsed.error.issues[0].message);
        document.getElementById("team-invite-email")?.focus();
        return;
      }
      busy.current = true;
      setPending(true);
      setDialogError("");
      let created: InviteDto | undefined;
      try {
        created = await postJson<InviteDto>(
          `${base}/member-invitations`,
          parsed.data,
        );
        setNotice("Invitation created. No email has been sent.");
        setDialog({ kind: "share", invite: created, url: "" });
        setTab("invitations");
        if (!(await refresh())) created = undefined;
      } catch (failure) {
        failureMessage(failure);
      } finally {
        busy.current = false;
        setPending(false);
      }
      if (created) await share(created, true);
      return;
    }
    if (dialog.kind === "share") return;
    busy.current = true;
    setPending(true);
    setDialogError("");
    try {
      if (dialog.kind === "role") {
        await mutateJson<MemberDto>(
          `${base}/members/${dialog.member.id}`,
          "PATCH",
          { role, expectedVersion: dialog.member.version },
        );
        setNotice("Member role updated.");
      } else if (dialog.kind === "remove") {
        await mutateJson(
          `${base}/members/${dialog.member.id}?expectedVersion=${dialog.member.version}`,
          "DELETE",
        );
        if (dialog.member.userId === currentUserId) {
          router.replace("/onboarding");
          router.refresh();
          return;
        }
        setNotice("Member removed. Their existing contributions remain.");
      } else {
        await mutateJson(
          `${base}/member-invitations/${dialog.invite.id}?expectedVersion=${dialog.invite.version}`,
          "DELETE",
        );
        setNotice("Invitation revoked.");
      }
      setDialog(null);
      await refresh();
    } catch (failure) {
      failureMessage(failure);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function loadMore() {
    if (more || refreshing || busy.current) return;
    const run = sequence.current.value;
    const cursor =
      tab === "members"
        ? members.page.nextCursor
        : invitations?.page.nextCursor;
    if (!cursor) return;
    setMore(true);
    setError("");
    try {
      if (tab === "members") {
        const next = await getResponse<ListPage<MemberDto>>(
          `${base}/members?status=active&cursor=${encodeURIComponent(cursor)}`,
        );
        if (run === sequence.current.value)
          setMembers((previous) => ({
            data: [
              ...new Map(
                [...previous.data, ...next.data].map((item) => [item.id, item]),
              ).values(),
            ],
            page: next.page,
          }));
      } else {
        const next = await getResponse<ListPage<InviteDto>>(
          `${base}/member-invitations?status=pending&cursor=${encodeURIComponent(cursor)}`,
        );
        if (run === sequence.current.value)
          setInvitations((previous) => ({
            data: [
              ...new Map(
                [...(previous?.data ?? []), ...next.data].map((item) => [
                  item.id,
                  item,
                ]),
              ).values(),
            ],
            page: next.page,
          }));
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to load more. Your existing list is still available.",
      );
      if (
        failure instanceof ApiClientError &&
        ["FORBIDDEN", "NOT_FOUND", "AUTHENTICATION_REQUIRED"].includes(
          failure.code,
        )
      )
        void refresh();
    } finally {
      setMore(false);
    }
  }
  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Private link copied.");
    } catch {
      const input = document.getElementById(
        "team-private-link",
      ) as HTMLInputElement | null;
      input?.focus();
      input?.select();
      setDialogError("Select and copy the private link above.");
    }
  }
  if (lostAccess)
    return (
      <section className={styles.empty}>
        <Icon name="shield" />
        <h1>Your access to this wedding has changed.</h1>
        <p>Return to your account to see your current wedding access.</p>
        <Link className={styles.primary} href="/onboarding">
          Back to your account
        </Link>
        <Link href="/login">Log in</Link>
      </section>
    );
  const shown = tab === "members" ? members : invitations;
  const invitationExpired =
    !!dialog &&
    (dialog.kind === "share" || dialog.kind === "revoke") &&
    Date.parse(dialog.invite.expiresAt) <= expiryClock;
  const dialogTitle = !dialog
    ? ""
    : dialog.kind === "invite"
      ? "Invite someone to your planning team"
      : dialog.kind === "share"
        ? "Your invitation is ready"
        : dialog.kind === "role"
          ? "Change member role"
          : dialog.kind === "revoke"
            ? "Revoke this invitation?"
            : dialog.member.userId === currentUserId
              ? "Leave this wedding?"
              : `Remove ${dialog.member.name}?`;
  return (
    <section
      ref={panel}
      className={styles.page}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.target instanceof HTMLElement) {
          const menu = event.target.closest<HTMLDetailsElement>(
            "details[data-team-menu]",
          );
          if (menu?.open) {
            menu.open = false;
            menu.querySelector("summary")?.focus();
          }
        }
      }}
    >
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href={`/dashboard/${wedding.id}`}>My wedding</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Planning team</span>
      </nav>
      {!admin && (
        <aside className={styles.readOnly}>
          <Icon name="shield" />
          <p>
            You’re viewing the planning team as a <strong>Manager</strong>. The
            owner, bride, or groom can invite people and manage membership.
          </p>
          <span>Read-only roster</span>
        </aside>
      )}
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Your shared wedding space</p>
          <h1 ref={title} tabIndex={-1}>
            Bring your people into the planning.
          </h1>
          <p>
            Invite your partner, family, and trusted friends to help organise
            your celebration.
          </p>
        </div>
        <span className={styles.weddingPill}>
          <Icon name="heart" />
          {wedding.couple.brideName} &amp; {wedding.couple.groomName}
        </span>
      </div>
      <div className={styles.toolbar}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Planning team lists"
          onKeyDown={(event) => {
            if (
              admin &&
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "members"
                  : event.key === "End"
                    ? "invitations"
                    : tab === "members"
                      ? "invitations"
                      : "members";
              setTab(next);
              document.getElementById(`team-tab-${next}`)?.focus();
            }
          }}
        >
          <button
            id="team-tab-members"
            role="tab"
            aria-controls="team-list"
            aria-selected={tab === "members"}
            tabIndex={tab === "members" ? 0 : -1}
            onClick={() => {
              setTab("members");
              setError("");
            }}
          >
            <Icon name="people" />
            Members
          </button>
          {admin && (
            <button
              id="team-tab-invitations"
              role="tab"
              aria-controls="team-list"
              aria-selected={tab === "invitations"}
              tabIndex={tab === "invitations" ? 0 : -1}
              onClick={() => {
                setTab("invitations");
                setError("");
              }}
            >
              <Icon name="mail" />
              Pending invitations
            </button>
          )}
        </div>
        <div className={styles.toolbarActions}>
          <button
            className={styles.textButton}
            disabled={refreshing || pending}
            onClick={() => void refresh()}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          {admin && (
            <button
              className={styles.primary}
              disabled={pending || refreshing}
              onClick={() => open({ kind: "invite" })}
            >
              <span aria-hidden="true">＋</span>Invite a member
            </button>
          )}
        </div>
      </div>
      {notice && !dialog && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button
            className={styles.textButton}
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            Retry refresh
          </button>
        </div>
      )}
      <div
        id="team-list"
        role="tabpanel"
        aria-labelledby={`team-tab-${tab}`}
        aria-busy={refreshing || more}
        className={styles.listCard}
      >
        {tab === "members" ? (
          <>
            <div
              className={`${styles.memberRow} ${styles.tableHead}`}
              aria-hidden="true"
            >
              <span>Member</span>
              <span>Role</span>
              <span>Permissions</span>
              <span>Joined date</span>
              <span>{admin ? "Actions" : ""}</span>
            </div>
            <ul className={styles.list}>
              {members.data.map((member) => (
                <li
                  key={member.id}
                  className={`${styles.memberRow} ${member.userId === currentUserId ? styles.youRow : ""}`}
                >
                  <div className={styles.person}>
                    <span className={styles.avatar} aria-hidden="true">
                      {initials(member.name)}
                    </span>
                    <div>
                      <strong>{member.name}</strong>
                      {member.userId === currentUserId && (
                        <span className={styles.youBadge}>You</span>
                      )}
                    </div>
                  </div>
                  <div className={styles.badges}>
                    <span className={styles.roleBadge}>
                      {member.role !== "manager" && <Icon name="heart" />}
                      {labels[member.role]}
                    </span>
                    {member.isOwner && (
                      <span className={styles.ownerBadge}>Owner</span>
                    )}
                  </div>
                  <p className={styles.permissions}>
                    {permission(member.role, member.isOwner)}
                  </p>
                  <p className={styles.joined}>
                    <span className={styles.mobileLabel}>Joined </span>
                    {date(member.joinedAt)}
                  </p>
                  {admin ? (
                    member.isOwner ? (
                      <span
                        className={styles.locked}
                        title="Ownership and the owner’s role cannot be changed."
                      >
                        <Icon name="shield" />
                        <span className={styles.srOnly}>
                          Ownership and the owner’s role cannot be changed.
                        </span>
                      </span>
                    ) : (
                      <details className={styles.rowMenu} data-team-menu>
                        <summary aria-label={`Actions for ${member.name}`}>
                          ⋯
                        </summary>
                        <div>
                          <button
                            disabled={pending || refreshing}
                            onClick={() => open({ kind: "role", member })}
                          >
                            Change role
                          </button>
                          <button
                            className={styles.dangerText}
                            disabled={pending || refreshing}
                            onClick={() => open({ kind: "remove", member })}
                          >
                            {member.userId === currentUserId
                              ? "Leave wedding"
                              : "Remove member"}
                          </button>
                        </div>
                      </details>
                    )
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
            {members.data.length === 1 && members.data[0].isOwner && (
              <div className={styles.onlyOwner}>
                <p>Your people make the planning lighter.</p>
                <span>
                  Invite your partner, family, or trusted friends when you’re
                  ready.
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            <div
              className={`${styles.inviteRow} ${styles.tableHead}`}
              aria-hidden="true"
            >
              <span>Invited email</span>
              <span>Role</span>
              <span>Created / expires</span>
              <span>Actions</span>
            </div>
            <ul className={styles.list}>
              {invitations?.data.map((invite) => {
                const available =
                  invite.status === "pending" &&
                  Date.parse(invite.expiresAt) > expiryClock;
                return (
                  <li className={styles.inviteRow} key={invite.id}>
                    <div className={styles.invitePerson}>
                      <strong>{invite.email}</strong>
                      <span className={styles.pendingBadge}>
                        {available ? "Pending" : "Unavailable"}
                      </span>
                    </div>
                    <span className={styles.roleBadge}>
                      {labels[invite.role]}
                    </span>
                    <div className={styles.inviteDates}>
                      <span>Created {date(invite.createdAt)}</span>
                      <span>Expires {date(invite.expiresAt)}</span>
                    </div>
                    <div className={styles.inviteActions}>
                      <button
                        className={styles.textButton}
                        disabled={!available || pending || refreshing}
                        onClick={() => void share(invite)}
                      >
                        Share link
                      </button>
                      <button
                        className={`${styles.textButton} ${styles.dangerText}`}
                        disabled={!available || pending || refreshing}
                        onClick={() => open({ kind: "revoke", invite })}
                      >
                        Revoke
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {!invitations?.data.length && (
              <div className={styles.empty}>
                <Icon name="mail" />
                <h2>No invitations waiting.</h2>
                <p>
                  Create a private invitation when you’re ready to bring someone
                  into the planning.
                </p>
                <button
                  className={styles.primary}
                  onClick={() => open({ kind: "invite" })}
                >
                  Invite a member
                </button>
              </div>
            )}
          </>
        )}
        {!!shown?.data.length && (
          <div className={styles.pagination}>
            <span>
              Showing {shown.data.length}{" "}
              {tab === "members" ? "members" : "invitations"}
            </span>
            {shown.page.hasMore && (
              <button
                className={styles.secondary}
                disabled={more || refreshing || pending}
                onClick={() => void loadMore()}
              >
                {more ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}
      </div>
      <aside className={styles.accessNote}>
        <Icon name="shield" />
        <div>
          <h2>A little clarity on access.</h2>
          <p>
            The owner, bride, and groom can manage the planning team. Managers
            can collaborate on wedding content. Guests use separate private
            links to RSVP or share photos.
          </p>
        </div>
      </aside>
      <dialog
        ref={modal}
        className={`${styles.dialog} ${dialog?.kind === "invite" ? styles.inviteDialog : ""} ${dialog?.kind === "share" ? styles.shareDialog : ""}`}
        aria-labelledby="team-dialog-title"
        aria-describedby="team-dialog-description"
        onCancel={(event) => {
          if (busy.current) event.preventDefault();
          else close();
        }}
        onClose={() => {
          if (!busy.current) setDialog(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        {dialog && (
          <form onSubmit={(event) => void submit(event)} noValidate>
            <div className={styles.dialogBody}>
              <button
                className={styles.closeButton}
                type="button"
                aria-label="Close dialog"
                disabled={pending}
                onClick={close}
              >
                <Icon name="close" />
              </button>
              <p className={styles.eyebrow}>
                {dialog.kind === "invite" || dialog.kind === "share"
                  ? "Planning team invitation"
                  : "Planning team"}
              </p>
              <h2 id="team-dialog-title">{dialogTitle}</h2>
              <p
                id="team-dialog-description"
                className={styles.dialogDescription}
              >
                {dialog.kind === "invite"
                  ? "A little help. A lot of love."
                  : dialog.kind === "share"
                    ? "Invitation created. No email has been sent."
                    : dialog.kind === "role"
                      ? `Update ${dialog.member.name}’s role. Current role: ${labels[dialog.member.role]}.`
                      : dialog.kind === "revoke"
                        ? "The current invitation link will stop working. This person won’t be able to join using it."
                        : "They’ll lose access to this wedding. Their existing contributions will remain."}
              </p>
              {dialog.kind === "invite" && (
                <div className={styles.field}>
                  <label htmlFor="team-invite-email">Email address</label>
                  <input
                    id="team-invite-email"
                    type="email"
                    autoComplete="off"
                    required
                    maxLength={254}
                    value={email}
                    disabled={pending}
                    onChange={(event) => setEmail(event.target.value)}
                    aria-invalid={!!dialogError}
                  />
                  <p className={styles.small}>
                    The recipient must sign in with this email address to
                    accept.
                  </p>
                </div>
              )}
              {(dialog.kind === "invite" || dialog.kind === "role") && (
                <fieldset
                  disabled={pending}
                  className={`${styles.roleOptions} ${dialog.kind === "invite" ? styles.roleCards : ""}`}
                >
                  <legend>
                    {dialog.kind === "invite"
                      ? "Their role"
                      : "Select new role"}
                  </legend>
                  {roles.map((item) => (
                    <label key={item}>
                      <input
                        type="radio"
                        name="team-role"
                        checked={role === item}
                        value={item}
                        onChange={() => setRole(item)}
                      />
                      <span>
                        <strong>{labels[item]}</strong>
                        {dialog.kind === "role" && (
                          <small>{permission(item)}</small>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {dialog.kind === "invite" && (
                <>
                  <p className={styles.info}>
                    {permission(role)}. Ownership is separate and cannot be
                    assigned through an invitation.
                  </p>
                  <p className={styles.small}>
                    Only one person can hold each Bride or Groom role. A role is
                    confirmed when the invitation is accepted.
                  </p>
                  <p className={styles.small}>
                    Creating an invitation does not send an email. You’ll
                    receive a private link to share.
                  </p>
                </>
              )}
              {dialog.kind === "role" && (
                <>
                  <p className={styles.small}>
                    Role availability is confirmed when saving. Changes take
                    effect immediately.
                  </p>
                  {dialog.member.userId === currentUserId &&
                    role === "manager" && (
                      <p className={styles.info}>
                        You’ll still be able to help plan this wedding, but
                        you’ll lose access to planning-team management.
                      </p>
                    )}
                </>
              )}
              {dialog.kind === "remove" && (
                <>
                  <div className={styles.subject}>
                    <span className={styles.avatar}>
                      {initials(dialog.member.name)}
                    </span>
                    <strong>{dialog.member.name}</strong>
                    <span className={styles.roleBadge}>
                      {labels[dialog.member.role]}
                    </span>
                  </div>
                  <p className={styles.small}>
                    {dialog.member.userId === currentUserId
                      ? "You’ll immediately lose access. You’ll"
                      : "They’ll"}{" "}
                    need a new invitation to join again. Pending invitations for{" "}
                    {dialog.member.userId === currentUserId ? "your" : "their"}{" "}
                    email in this wedding will be revoked.
                  </p>
                </>
              )}
              {(dialog.kind === "share" || dialog.kind === "revoke") && (
                <dl className={styles.inviteSummary}>
                  <div>
                    <dt>Intended for</dt>
                    <dd>{dialog.invite.email}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{labels[dialog.invite.role]}</dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>{date(dialog.invite.expiresAt)}</dd>
                  </div>
                </dl>
              )}
              {dialog.kind === "share" && (
                <>
                  {dialog.url && !invitationExpired ? (
                    <>
                      <div className={styles.field}>
                        <label htmlFor="team-private-link">
                          Private invitation link
                        </label>
                        <input
                          id="team-private-link"
                          value={dialog.url}
                          readOnly
                          onFocus={(event) => event.currentTarget.select()}
                        />
                      </div>
                      <div className={styles.shareActions}>
                        <button
                          className={styles.primary}
                          type="button"
                          onClick={() => void copyLink(dialog.url)}
                        >
                          Copy private link
                        </button>
                        <a
                          className={styles.secondary}
                          href={`https://wa.me/?text=${encodeURIComponent(`You’re invited to help plan our wedding. Sign in with the invited email address to accept: ${dialog.url}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Share on WhatsApp
                        </a>
                      </div>
                    </>
                  ) : (
                    <button
                      className={styles.secondary}
                      type="button"
                      disabled={pending || mustRefresh || invitationExpired}
                      onClick={() => void share(dialog.invite, true)}
                    >
                      {pending ? "Opening private link…" : "Get private link"}
                    </button>
                  )}
                  <p className={styles.small}>
                    Share only with the intended recipient. They must sign in
                    with the invited email address.
                  </p>
                </>
              )}
              {notice && (
                <p className={styles.notice} role="status">
                  {notice}
                </p>
              )}
              {invitationExpired && (
                <p className={styles.error}>
                  This invitation has expired. Refresh the list to see its
                  latest status.
                </p>
              )}
              {dialogError && (
                <p className={styles.error} role="alert">
                  {dialogError}
                </p>
              )}
            </div>
            <footer className={styles.dialogFooter}>
              <button
                type="button"
                className={styles.secondary}
                disabled={pending}
                onClick={close}
              >
                {dialog.kind === "share"
                  ? "Done"
                  : dialog.kind === "remove"
                    ? "Keep member"
                    : dialog.kind === "revoke"
                      ? "Keep invitation"
                      : "Cancel"}
              </button>
              {mustRefresh || invitationExpired ? (
                <button
                  className={styles.primary}
                  type="button"
                  disabled={pending || refreshing}
                  onClick={() => {
                    close();
                    void refresh();
                  }}
                >
                  Refresh latest details
                </button>
              ) : (
                dialog.kind !== "share" && (
                  <button
                    className={
                      dialog.kind === "remove" || dialog.kind === "revoke"
                        ? styles.danger
                        : styles.primary
                    }
                    type="submit"
                    disabled={
                      pending ||
                      (dialog.kind === "role" && role === dialog.member.role)
                    }
                  >
                    {pending
                      ? "Please wait…"
                      : dialog.kind === "invite"
                        ? "Create invitation"
                        : dialog.kind === "role"
                          ? "Save role"
                          : dialog.kind === "revoke"
                            ? "Revoke invitation"
                            : dialog.member.userId === currentUserId
                              ? "Leave wedding"
                              : "Remove member"}
                  </button>
                )
              )}
            </footer>
          </form>
        )}
      </dialog>
    </section>
  );
}

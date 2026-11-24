"use client";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/landing/landing-icons";
import { ApiClientError, postJson, getJson } from "@/lib/http/client";
import {
  weddingCreateSchema,
  type WeddingCreate,
  type WeddingDto,
  type MemberRole,
} from "../schemas";
import styles from "./onboarding.module.css";

import { roleLabels, displayDate } from "../format";
const initial: WeddingCreate = {
  couple: { brideName: "", groomName: "" },
  weddingDate: "",
  location: "",
  slug: "",
  introduction: "",
  creatorRole: "manager",
};
function suggestedSlug(bride: string, groom: string) {
  return [bride.trim().split(/\s+/)[0], groom.trim().split(/\s+/)[0]]
    .filter(Boolean)
    .join("-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 80);
}
export function StepIndicator({ step }: { step: number }) {
  return (
    <ol className={styles.steps} aria-label="Wedding setup progress">
      <li aria-current={step === 1 ? "step" : undefined}>
        <span>{step === 2 ? <Icon name="check" /> : "1"}</span>Wedding details
      </li>
      <li aria-current={step === 2 ? "step" : undefined}>
        <span>2</span>Review and create
      </li>
    </ol>
  );
}
function Preview({
  data,
  origin,
  mobile = false,
}: {
  data: WeddingCreate;
  origin: string;
  mobile?: boolean;
}) {
  const date = weddingCreateSchema.shape.weddingDate.safeParse(data.weddingDate)
    .success
    ? displayDate(data.weddingDate)
    : "Your wedding date";
  return (
    <aside
      className={mobile ? styles.mobilePreview : styles.preview}
      aria-label="Public wedding details preview"
    >
      {!mobile && (
        <div className={styles.previewImage}>
          <Image
            src="/images/onboarding/wedding-stationery.jpg"
            alt="Wedding stationery with jasmine and burgundy wax seals"
            fill
            sizes="360px"
          />
        </div>
      )}
      <div className={styles.previewContent}>
        <p className={styles.eyebrow}>Public wedding details preview</p>
        <h2>
          {data.couple.brideName || "Bride’s name"} &amp;{" "}
          {data.couple.groomName || "Groom’s name"}
        </h2>
        <p className={styles.iconLine}>
          <Icon name="calendar" />
          {date}
        </p>
        <p>{data.location || "Your wedding location"}</p>
        {data.introduction && (
          <p className={styles.previewIntro}>{data.introduction}</p>
        )}
        <div className={styles.urlPreview}>
          {origin}/weddings/<strong>{data.slug || "your-wedding"}</strong>
        </div>
      </div>
    </aside>
  );
}
export function OnboardingWizard({
  origin,
  email,
}: {
  origin: string;
  email: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<WeddingCreate>(initial);
  const [slugEdited, setSlugEdited] = useState(false);
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<WeddingDto | null>(null);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  function nameChanged(which: "brideName" | "groomName", value: string) {
    const couple = { ...data.couple, [which]: value };
    setData({
      ...data,
      couple,
      ...(!slugEdited
        ? { slug: suggestedSlug(couple.brideName, couple.groomName) }
        : {}),
    });
  }
  function showStep(value: number) {
    setStep(value);
    setError("");
    requestAnimationFrame(() => {
      title.current?.focus();
      title.current?.scrollIntoView({ behavior: "instant", block: "start" });
    });
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = weddingCreateSchema.safeParse(data);
    setError("");
    if (!parsed.success) {
      const errors = Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join("."),
          issue.message,
        ]),
      );
      setFields(errors);
      setError("Check the highlighted details before continuing.");
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    setData(parsed.data);
    setFields({});
    showStep(2);
  }
  async function create() {
    if (pending || uncertain) return;
    setPending(true);
    setError("");
    try {
      const wedding = await postJson<WeddingDto>("/api/v1/weddings", data);
      setCreated(wedding);
      requestAnimationFrame(() => title.current?.focus());
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
      if (failure instanceof ApiClientError) {
        if (failure.code === "SLUG_TAKEN") {
          setFields({ slug: "This address is already taken. Choose another." });
          setStep(1);
          requestAnimationFrame(() =>
            document.getElementById("wedding-slug")?.focus(),
          );
        } else if (
          [
            "REQUEST_UNCONFIRMED",
            "INTERNAL_ERROR",
            "DEPENDENCY_UNAVAILABLE",
          ].includes(failure.code)
        )
          setUncertain(true);
        else if (failure.code === "ACTIVE_MEMBERSHIP_EXISTS") setConflict(true);
        else if (
          failure.code === "EMAIL_VERIFICATION_REQUIRED" ||
          failure.code === "AUTHENTICATION_REQUIRED"
        )
          router.refresh();
      }
    } finally {
      setPending(false);
    }
  }
  async function checkStatus() {
    setPending(true);
    setError("");
    try {
      const account = await getJson<{
        membership: { weddingId: string } | null;
      }>("/api/v1/me");
      if (account.membership)
        router.replace(`/dashboard/${account.membership.weddingId}`);
      else {
        setUncertain(false);
        setError(
          "No wedding membership was found. You can try creating your wedding again.",
        );
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to check. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  if (created)
    return (
      <section className={styles.success}>
        <span className={styles.successEmblem}>
          <Icon name="check" />
        </span>
        <h1 ref={title} tabIndex={-1}>
          Your wedding space
          <br />
          is ready.
        </h1>
        <p>
          Here’s to a little less coordination.
          <br />
          And a lot more celebration.
        </p>
        <div className={styles.successSummary}>
          <p className={styles.eyebrow}>The celebration</p>
          <h2>
            {created.couple.brideName}
            <br />
            <span>&amp;</span> {created.couple.groomName}
          </h2>
          <p className={styles.iconLine}>
            <Icon name="calendar" />
            {displayDate(created.weddingDate)}
          </p>
          <div className={styles.ownerRow}>
            <span>{roleLabels[data.creatorRole]}</span>
            <span className={styles.badge}>Owner</span>
          </div>
        </div>
        <div className={styles.stackedActions}>
          <Link className={styles.primary} href={`/dashboard/${created.id}`}>
            Go to my wedding
          </Link>
          <Link
            className={styles.secondary}
            href={`/dashboard/${created.id}#planning-team`}
          >
            Invite your planning team
          </Link>
        </div>
        <p className={styles.small}>
          Bring your partner, family, or trusted friends into the planning.
        </p>
      </section>
    );
  const errorText = (path: string) =>
    fields[path] ? (
      <span
        id={`${path.replaceAll(".", "-")}-error`}
        className={styles.fieldError}
      >
        {fields[path]}
      </span>
    ) : null;
  const attr = (path: string) => ({
    "aria-invalid": !!fields[path],
    "aria-describedby": fields[path]
      ? `${path.replaceAll(".", "-")}-error`
      : undefined,
  });
  return (
    <>
      <div className={step === 2 ? styles.reviewHero : styles.hero}>
        <StepIndicator step={step} />
        <h1 ref={title} tabIndex={-1}>
          Let’s make space for your celebration.
        </h1>
        <p>
          {step === 1
            ? "Start with the essentials. You can add your celebrations and planning team afterward."
            : "A little review before your next chapter begins."}
        </p>
        {step === 1 && (
          <p className={styles.inviteNote}>
            Invited to help plan a wedding?{" "}
            <Link href="/join">
              Open the private invitation link shared with you.
            </Link>
          </p>
        )}
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {step === 1 ? (
        <div className={styles.setupGrid}>
          <form
            ref={form}
            className={styles.formCard}
            noValidate
            onSubmit={review}
          >
            <fieldset disabled={pending} className={styles.formFields}>
              <section className={styles.formSection}>
                <div className={styles.sectionHeading}>
                  <h2>The celebration</h2>
                  <span>Required</span>
                </div>
                <div className={styles.fieldGrid}>
                  <div className={styles.field}>
                    <label htmlFor="bride-name">
                      Bride’s name <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="bride-name"
                      name="brideName"
                      required
                      maxLength={150}
                      autoComplete="off"
                      value={data.couple.brideName}
                      onChange={(event) =>
                        nameChanged("brideName", event.target.value)
                      }
                      {...attr("couple.brideName")}
                    />
                    {errorText("couple.brideName")}
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="groom-name">
                      Groom’s name <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="groom-name"
                      name="groomName"
                      required
                      maxLength={150}
                      autoComplete="off"
                      value={data.couple.groomName}
                      onChange={(event) =>
                        nameChanged("groomName", event.target.value)
                      }
                      {...attr("couple.groomName")}
                    />
                    {errorText("couple.groomName")}
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="wedding-date">
                      Wedding date <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="wedding-date"
                      name="weddingDate"
                      type="date"
                      required
                      value={data.weddingDate}
                      onChange={(event) =>
                        setData({ ...data, weddingDate: event.target.value })
                      }
                      {...attr("weddingDate")}
                    />
                    {errorText("weddingDate")}
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="wedding-location">
                      Wedding location <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="wedding-location"
                      name="location"
                      required
                      maxLength={500}
                      placeholder="City, state or venue"
                      value={data.location}
                      onChange={(event) =>
                        setData({ ...data, location: event.target.value })
                      }
                      {...attr("location")}
                    />
                    {errorText("location")}
                  </div>
                </div>
                <details className={styles.introduction}>
                  <summary>
                    Introduction <span>(Optional)</span>
                  </summary>
                  <label className={styles.small} htmlFor="introduction">
                    A few words for your public wedding website.
                  </label>
                  <textarea
                    id="introduction"
                    name="introduction"
                    maxLength={5000}
                    rows={4}
                    value={data.introduction}
                    onChange={(event) =>
                      setData({ ...data, introduction: event.target.value })
                    }
                  />
                  <span className={styles.small}>
                    {data.introduction?.length ?? 0}/5,000
                  </span>
                </details>
              </section>
              <fieldset className={styles.formSection}>
                <legend>Your role</legend>
                <p className={styles.muted}>
                  You’ll be the wedding owner whichever role you choose. As
                  owner, you can invite your planning team and manage member
                  roles.
                </p>
                <div className={styles.roleGrid}>
                  {(["bride", "groom", "manager"] as MemberRole[]).map(
                    (role) => (
                      <label className={styles.roleCard} key={role}>
                        <input
                          type="radio"
                          name="creatorRole"
                          value={role}
                          checked={data.creatorRole === role}
                          onChange={() =>
                            setData({ ...data, creatorRole: role })
                          }
                        />
                        <Icon
                          name={role === "manager" ? "calendar" : "heart"}
                        />
                        <span>{roleLabels[role]}</span>
                      </label>
                    ),
                  )}
                </div>
                <p className={styles.small}>
                  Your selected role cannot be changed after creation.
                </p>
              </fieldset>
              <section className={styles.formSection}>
                <h2>Your public website address</h2>
                <p className={styles.muted}>
                  Choose carefully—this address cannot be changed after your
                  wedding is created. We’ll confirm it when you create your
                  wedding.
                </p>
                <div className={styles.field}>
                  <label htmlFor="wedding-slug">
                    Website URL <span aria-hidden="true">*</span>
                  </label>
                  <div className={styles.slugField}>
                    <span>{origin}/weddings/</span>
                    <input
                      id="wedding-slug"
                      name="slug"
                      required
                      minLength={3}
                      maxLength={80}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={data.slug}
                      onChange={(event) => {
                        setSlugEdited(true);
                        setData({
                          ...data,
                          slug: event.target.value.toLowerCase(),
                        });
                      }}
                      {...attr("slug")}
                    />
                  </div>
                  {errorText("slug")}
                  <small>
                    3–80 characters. Use lowercase letters, numbers, and hyphens
                    only.
                  </small>
                </div>
                <Preview data={data} origin={origin} mobile />
              </section>
              <p className={styles.regional}>
                <Icon name="calendar" />
                Dates and times use India Standard Time. Expenses use Indian
                Rupees.
              </p>
              <div className={styles.formActions}>
                <button className={styles.primary} type="submit">
                  Review wedding
                </button>
              </div>
            </fieldset>
          </form>
          <Preview data={data} origin={origin} />
        </div>
      ) : (
        <div className={styles.review}>
          <section className={styles.reviewCard}>
            <div className={styles.reviewBanner}>
              <Image
                src="/images/onboarding/review-stationery.jpg"
                alt="Wedding stationery and delicate flowers"
                fill
                sizes="390px"
              />
            </div>
            <div className={styles.sectionHeading}>
              <h2>Your wedding, at a glance.</h2>
              <button
                className={styles.textButton}
                onClick={() => showStep(1)}
                disabled={pending}
              >
                Edit details
              </button>
            </div>
            <dl className={styles.summaryGrid}>
              <div>
                <dt>Bride’s name</dt>
                <dd>{data.couple.brideName}</dd>
              </div>
              <div>
                <dt>Groom’s name</dt>
                <dd>{data.couple.groomName}</dd>
              </div>
              <div>
                <dt>Wedding date</dt>
                <dd>{displayDate(data.weddingDate)}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{data.location}</dd>
              </div>
              {data.introduction && (
                <div className={styles.fullWidth}>
                  <dt>Introduction</dt>
                  <dd>{data.introduction}</dd>
                </div>
              )}
              <div className={styles.fullWidth}>
                <dt>Public website address</dt>
                <dd className={styles.breakText}>
                  {origin}/weddings/{data.slug}
                </dd>
              </div>
              <div>
                <dt>Wedding owner</dt>
                <dd>
                  You <span className={styles.badge}>Owner</span>
                  <small>{email}</small>
                </dd>
              </div>
              <div>
                <dt>Your role</dt>
                <dd>{roleLabels[data.creatorRole]}</dd>
              </div>
            </dl>
            <aside className={styles.permanence}>
              <h3>Before you create</h3>
              <ul>
                <li>You can have one active wedding membership at a time.</li>
                <li>
                  You’ll own this wedding. Ownership cannot be transferred.
                </li>
                <li>
                  Your website address and owner’s role cannot be changed after
                  creation.
                </li>
              </ul>
            </aside>
            <p className={styles.publicNotice}>
              <Icon name="globe" />
              Your couple names, wedding date, location, and introduction can
              appear on your public wedding website.
            </p>
            <div className={styles.reviewActions}>
              <button
                className={styles.textButton}
                onClick={() => showStep(1)}
                disabled={pending}
              >
                Back
              </button>
              {uncertain || conflict ? (
                <button
                  className={styles.primary}
                  disabled={pending}
                  onClick={() => void checkStatus()}
                >
                  {pending ? "Checking…" : "Check wedding status"}
                </button>
              ) : (
                <button
                  className={styles.primary}
                  disabled={pending}
                  onClick={() => void create()}
                >
                  {pending ? "Creating your wedding…" : "Create wedding"}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

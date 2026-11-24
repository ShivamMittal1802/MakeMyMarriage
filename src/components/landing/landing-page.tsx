import Image from "next/image";
import type { ReactNode } from "react";

import {
  AccountButton,
  LandingHeader,
  LandingInteractions,
  type LandingAccount,
} from "./landing-controls";
import { Icon, type IconName } from "./landing-icons";
import {
  DashboardPreview,
  EventPreview,
  ExpensePreview,
  GuestPreview,
  LivestreamPreview,
  MemberPreview,
  MobileWeddingPreview,
  WebsitePreview,
} from "./landing-previews";
import styles from "./landing.module.css";

const steps: {
  title: string;
  description: string;
  icon: IconName;
  note: string;
}[] = [
  {
    title: "Create your wedding",
    description:
      "Add your wedding details and the celebrations you’re planning, from the first gathering to the reception.",
    icon: "calendar",
    note: "One wedding. Every celebration.",
  },
  {
    title: "Bring your people together",
    description:
      "Invite your partner, family, and trusted friends to help. Give everyone a clear role and one shared place to plan.",
    icon: "people",
    note: "A little help from your people",
  },
  {
    title: "Keep everyone in the loop",
    description:
      "Send event invitations by email, collect individual RSVPs, and send a reminder when you choose.",
    icon: "mail",
    note: "Thoughtful, manual reminders",
  },
];

const faqs = [
  {
    question: "Who can help manage our wedding?",
    answer:
      "Invite your partner, family, or trusted friends as wedding members. Each wedding has one owner, with bride, groom, and manager roles. All members can manage wedding content; the owner, bride, and groom can also invite members and assign roles.",
  },
  {
    question: "Do guests need to create an account?",
    answer:
      "No. Guests respond using their private event invitation links. Separate private links let them upload photos or view the gallery, without creating an account. Only people managing a wedding need an account.",
  },
  {
    question: "Can we invite different guests to different events?",
    answer:
      "Yes. Invite each individual guest to one, several, or all events. Each guest has a separate RSVP for each invited event. The public wedding website still shows the full event schedule; a private invitation controls which event a guest can RSVP to.",
  },
  {
    question: "Can guests see our expenses?",
    answer:
      "No. Expenses are visible only to authenticated members of your wedding. Public visitors, RSVP-link holders, and gallery-link holders cannot access expense details.",
  },
  {
    question: "How do invitation reminders work?",
    answer:
      "A wedding member chooses an event and recipients, reviews the selection, and explicitly sends an email reminder. You can include guests who have already responded. Reminders are manual, and sending one never resets an existing RSVP.",
  },
  {
    question: "Are wedding photos public?",
    answer:
      "Photos are stored privately. You share separate upload and viewing links or QR codes; an upload link does not grant gallery viewing access. Viewing links also allow individual original downloads. Anyone holding a link can use or forward it, so share it with people you trust.",
  },
];

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  children,
}: {
  icon: IconName;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <article className={styles.featureCard}>
      <span className={styles.featureIcon}>
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </article>
  );
}

export function LandingPage({ account }: { account: LandingAccount }) {
  return (
    <LandingInteractions account={account}>
      <div id="top" className={styles.page}>
        <a href="#main-content" className={styles.skipLink}>
          Skip to content
        </a>
        <LandingHeader />
        <main id="main-content" tabIndex={-1}>
          <section
            className={`${styles.container} ${styles.hero}`}
            aria-labelledby="hero-title"
          >
            <div className={styles.heroCopy}>
              <p className={`${styles.eyebrow} ${styles.heroEyebrow}`}>
                For the wedding you’re planning together
              </p>
              <h1 id="hero-title">
                Your wedding,
                <br />
                <em>beautifully organised.</em>
              </h1>
              <p className={styles.heroDescription}>
                Bring your events, guest invitations, expenses, and wedding
                memories into one shared space for you and the people helping
                you plan.
              </p>
              <div className={styles.heroActions}>
                <AccountButton>Create your wedding</AccountButton>
                <a
                  className={`${styles.button} ${styles.secondary}`}
                  href="#how-it-works"
                >
                  See how it works
                </a>
              </div>
              <p className={styles.heroReassurance}>
                <Icon name="shield" /> Plan together. Guests can RSVP without an
                account.
              </p>
              <div className={styles.weddingNote}>
                <Image
                  src="/images/landing/wedding-detail.jpg"
                  alt=""
                  width={62}
                  height={70}
                />
                <div>
                  <strong>Made for Indian celebrations</strong>
                  <p>From an intimate Haldi to a reception full of love.</p>
                </div>
              </div>
            </div>
            <div className={styles.heroVisual}>
              <MobileWeddingPreview />
              <DashboardPreview />
            </div>
          </section>

          <section
            id="how-it-works"
            className={`${styles.section} ${styles.howSection}`}
            aria-labelledby="how-heading"
          >
            <div className={styles.container}>
              <div className={styles.sectionHeading}>
                <p className={styles.eyebrow}>Simple, unified flow</p>
                <h2 id="how-heading">
                  A little less coordination.
                  <br className={styles.mobileBreak} /> A lot more celebration.
                </h2>
                <p>
                  Set up your wedding, bring your people together, and keep the
                  details in one place.
                </p>
              </div>
              <div className={styles.steps}>
                {steps.map((step, index) => (
                  <article className={styles.stepCard} key={step.title}>
                    <div className={styles.stepTop}>
                      <span aria-hidden="true">0{index + 1}</span>
                      <span className={styles.stepIcon}>
                        <Icon name={step.icon} />
                      </span>
                    </div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    <span className={styles.stepNote}>
                      <Icon name="check" />
                      {step.note}
                    </span>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section
            id="features"
            className={`${styles.container} ${styles.section}`}
            aria-label="Wedding planning features"
          >
            <SectionHeading
              eyebrow="Designed for a little breathing room"
              title="Every detail, with room to breathe."
              description="A shared place for the practical things that make your celebrations come together."
            />
            <p className={styles.exampleNote}>
              A glimpse of what’s planned · All previews use fictional wedding
              details
            </p>
            <div className={styles.featureGrid}>
              <FeatureCard
                icon="calendar"
                title="Every celebration, clearly planned"
                description="Keep dates, times, venues, and descriptions together for every event, from Haldi to reception."
              >
                <EventPreview />
              </FeatureCard>
              <FeatureCard
                icon="people"
                title="Planning is a shared effort"
                description="Give your partner, family, and trusted friends a shared place to help, with clear roles for everyone."
              >
                <MemberPreview />
              </FeatureCard>
              <FeatureCard
                icon="mail"
                title="Invitations with a clear answer"
                description="Invite each guest to the right events, collect an RSVP for each invitation, and send email reminders when needed."
              >
                <GuestPreview />
              </FeatureCard>
              <FeatureCard
                icon="wallet"
                title="Know what’s paid and what’s next"
                description="Keep track of amounts paid, who paid them, and what’s still due. Your wedding’s expenses stay with your members."
              >
                <ExpensePreview />
              </FeatureCard>
            </div>
          </section>

          <section
            className={`${styles.container} ${styles.gallerySection}`}
            aria-labelledby="gallery-heading"
          >
            <div className={styles.galleryCopy}>
              <p className={styles.eyebrow}>
                Shared memories, every perspective
              </p>
              <h2 id="gallery-heading">
                Every perspective.
                <br />
                One shared gallery.
              </h2>
              <p>
                Share a private upload link or QR code so guests can add their
                candid phone photos. Share a separate viewing link to browse and
                download individual originals.
              </p>
              <div className={styles.galleryFeatures}>
                <span>
                  <Icon name="camera" /> Private photo uploads
                </span>
                <span>
                  <Icon name="download" /> Original-quality memories
                </span>
              </div>
              <p className={styles.galleryFootnote}>
                <Icon name="shield" /> No guest account or app download needed.
              </p>
            </div>
            <figure className={styles.galleryVisual}>
              <div className={styles.galleryImage}>
                <picture>
                  <source
                    media="(max-width: 767px)"
                    srcSet="/images/landing/wedding-gallery-mobile.jpg"
                  />
                  <Image
                    src="/images/landing/wedding-gallery.jpg"
                    alt="A bride and groom sharing a joyful moment at a lantern-lit wedding celebration"
                    fill
                    sizes="(max-width: 767px) 90vw, 550px"
                  />
                </picture>
                <div className={styles.photoShade} />
                <div className={styles.galleryCaption}>
                  <span>Illustrative gallery preview</span>
                  <strong>Little moments. Lasting memories.</strong>
                </div>
              </div>
              <figcaption className={styles.qrNote}>
                <span>
                  <Icon name="qr" />
                </span>
                <div>
                  <strong>One link. So many memories.</strong>
                  <p>Separate links for uploading and viewing.</p>
                </div>
              </figcaption>
            </figure>
          </section>

          <section
            className={`${styles.container} ${styles.section} ${styles.celebrationSection}`}
            aria-label="Wedding website and livestream"
          >
            <SectionHeading
              eyebrow="A celebration that brings everyone closer"
              title="A place to share the celebration."
              description="The details your guests need, and a way for loved ones to join from afar."
            />
            <div className={styles.featureGrid}>
              <FeatureCard
                icon="globe"
                title="Your wedding, its own little home"
                description="Share your couple’s introduction, wedding details, and full event schedule on a simple wedding website."
              >
                <WebsitePreview />
              </FeatureCard>
              <FeatureCard
                icon="video"
                title="Bring loved ones closer, wherever they are"
                description="Add your YouTube livestream so family and friends can watch from afar, with a link to open it on YouTube."
              >
                <LivestreamPreview />
              </FeatureCard>
            </div>
          </section>

          <section
            id="faqs"
            className={`${styles.container} ${styles.section} ${styles.faqSection}`}
            aria-label="Frequently asked questions"
          >
            <SectionHeading
              eyebrow="Clarity in the little details"
              title="Frequently asked questions"
              description="A few things to know about planning together, guest access, and privacy."
            />
            <div className={styles.faqList}>
              {faqs.map((faq) => (
                <details
                  key={faq.question}
                  name="landing-faq"
                  className={styles.faq}
                >
                  <summary>
                    {faq.question}
                    <Icon name="chevron" />
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </section>

          <section
            className={`${styles.container} ${styles.closing}`}
            aria-labelledby="closing-heading"
          >
            <p className={styles.eyebrow}>Start planning peacefully</p>
            <h2 id="closing-heading">
              Make room for the
              <br />
              moments that matter.
            </h2>
            <p>
              Bring your people and your wedding plans together in one calm,
              harmonious place.
            </p>
            <div className={styles.closingActions}>
              <AccountButton variant="light">Create your wedding</AccountButton>
              <AccountButton action="login" variant="text">
                Already planning with us? Log in
              </AccountButton>
            </div>
          </section>
        </main>
        <footer className={styles.footer}>
          <div className={styles.container}>
            <div className={styles.footerTop}>
              <div>
                <a href="#top" className={styles.brand}>
                  Make My Marriage
                </a>
                <p>A shared space for your wedding plans.</p>
              </div>
              <nav aria-label="Footer navigation">
                <a href="#features">Features</a>
                <a href="#how-it-works">How it works</a>
                <a href="#faqs">FAQs</a>
                <AccountButton action="login" variant="text">
                  Log in
                </AccountButton>
              </nav>
            </div>
            <div className={styles.footerBottom}>
              <p>© {new Date().getFullYear()} Make My Marriage.</p>
              <span>Made for the moments that matter</span>
            </div>
          </div>
        </footer>
      </div>
    </LandingInteractions>
  );
}

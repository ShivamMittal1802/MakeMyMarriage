import Image from "next/image";
import { Icon } from "./landing-icons";
import styles from "./landing.module.css";

const events = [
  {
    name: "Mehendi & welcome high tea",
    date: "16 Feb",
    time: "4:00 PM",
    venue: "Palace Courtyard",
  },
  {
    name: "Sangeet & an evening together",
    date: "17 Feb",
    time: "7:30 PM",
    venue: "Garden Pavilion",
  },
  {
    name: "Wedding ceremony",
    date: "18 Feb",
    time: "6:00 PM",
    venue: "Heritage Mandap",
  },
];

export function DashboardPreview() {
  return (
    <figure
      className={styles.dashboard}
      aria-label="Example wedding dashboard with fictional data"
    >
      <figcaption className={styles.dashboardBar}>
        <span className={styles.windowDots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>Example wedding dashboard</span>
        <span className={styles.exampleBadge}>Fictional preview</span>
      </figcaption>
      <div className={styles.dashboardHeading}>
        <div>
          <h2>Aanya & Aarav</h2>
          <p>18 February 2027 · Jaipur</p>
        </div>
        <Icon name="heart" />
      </div>
      <div className={styles.previewTabs} aria-hidden="true">
        <span>Overview</span>
        <span>Events</span>
        <span>Guests</span>
        <span>Expenses</span>
        <span>Gallery</span>
      </div>
      <div className={styles.dashboardBody}>
        <div className={styles.stats}>
          <div>
            <span>Celebrations</span>
            <strong>4 events</strong>
            <small>Mehendi to reception</small>
          </div>
          <div>
            <span>Reception RSVPs</span>
            <strong>86 / 120</strong>
            <small>Guests attending / invited</small>
          </div>
          <div>
            <span>Expenses paid</span>
            <strong>₹4,20,000</strong>
            <small>₹1,30,000 remaining</small>
          </div>
        </div>
        <div className={styles.schedule}>
          <div className={styles.previewLabel}>Upcoming celebrations</div>
          {events.map((event) => (
            <div className={styles.scheduleRow} key={event.name}>
              <span className={styles.eventDot} aria-hidden="true" />
              <div>
                <strong>{event.name}</strong>
                <p>
                  {event.date} · {event.time} · {event.venue}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className={styles.expenseProgress}>
          <div>
            <span>Expenses at a glance</span>
            <span>
              Remaining: <strong>₹1,30,000</strong>
            </span>
          </div>
          <div className={styles.progressTrack} aria-hidden="true">
            <span />
          </div>
          <div>
            <small>Paid: ₹4,20,000</small>
            <small>Recorded total: ₹5,50,000</small>
          </div>
        </div>
      </div>
    </figure>
  );
}

export function MobileWeddingPreview() {
  return (
    <figure className={styles.mobileWedding}>
      <Image
        src="/images/landing/wedding-couple.jpg"
        alt="A couple celebrating their Indian wedding in a sunlit palace courtyard"
        fill
        sizes="(max-width: 767px) 100vw, 1px"
        quality={85}
      />
      <figcaption>
        <span>Example wedding</span>
        <strong>Aanya & Aarav</strong>
      </figcaption>
      <span className={styles.photoDate}>18 Feb 2027</span>
    </figure>
  );
}

export function EventPreview() {
  return (
    <div className={styles.miniPreview} aria-label="Example events">
      <div className={styles.miniEvent}>
        <div>
          <strong>Haldi & a little sunshine</strong>
          <span className={styles.pill}>16 Feb</span>
        </div>
        <p>
          <Icon name="location" /> Palace Courtyard · 10:30 AM
        </p>
      </div>
      <div className={styles.miniEvent}>
        <div>
          <strong>Wedding ceremony</strong>
          <span className={styles.pill}>18 Feb</span>
        </div>
        <p>
          <Icon name="location" /> Heritage Mandap · 6:00 PM
        </p>
      </div>
    </div>
  );
}

export function MemberPreview() {
  return (
    <div className={styles.miniPreview} aria-label="Example wedding members">
      {[
        { initials: "AS", name: "Aanya Sharma", role: "Bride · Owner" },
        { initials: "AK", name: "Aarav Kapoor", role: "Groom" },
        { initials: "RK", name: "Rohan Kapoor", role: "Manager" },
      ].map((member) => (
        <div className={styles.memberRow} key={member.name}>
          <span className={styles.avatar} aria-hidden="true">
            {member.initials}
          </span>
          <strong>{member.name}</strong>
          <span className={styles.pill}>{member.role}</span>
        </div>
      ))}
    </div>
  );
}

export function GuestPreview() {
  return (
    <div
      className={styles.miniPreview}
      aria-label="Example individual guest invitations"
    >
      <div className={styles.guestRow}>
        <div>
          <strong>Riya Shah</strong>
          <p>Invited to: Sangeet, Reception</p>
        </div>
        <span className={styles.pill}>
          <Icon name="check" /> Attending
        </span>
      </div>
      <div className={styles.guestRow}>
        <div>
          <strong>Kunal Mehta</strong>
          <p>Reception · awaiting response</p>
        </div>
        <span className={styles.previewAction}>Reminder</span>
      </div>
    </div>
  );
}

export function ExpensePreview() {
  return (
    <div className={styles.miniPreview} aria-label="Example recorded expenses">
      <div className={styles.guestRow}>
        <div>
          <strong>Flowers & décor</strong>
          <p>Paid by Aanya</p>
        </div>
        <div className={styles.expenseAmount}>
          <strong>₹1,85,000</strong>
          <small>Paid</small>
        </div>
      </div>
      <div className={styles.guestRow}>
        <div>
          <strong>Sangeet music</strong>
          <p>Remaining payment · due 15 Feb</p>
        </div>
        <div className={styles.expenseAmount}>
          <strong>₹75,000</strong>
          <small>Remaining</small>
        </div>
      </div>
      <p className={styles.privacyNote}>
        <Icon name="shield" /> Expenses are visible to your wedding’s members
        only.
      </p>
    </div>
  );
}

export function WebsitePreview() {
  return (
    <div
      className={styles.websitePreview}
      aria-label="Example public wedding website"
    >
      <span>
        <Icon name="globe" /> Example wedding website
      </span>
      <div>
        <strong>Aanya & Aarav</strong>
        <p>Celebrate with us under the stars in Jaipur.</p>
        <span className={styles.pill}>Our wedding</span>
        <span className={styles.pill}>Event schedule</span>
      </div>
    </div>
  );
}

export function LivestreamPreview() {
  return (
    <div
      className={styles.streamPreview}
      aria-label="Illustrative YouTube livestream preview"
    >
      <Image
        src="/images/landing/wedding-ceremony.jpg"
        alt="A floral wedding mandap at an Indian wedding ceremony"
        fill
        sizes="(max-width: 767px) 90vw, 500px"
      />
      <div className={styles.streamShade} />
      <span className={styles.streamBadge}>YouTube livestream preview</span>
      <span className={styles.playBadge}>
        <Icon name="play" />
      </span>
      <span className={styles.streamCaption}>Together, wherever you are.</span>
    </div>
  );
}

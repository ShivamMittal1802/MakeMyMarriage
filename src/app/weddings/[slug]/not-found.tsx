import s from "@/modules/public-weddings/celebration.module.css";
export default function Unavailable() {
  return (
    <main className={s.message}>
      <p className={s.kicker}>Make My Marriage</p>
      <h1>Wedding page unavailable</h1>
      <p>Check the wedding address with the person who shared it.</p>
    </main>
  );
}

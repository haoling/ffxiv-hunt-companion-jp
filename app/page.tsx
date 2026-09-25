import { CameraToggle } from "./camera-toggle";
import styles from "./page.module.css";

const roadmap = [
  "手配書の画像取り込み",
  "候補モブの自動推定",
  "最短ハントルートの提示",
];

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Next.js + GitHub Pages</p>
        <h1>FFXIV Hunt Companion JP</h1>
        <p className={styles.description}>
          モブハント手配書の認識とルート案内をブラウザだけで実現するための、
          クライアントサイド専用スケルトンです。
        </p>
        <CameraToggle />
      </section>

      <section className={styles.card}>
        <h2>次に実装する想定機能</h2>
        <ul className={styles.list}>
          {roadmap.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

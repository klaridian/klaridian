import styles from "./animated-terminal.module.css";

// A pure-CSS animated terminal: types the `generate` command, then streams the
// emitted output line by line. No JS/state — renders identically in SSR and
// respects prefers-reduced-motion (shows the final frame, no motion).
export function AnimatedTerminal() {
  return (
    <div className={styles.term}>
      <div className={styles.bar}>
        <i />
        <i />
        <i />
        <span>zsh — klaridian</span>
      </div>
      <div className={styles.body}>
        <div>
          <span className={styles.d}>$</span>{" "}
          <span className={styles.type}>npx klaridian generate --spec ./stripe.yaml</span>
        </div>
        <div className={`${styles.out} ${styles.o1}`}>
          <span className={styles.c}>→ parsing spec…</span>{" "}
          <span className={styles.tick}>✓</span>{" "}
          <span className={styles.a}>452 operations</span>
        </div>
        <div className={`${styles.out} ${styles.o2}`}>
          <span className={styles.c}>→ curating tools…</span>{" "}
          <span className={styles.tick}>✓</span> kept <span className={styles.a}>38</span>, excluded 414
        </div>
        <div className={`${styles.out} ${styles.o3}`}>
          <span className={styles.c}>→ emitting</span>{" "}
          <span className={styles.g}>TypeScript</span>{" "}
          <span className={styles.c}>server…</span> <span className={styles.tick}>✓</span>
        </div>
        <div className={`${styles.out} ${styles.o4}`}>
          <span className={styles.c}>→ wiring plugin</span>{" "}
          <span className={styles.g}>otel</span>{" "}
          <span className={styles.c}>(OpenTelemetry)…</span> <span className={styles.tick}>✓</span>
        </div>
        <div className={`${styles.out} ${styles.o5}`}>
          <span className={styles.c}>→ writing LICENSE, README, server.json…</span>{" "}
          <span className={styles.tick}>✓</span>
        </div>
        <div className={`${styles.out} ${styles.o6}`}>&nbsp;</div>
        <div className={`${styles.out} ${styles.o7}`}>
          <span className={styles.tick}>✓</span> generated{" "}
          <span className={styles.a}>./my-server</span> —{" "}
          <span className={styles.c}>run</span>{" "}
          <span className={styles.g}>npm install &amp;&amp; npm start</span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import styles from "./page.module.css";

export function CameraToggle() {
  const [cameraMode, setCameraMode] = useState(false);

  return (
    <div className={styles.actions}>
      <button
        type="button"
        onClick={() => setCameraMode((current) => !current)}
        className={styles.primaryButton}
      >
        {cameraMode ? "カメラ準備を解除" : "カメラ準備を試す"}
      </button>
      <p className={styles.status} aria-live="polite">
        {cameraMode
          ? "端末側のカメラ連携を追加する準備ができています。"
          : "現在はUIスケルトンのみです。"}
      </p>
    </div>
  );
}

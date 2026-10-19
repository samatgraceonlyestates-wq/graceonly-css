import { cx } from "@/lib/cx";
import styles from "./Avatar.module.css";

type Props = {
  name: string;
  size?: 36 | 40 | 72;
  // soft: mist fill, burgundy initial (lists). solid: burgundy fill, gold initial.
  tone?: "soft" | "solid";
  // Only for avatars that stand alone; avatars beside a name stay decorative.
  label?: string;
};

const SIZE = { 36: styles.size36, 40: styles.size40, 72: styles.size72 } as const;

export function Avatar({ name, size = 36, tone = "soft", label }: Props) {
  const initial = name.trim().charAt(0).toUpperCase();

  return (
    <span
      className={cx(styles.avatar, SIZE[size], tone === "solid" ? styles.solid : styles.soft)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {initial}
    </span>
  );
}

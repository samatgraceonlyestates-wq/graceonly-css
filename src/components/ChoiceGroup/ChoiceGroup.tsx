import type { ReactNode } from "react";
import { VisuallyHidden } from "@/components/VisuallyHidden/VisuallyHidden";
import { cx } from "@/lib/cx";
import styles from "./ChoiceGroup.module.css";

// A single-choice group built on native radio inputs (keyboard, arrow keys and
// screen readers come free). Three looks, one behaviour:
//   cards  label + small sub label; a grid (2 columns on mobile, 5 on desktop)
//   chips  a wrapping row of pills
//   rows   a stacked list for richer content (the visitor lookup candidates)
// Controlled: the caller owns `value`.
export type ChoiceOption = {
  value: string;
  label: ReactNode;
  sub?: ReactNode;
};

type Props = {
  legend: string;
  // Keep the legend for screen readers only when the screen already shows one.
  legendHidden?: boolean;
  name: string;
  options: ChoiceOption[];
  value: string | null;
  onChange: (value: string) => void;
  variant: "cards" | "chips" | "rows";
  className?: string;
};

const VARIANT = { cards: styles.cards, chips: styles.chips, rows: styles.rows } as const;

export function ChoiceGroup({ legend, legendHidden = false, name, options, value, onChange, variant, className }: Props) {
  return (
    <fieldset className={cx(styles.group, className)}>
      <legend className={legendHidden ? undefined : styles.legend}>
        {legendHidden ? <VisuallyHidden>{legend}</VisuallyHidden> : legend}
      </legend>
      <div className={cx(styles.options, VARIANT[variant])}>
        {options.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              className={styles.input}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.body}>
              <span className={styles.mark} aria-hidden="true" />
              <span className={styles.text}>
                <span className={styles.label}>{option.label}</span>
                {option.sub ? <span className={styles.sub}>{option.sub}</span> : null}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

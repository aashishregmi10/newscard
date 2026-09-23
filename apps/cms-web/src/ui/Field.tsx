import { useId, type ReactNode } from 'react';

/**
 * A labelled form field, in Material's outlined style.
 *
 * -- What the extra markup is for --------------------------------------------
 *
 * A Material text field puts its label ON the border, with a gap cut in the
 * border exactly as wide as the label. That gap is not a background trick — it
 * is a real `<fieldset>` whose `<legend>` interrupts the top border, which is
 * the only way to get it without measuring the rendered label in JavaScript.
 * So every field renders three things: the control, a label positioned over it,
 * and a decorative fieldset behind it.
 *
 * -- Why every control gets a placeholder ------------------------------------
 *
 * The label floats when the control is focused OR holds a value, and "holds a
 * value" is expressible in CSS only as `:not(:placeholder-shown)` — which
 * requires a placeholder to exist. Each control therefore receives one of a
 * single space by default. A call site that wants a real placeholder simply
 * passes one after the spread; the stylesheet hides it until focus so it cannot
 * show through beneath an unfloated label.
 *
 * -- Why the control is a render prop ----------------------------------------
 *
 * The label needs the control's id, the control needs the note's id, and the
 * ids have to be unique per instance. Passing the control as `children` and
 * hoping the caller wires both is how half a form ends up with labels that
 * point at nothing. Handing the props down makes the association the only way
 * to use the component:
 *
 *     <Field label="Headline" note="Shown on the card">
 *       {(f) => <input className="input" {...f} value={x} onChange={...} />}
 *     </Field>
 *
 * -- Why the counter is not a live region ------------------------------------
 *
 * It changes on every keystroke. Announced politely it would still interrupt
 * the sentence being dictated, and announced assertively it would make the
 * field unusable with a screen reader. The count stays visual and the guidance
 * that matters — "eight more to go", "four over the limit" — is a note, which
 * IS associated and IS read out, once, when the editor moves on.
 */

type Tone = 'default' | 'warn' | 'bad';

const NOTE_CLASS: Record<Tone, string> = {
  default: 'field-note',
  warn: 'field-note field-note-warn',
  bad: 'field-note field-note-bad',
};

/** What a field hands to its control. Spread it: `{...f}`. */
export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  /**
   * A single space, so the stylesheet can tell an empty control from a full
   * one. Override it with a real placeholder after the spread if you want one.
   */
  placeholder: string;
}

interface FieldProps {
  label: ReactNode;
  /** Set on a field that may be left blank; renders in the label, quietly. */
  optional?: ReactNode;
  counter?: ReactNode;
  note?: ReactNode;
  noteTone?: Tone;
  /** Marks the outline and label in the error colour. */
  invalid?: boolean;
  /**
   * `plain` drops the notched outline and puts the label above the control —
   * for a control that draws its own box, such as a file drop zone, where a
   * label floating on a dashed border would be nonsense.
   */
  variant?: 'outlined' | 'plain';
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({
  label,
  optional,
  counter,
  note,
  noteTone = 'default',
  invalid = false,
  variant = 'outlined',
  children,
}: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const hasNote = note !== undefined && note !== null && note !== false;
  const control = children({
    id,
    'aria-describedby': hasNote ? noteId : undefined,
    placeholder: ' ',
  });

  const help = (hasNote || counter !== undefined) && (
    <div className="field-help">
      {hasNote ? (
        <p className={NOTE_CLASS[noteTone]} id={noteId}>
          {note}
        </p>
      ) : (
        <span />
      )}
      {counter}
    </div>
  );

  if (variant === 'plain') {
    return (
      <div className="field">
        <label className="field-plain-label" htmlFor={id}>
          {label}
          {optional !== undefined && <span className="field-optional">{optional}</span>}
        </label>
        {control}
        {help}
      </div>
    );
  }

  return (
    <div className="field">
      <div className={invalid ? 'field-shell field-invalid' : 'field-shell'}>
        {control}

        <label className="field-label-text" htmlFor={id}>
          {label}
          {optional !== undefined && <span className="field-optional">{optional}</span>}
        </label>

        {/*
          * Decorative only — the visible border and the notch in it. Hidden
          * from assistive technology because the real label above already
          * names the control, and a fieldset here would otherwise be announced
          * as a second grouping around a single input.
          */}
        <fieldset className="field-outline" aria-hidden="true">
          <legend className="field-legend">
            <span>
              {label}
              {optional !== undefined && <span className="field-optional">{optional}</span>}
            </span>
          </legend>
        </fieldset>
      </div>
      {help}
    </div>
  );
}

interface FieldsetProps {
  legend: ReactNode;
  note?: ReactNode;
  noteTone?: Tone;
  children: (group: { 'aria-describedby': string | undefined }) => ReactNode;
}

/**
 * The same thing for a group of controls — a segmented control, a set of
 * toggles — where there is no single element for a `<label>` to point at.
 * `<fieldset>`/`<legend>` is the element pair that exists for exactly this and
 * is almost always replaced with a styled div, which loses the grouping.
 */
export function Fieldset({ legend, note, noteTone = 'default', children }: FieldsetProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const hasNote = note !== undefined && note !== null && note !== false;

  return (
    <fieldset className="field field-set">
      <legend className="field-group-legend">{legend}</legend>
      {children({ 'aria-describedby': hasNote ? noteId : undefined })}
      {hasNote && (
        <p className={NOTE_CLASS[noteTone]} id={noteId}>
          {note}
        </p>
      )}
    </fieldset>
  );
}

interface CounterProps {
  state: 'under' | 'ok' | 'over';
  children: ReactNode;
}

export function Counter({ state, children }: CounterProps) {
  return (
    <span className="counter" data-state={state}>
      {children}
    </span>
  );
}

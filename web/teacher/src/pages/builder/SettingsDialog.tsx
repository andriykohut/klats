import type { Settings } from "@klats/shared/generated/testfmt.ts";
import { DEFAULT_THRESHOLDS } from "@klats/shared/grades.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  NumberField,
  RadioButton,
  RadioField,
  RadioGroup,
  SwitchButton,
  SwitchField,
} from "react-aria-components";
import "./settings.css";

/** The minutes a time limit starts at when it is first turned on. */
const FIRST_MINUTES = 45;

/** The grades with a row in the 12-point table; grade 1 is anything below the first. */
const GRADES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Marks where a field goes in a message that has a `{count}` slot. */
const SLOT = "\u0001";

function Choices<T extends string>(props: {
  label: string;
  value: T;
  options: [T, () => string][];
  onChange: (value: T) => void;
}) {
  return (
    <RadioGroup
      className="s-group"
      orientation="horizontal"
      value={props.value}
      onChange={(v) => props.onChange(v as T)}
    >
      <Label className="b-lbl">{props.label}</Label>
      <div className="b-seg s-seg">
        {props.options.map(([id, name]) => (
          <RadioField key={id} value={id}>
            <RadioButton className="b-seg-btn">{name()}</RadioButton>
          </RadioField>
        ))}
      </div>
    </RadioGroup>
  );
}

function Count(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <NumberField
      className="t-field s-num"
      aria-label={props.label}
      value={props.value}
      minValue={props.min}
      maxValue={props.max}
      // A cleared field commits NaN, which keeps the value it had.
      onChange={(v) => !Number.isNaN(v) && props.onChange(v)}
    >
      <Input />
    </NumberField>
  );
}

function Toggle(props: {
  label: string;
  value: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <SwitchField
      className="s-switch"
      isSelected={props.value}
      onChange={props.onChange}
    >
      <SwitchButton className="b-tog-btn">
        <i className="b-tog-track" aria-hidden="true" />
        {props.label}
      </SwitchButton>
    </SwitchField>
  );
}

/**
 * «Налаштування»: a button that opens the test's settings in a dialog, where
 * every change goes to `onChange` as the whole new `settings` and the builder
 * autosaves it. `questionCount` bounds the random subset.
 *
 * A setting a choice hides keeps its value, so a teacher who switches back
 * finds it: the minutes of a time limit, the grade table and pass mark of a
 * scale. Only turning off the random subset resets it, to 0. Each row of the
 * 12-point table stays between its neighbours, from 1 up to 100.
 */
export function SettingsDialog(props: {
  settings: Settings;
  questionCount: number;
  onChange: (settings: Settings) => void;
}) {
  const { settings: s, questionCount, onChange } = props;
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  const setScale = (patch: Partial<Settings["scale"]>) =>
    set({ scale: { ...s.scale, ...patch } });
  const th = s.scale.thresholds;
  const timed = s.timeLimit.mode !== "none";
  const total = Math.max(questionCount, 1);
  const [before, after] = m
    .settings_subset_count({ count: SLOT, total })
    .split(SLOT);

  return (
    <DialogTrigger>
      <Button className="b-btn-l">{m.nav_settings()}</Button>
      <ModalOverlay isDismissable className="t-scrim">
        <Modal className="t-modal">
          <Dialog className="t-dialog s-dialog">
            {({ close }) => (
              <>
                <Heading slot="title">{m.settings_title()}</Heading>
                <div className="s-cols">
                  <div>
                    <Choices
                      label={m.settings_time()}
                      value={s.timeLimit.mode}
                      options={[
                        ["none", m.settings_time_none],
                        ["student", m.settings_time_student],
                        ["common", m.settings_time_common],
                      ]}
                      onChange={(mode) =>
                        set({
                          timeLimit: {
                            mode,
                            minutes:
                              mode !== "none" && s.timeLimit.minutes === 0
                                ? FIRST_MINUTES
                                : s.timeLimit.minutes,
                          },
                        })
                      }
                    />
                    {timed && (
                      <div className="s-inline">
                        <Count
                          label={m.settings_minutes()}
                          value={s.timeLimit.minutes}
                          min={1}
                          max={300}
                          onChange={(minutes) =>
                            set({ timeLimit: { ...s.timeLimit, minutes } })
                          }
                        />
                        <span>{m.settings_minutes()}</span>
                      </div>
                    )}
                    <Toggle
                      label={m.settings_shuffle()}
                      value={s.shuffleQuestions}
                      onChange={(shuffleQuestions) => set({ shuffleQuestions })}
                    />
                    <div className="s-inline">
                      <Toggle
                        label={m.settings_subset()}
                        value={s.subset > 0}
                        onChange={(on) =>
                          set({
                            subset: on ? Math.max(1, questionCount - 1) : 0,
                          })
                        }
                      />
                      {s.subset > 0 && (
                        <>
                          {before}
                          <Count
                            label={m.settings_subset()}
                            value={s.subset}
                            min={1}
                            max={total}
                            onChange={(subset) => set({ subset })}
                          />
                          {after}
                        </>
                      )}
                    </div>
                    <Choices
                      label={m.settings_reveal()}
                      value={s.reveal}
                      options={[
                        ["grade", m.settings_reveal_grade],
                        ["mistakes", m.settings_reveal_mistakes],
                        ["nothing", m.settings_reveal_nothing],
                      ]}
                      onChange={(reveal) => set({ reveal })}
                    />
                    <Choices
                      label={m.settings_nav()}
                      value={s.navigation}
                      options={[
                        ["free", m.settings_nav_free],
                        ["forward", m.settings_nav_forward],
                      ]}
                      onChange={(navigation) => set({ navigation })}
                    />
                  </div>
                  <div>
                    <Choices
                      label={m.settings_scale()}
                      value={s.scale.kind}
                      options={[
                        ["points12", m.scale_points12],
                        ["percent", m.scale_percent],
                        ["pass", m.scale_pass],
                      ]}
                      onChange={(kind) => setScale({ kind })}
                    />
                    {s.scale.kind === "points12" && (
                      <>
                        <div className="b-lbl">
                          {m.settings_grade()}
                          <em>{m.settings_from()}</em>
                        </div>
                        <div className="s-table">
                          {GRADES.map((g) => (
                            <div key={g} className="s-row">
                              <b>{g}</b>
                              <Count
                                label={`${m.settings_grade()} ${g}, ${m.settings_from()}`}
                                value={th[g - 2]}
                                min={g === 2 ? 1 : th[g - 3] + 1}
                                max={g === 12 ? 100 : th[g - 1] - 1}
                                onChange={(v) =>
                                  setScale({
                                    thresholds: th.map((t, j) =>
                                      j === g - 2 ? v : t,
                                    ),
                                  })
                                }
                              />
                            </div>
                          ))}
                        </div>
                        <Button
                          className="t-btn s-reset"
                          data-variant="quiet"
                          onPress={() =>
                            setScale({ thresholds: [...DEFAULT_THRESHOLDS] })
                          }
                        >
                          {m.settings_reset()}
                        </Button>
                      </>
                    )}
                    {s.scale.kind === "pass" && (
                      <div className="s-inline">
                        <span>{m.settings_pass()}</span>
                        <Count
                          label={m.settings_pass()}
                          value={s.scale.pass}
                          min={1}
                          max={100}
                          onChange={(pass) => setScale({ pass })}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="t-dialog-actions">
                  <Button
                    className="t-btn"
                    data-variant="primary"
                    onPress={close}
                  >
                    {m.action_close()}
                  </Button>
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

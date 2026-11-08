import type {
  NetworkInfo,
  SettingsInfo,
} from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  FieldError,
  FileTrigger,
  Form,
  Input,
  Label,
  Radio,
  RadioGroup,
  SwitchButton,
  SwitchField,
  Text,
  TextField,
} from "react-aria-components";
import {
  busy,
  useAbout,
  useCheckUpdates,
  useExportBackup,
  useLive,
  useNetwork,
  useOpenLink,
  useRestoreBackup,
  useSaveSettings,
  useSetAddress,
  useSettings,
} from "../api/queries";
import { setFlags, useFlags } from "../flags";
import { parsePort } from "../forms";
import { portBusyText } from "../ui/Banners";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { finishExport } from "../ui/finishExport";
import { Icon } from "../ui/icons";
import { LoadError } from "../ui/LoadError";
import { notify } from "../ui/Toasts";
import "./live/journal.css";
import "./settings.css";

/**
 * The student address, the UI language, the student port, the backup, and
 * the version with the update-check switch. Every settings save sends the
 * whole {@link SettingsInfo}: the server sets the port, the language and the
 * switch together.
 */
export function SettingsPage() {
  const settings = useSettings();
  const network = useNetwork();
  if (settings.isError || network.isError) {
    return (
      <LoadError
        onRetry={() => {
          settings.refetch();
          network.refetch();
        }}
      />
    );
  }
  if (!settings.data || !network.data) return null;
  // A data folder first started with -port has no saved port yet.
  const port = settings.data.port || network.data.port;
  return (
    <div className="t-page">
      <header className="t-page-head">
        <h1>{m.nav_settings()}</h1>
      </header>
      <div className="t-settings">
        <Address net={network.data} />
        <div className="t-settings-side">
          <Language settings={settings.data} port={port} />
          <Port settings={settings.data} net={network.data} port={port} />
          <Backup />
          <About settings={settings.data} port={port} />
        </div>
      </div>
    </div>
  );
}

function Address({ net }: { net: NetworkInfo }) {
  const choose = useSetAddress();
  const { portSaved } = useFlags();
  const copy = () =>
    navigator.clipboard.writeText(net.url).then(
      () => notify(m.settings_copied()),
      () => notify(m.error_server(), true),
    );
  return (
    <section className="t-panel t-section">
      <h2>{m.settings_address()}</h2>
      <p className="t-muted">{m.settings_address_hint()}</p>
      {net.url ? (
        <div className="t-url">
          <span className="t-url-text">{net.url}</span>
          <Button className="t-btn" data-variant="teal" onPress={copy}>
            <Icon name="copy" />
            {m.settings_copy()}
          </Button>
        </div>
      ) : (
        <p className="t-notice" data-tone="error">
          {net.error === "port_busy"
            ? portBusyText(net.port, portSaved)
            : m.network_none()}
        </p>
      )}
      {net.candidates.length > 1 && (
        <RadioGroup
          className="t-choices"
          value={net.address}
          onChange={(a) => choose.mutate(a)}
          isDisabled={choose.isPending}
        >
          <Label>{m.settings_network()}</Label>
          <Text slot="description">{m.settings_network_hint()}</Text>
          <div className="t-choice-list">
            {net.candidates.map((a) => (
              <Radio key={a} value={a} className="t-choice">
                {a}
              </Radio>
            ))}
          </div>
        </RadioGroup>
      )}
    </section>
  );
}

function Language(props: { settings: SettingsInfo; port: number }) {
  const save = useSaveSettings();
  return (
    <section className="t-panel t-section">
      <h2 id="language">{m.settings_language()}</h2>
      <RadioGroup
        aria-labelledby="language"
        orientation="horizontal"
        className="t-segment"
        value={props.settings.language}
        onChange={(language) =>
          save.mutate({ ...props.settings, port: props.port, language })
        }
      >
        <Radio value="uk">{m.settings_language_uk()}</Radio>
        <Radio value="en">{m.settings_language_en()}</Radio>
      </RadioGroup>
    </section>
  );
}

function Port(props: {
  settings: SettingsInfo;
  net: NetworkInfo;
  port: number;
}) {
  const [text, setText] = useState(String(props.port));
  const save = useSaveSettings();
  const { portSaved, focusPort } = useFlags();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusPort) return;
    input.current?.focus();
    setFlags({ focusPort: false });
  }, [focusPort]);
  const port = parsePort(text);
  return (
    <section className="t-panel t-section" id="port">
      <h2>{m.settings_port()}</h2>
      <p className="t-muted">{m.settings_port_hint()}</p>
      <Form
        className="t-port-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!port || busy("saveSettings")) return;
          save.mutate(
            { ...props.settings, port },
            { onSuccess: () => setFlags({ portSaved: true }) },
          );
        }}
      >
        <TextField
          className="t-field t-port-field"
          aria-label={m.settings_port_label()}
          value={text}
          onChange={setText}
          isInvalid={port === null}
        >
          <Input ref={input} inputMode="numeric" />
          <FieldError>{m.settings_port_invalid()}</FieldError>
        </TextField>
        <Button
          type="submit"
          className="t-btn"
          data-variant="teal"
          isDisabled={port === null || port === props.settings.port}
          isPending={save.isPending}
        >
          {m.action_save()}
        </Button>
      </Form>
      {/* Only after a save here: a down student server also reports restartRequired. */}
      {portSaved && props.settings.restartRequired && (
        <p className="t-notice">{m.settings_restart()}</p>
      )}
    </section>
  );
}

/**
 * Exports all the data, and restores it from a backup file after the teacher
 * confirms. Both are refused while a sitting runs, so both are disabled then.
 */
function Backup() {
  const { data: live } = useLive();
  const running = !!live && !live.sitting.ended;
  const exportAll = useExportBackup();
  const restore = useRestoreBackup();
  const [file, setFile] = useState<File | null>(null);
  return (
    <section className="t-panel t-section">
      <h2>{m.backup_title()}</h2>
      <div className="t-backup-actions">
        <Button
          className="t-btn"
          data-variant="teal"
          isDisabled={running}
          isPending={exportAll.isPending}
          onPress={() => {
            if (busy("exportBackup")) return;
            exportAll.mutate(undefined, { onSuccess: finishExport });
          }}
        >
          <Icon name="download" />
          {m.backup_export()}
        </Button>
        <FileTrigger
          acceptedFileTypes={[".klatsbackup"]}
          onSelect={(files) => setFile(files?.[0] ?? null)}
        >
          <Button className="t-btn" data-variant="quiet" isDisabled={running}>
            <Icon name="folder" />
            {m.backup_restore()}
          </Button>
        </FileTrigger>
      </div>
      {running && <p className="t-notice">{m.backup_running()}</p>}
      <ConfirmDialog
        isOpen={file !== null}
        onOpenChange={(open) => !open && setFile(null)}
        title={m.backup_title()}
        confirm={m.backup_restore_confirm()}
        pending={restore.isPending}
        onConfirm={() => {
          if (!file || busy("restoreBackup")) return;
          restore.mutate(file, { onSettled: () => setFile(null) });
        }}
      >
        {m.backup_restore_text()}
      </ConfirmDialog>
    </section>
  );
}

/**
 * The program's version, a button that checks for an update now, and the
 * switch for the daily update check. The check works with the switch off and
 * during a sitting; its answer shows under the button.
 */
function About(props: { settings: SettingsInfo; port: number }) {
  const version = useAbout().data?.version;
  const save = useSaveSettings();
  const check = useCheckUpdates();
  const open = useOpenLink();
  return (
    <section className="t-panel t-section">
      <h2>{m.about_title()}</h2>
      {version && (
        <p className="t-muted">
          {version === "dev"
            ? m.about_version_dev()
            : m.about_version({ version })}
        </p>
      )}
      <Button
        className="t-btn"
        data-variant="quiet"
        isPending={check.isPending}
        onPress={() => check.mutate()}
      >
        {m.about_check_now()}
      </Button>
      {check.isError && <p className="t-muted">{m.about_check_failed()}</p>}
      {check.data &&
        (check.data.latest ? (
          <p className="t-muted">
            {m.update_title({ latest: check.data.latest })}{" "}
            <Button
              className="t-btn"
              data-variant="quiet"
              onPress={() => open.mutate("download")}
            >
              {m.update_download()}
            </Button>
          </p>
        ) : (
          <p className="t-muted">{m.about_up_to_date()}</p>
        ))}
      <SwitchField
        className="t-about-switch"
        isSelected={props.settings.checkUpdates}
        onChange={(checkUpdates) =>
          save.mutate({ ...props.settings, port: props.port, checkUpdates })
        }
      >
        <SwitchButton className="j-switch-btn">
          <i className="j-switch-track" aria-hidden="true" />
          {m.about_check_updates()}
        </SwitchButton>
        <Text slot="description">{m.about_check_updates_hint()}</Text>
      </SwitchField>
    </section>
  );
}

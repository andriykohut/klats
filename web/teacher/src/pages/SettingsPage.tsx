import type {
  NetworkInfo,
  SettingsInfo,
} from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  Radio,
  RadioGroup,
  Text,
  TextField,
} from "react-aria-components";
import {
  busy,
  useNetwork,
  useSaveSettings,
  useSetAddress,
  useSettings,
} from "../api/queries";
import { setFlags, useFlags } from "../flags";
import { parsePort } from "../forms";
import { Icon } from "../ui/icons";
import { LoadError } from "../ui/LoadError";
import { notify } from "../ui/Toasts";
import "./settings.css";

/** The student address, the UI language and the student port. */
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
        </div>
      </div>
    </div>
  );
}

function Address({ net }: { net: NetworkInfo }) {
  const choose = useSetAddress();
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
            ? m.banner_port_busy({ port: net.port })
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
        onChange={(language) => save.mutate({ port: props.port, language })}
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
            { port, language: props.settings.language },
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

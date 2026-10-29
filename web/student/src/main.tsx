import "@klats/shared/fonts.css";
import "@klats/shared/tokens.css";
import "./app.css";
import { isAnswered } from "@klats/shared/answers.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { ConnectionToast } from "@klats/shared/student-ui/ConnectionToast.tsx";
import { FinishScreen } from "@klats/shared/student-ui/FinishScreen.tsx";
import { Progress } from "@klats/shared/student-ui/Progress.tsx";
import { Timer } from "@klats/shared/student-ui/Timer.tsx";
import { AnimatePresence, MotionConfig } from "motion/react";
import { Fragment, useSyncExternalStore } from "react";
import { I18nProvider } from "react-aria-components";
import { createRoot } from "react-dom/client";
import {
  answer,
  boot,
  changeAddress,
  finishTest,
  getState,
  go,
  joined,
  picked,
  refreshNames,
  rejoin,
  show,
  subscribe,
  tryAgain,
} from "./app";
import { AddressChanged } from "./screens/AddressChanged";
import { JoinCode } from "./screens/JoinCode";
import { Kicked, Moved } from "./screens/Kicked";
import { OtherTab } from "./screens/OtherTab";
import { PickName } from "./screens/PickName";
import { Review } from "./screens/Review";
import { TakeTest } from "./screens/TakeTest";
import { TypedName } from "./screens/TypedName";
import { Unreachable } from "./screens/Unreachable";

/** Screens of a loaded test, which show its title and the connection. */
const TEST_SCREENS = new Set(["test", "review", "finish", "address"]);

function App() {
  const s = useSyncExternalStore(subscribe, getState);
  const { screen, test } = s;
  const inTest = TEST_SCREENS.has(screen.name) && s.title !== "";
  const offline = s.net.state === "offline";
  const timer = s.deadline !== null && <Timer remainingMs={s.remainingMs} />;
  // A forward-only test gets no way to jump back; Skip and Next only go on.
  const jump = test?.navigation === "forward" ? undefined : go;

  let content = null;
  switch (screen.name) {
    case "join":
      content = <JoinCode key="join" initial={screen.code} onJoined={joined} />;
      break;
    case "pick":
      content = (
        <PickName
          key="pick"
          code={screen.code}
          info={screen.info}
          onPicked={picked}
          onRefresh={refreshNames}
          onBack={() => show({ name: "join", code: "" })}
        />
      );
      break;
    case "typed":
      content = (
        <TypedName
          key="typed"
          code={screen.code}
          info={screen.info}
          onPicked={picked}
          onBack={() => show({ name: "join", code: "" })}
        />
      );
      break;
    case "test":
      if (test) {
        content = (
          <TakeTest
            key={test.questions[s.index].id}
            test={test}
            index={s.index}
            answers={s.answers}
            onAnswer={answer}
            onGo={go}
            onReview={() => show({ name: "review" })}
            readOnly={s.timeUp}
            timer={timer}
          />
        );
      }
      break;
    case "review":
      if (test) {
        content = (
          <Review
            key="review"
            test={test}
            answers={s.answers}
            onGo={jump}
            onBack={() => show({ name: "test" })}
            onFinish={finishTest}
            timer={timer}
          />
        );
      }
      break;
    case "finish":
      content = (
        <FinishScreen
          key="finish"
          result={s.result}
          timeUp={s.timeUp}
          askTeacher={s.askTeacher}
        />
      );
      break;
    case "kicked":
      content = <Kicked key="kicked" onPick={rejoin} />;
      break;
    case "moved":
      content = <Moved key="moved" saved={s.drained} />;
      break;
    case "otherTab":
      content = <OtherTab key="otherTab" />;
      break;
    case "unreachable":
      content = <Unreachable key="unreachable" onRetry={tryAgain} />;
      break;
    case "address":
      content = (
        <AddressChanged
          key="address"
          onConnect={(url) => changeAddress(url, screen.back)}
          onCancel={() => show(screen.back)}
        />
      );
      break;
  }

  return (
    <Fragment key={s.lang}>
      <div className="s-top">
        {inTest ? (
          <div className="s-title">{s.title}</div>
        ) : (
          <div className="s-brand">{m.app_name()}</div>
        )}
        {test && screen.name === "test" && (
          <Progress
            answered={test.questions.map((q) => isAnswered(q, s.answers[q.id]))}
            current={s.index}
            onJump={jump}
          />
        )}
        <div className="s-who">{inTest && s.name}</div>
      </div>
      {inTest && (
        <ConnectionToast
          state={s.net.state}
          pending={s.net.pending}
          action={
            offline &&
            screen.name !== "address" && (
              <button
                type="button"
                className="s-toast-link"
                onClick={() => show({ name: "address", back: screen })}
              >
                {m.address_link()}
              </button>
            )
          }
        />
      )}
      <main className="s-slot">
        <AnimatePresence mode="wait">{content}</AnimatePresence>
      </main>
      {s.saveFailed && <p className="s-note">{m.save_failed()}</p>}
    </Fragment>
  );
}

/** Gives React Aria's own strings, such as a popover's dismiss label, the app's language. */
function Root() {
  const lang = useSyncExternalStore(subscribe, () => getState().lang);
  return (
    <I18nProvider locale={lang === "uk" ? "uk-UA" : "en-US"}>
      <App />
    </I18nProvider>
  );
}

// Mounts only while the old-browser notice in index.html stays hidden: a
// browser below the floor gets the notice instead of the app.
if (document.getElementById("old")?.hidden) {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <MotionConfig reducedMotion="user">
      <Root />
    </MotionConfig>,
  );
  void boot();
}

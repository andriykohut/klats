import "@klats/shared/fonts.css";
import "@klats/shared/tokens.css";
import "./app.css";
import { isAnswered } from "@klats/shared/answers.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { ConnectionToast } from "@klats/shared/student-ui/ConnectionToast.tsx";
import { FinishScreen } from "@klats/shared/student-ui/FinishScreen.tsx";
import { Progress } from "@klats/shared/student-ui/Progress.tsx";
import { AnimatePresence, MotionConfig } from "motion/react";
import { Fragment, useSyncExternalStore } from "react";
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
            onGo={go}
            onBack={() => show({ name: "test" })}
            onFinish={finishTest}
          />
        );
      }
      break;
    case "finish":
      content = <FinishScreen key="finish" result={s.result} />;
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
            answered={test.questions.map((q) => isAnswered(s.answers[q.id]))}
            current={s.index}
            onJump={go}
          />
        )}
        {/* shortcut: no timer chip beside the name, as this version has no
            time limits and Status.remainingMs is always null; add it here
            with them. */}
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

// Mounts only while the old-browser notice in index.html stays hidden: a
// browser below the floor gets the notice instead of the app.
if (document.getElementById("old")?.hidden) {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>,
  );
  void boot();
}

import "@klats/shared/fonts.css";
import "@klats/shared/tokens.css";
import "./ui/base.css";
import { applyPalette } from "@klats/shared/palettes.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient, settingsQuery } from "./api/queries";
import { subscribeTeacherEvents } from "./events";
import { applyLocale } from "./locale";
import { router } from "./router";

applyPalette(document.documentElement, "teal");
subscribeTeacherEvents(queryClient);

// The saved language is loaded before the first render, so the first frame is
// already in it. A failure (a 401) is reported by the query cache.
queryClient
  .fetchQuery(settingsQuery)
  .then((s) => applyLocale(s.language))
  .catch(() => {})
  .finally(() => {
    createRoot(document.getElementById("root") as HTMLElement).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    );
  });

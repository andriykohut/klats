import type { Test } from "@klats/shared/generated/testfmt.ts";
import type {
  Class,
  SettingsInfo,
  TestDoc,
  TestSummary,
} from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import {
  keepPreviousData,
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { setFlags } from "../flags";
import { applyLocale } from "../locale";
import { notify, toasts } from "../ui/Toasts";
import { undoWindow } from "../undo";
import * as api from "./client";

/*
 * Query keys: ["tests"] and ["tests", id], ["classes"] and ["classes", id],
 * ["live"], ["assignments"], ["results", id], ["network"], ["settings"],
 * ["parse", text]. The event stream (events.ts) invalidates ["live"].
 */

/** How long a deleted test can be brought back before the DELETE is sent. */
export const UNDO_MS = 6000;

function unauthorized(err: Error): void {
  if (err instanceof api.ApiError && err.status === 401) {
    setFlags({ unauthorized: true });
  }
}

/**
 * The app's query client. A 401 anywhere shows the "open from the desktop
 * app" page. A failed mutation without its own `onError` shows a generic error
 * toast. HTTP errors are not retried: the server is on this computer, so
 * they would only repeat.
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: unauthorized }),
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      unauthorized(err);
      if (!mutation.options.onError) notify(m.error_server(), true);
    },
  }),
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof api.ApiError) && count < 2,
    },
  },
});

export const useTests = () =>
  useQuery({ queryKey: ["tests"], queryFn: api.listTests });

export const useTest = (id: string) =>
  useQuery({ queryKey: ["tests", id], queryFn: () => api.getTest(id) });

/** Creates an empty test titled in the UI language, and caches it. */
export function useCreateTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.createTest(m.tests_new()),
    onSuccess: (doc) => {
      qc.setQueryData(["tests", doc.id], doc);
      return qc.invalidateQueries({ queryKey: ["tests"], exact: true });
    },
  });
}

/**
 * Saves test `id`. On success the cached TestDoc takes the saved test, its
 * problems and savedAt, and the library list refetches when next shown.
 */
export function useSaveTest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (test: Test) => api.saveTest(id, test),
    onSuccess: (res, test) => {
      qc.setQueryData<TestDoc>(
        ["tests", id],
        (doc) => doc && { ...doc, test, ...res },
      );
      return qc.invalidateQueries({ queryKey: ["tests"], exact: true });
    },
  });
}

/**
 * Deletes a test after {@link UNDO_MS}, while a toast offers «Скасувати».
 * The deletion stays pending through the wait, so {@link useDeletingTests}
 * hides the row at once; an undo or a failed DELETE ends it and the row comes
 * back, the failure with an error toast. A deletion still waiting when the
 * window closes is never sent.
 */
export function useDeleteTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deleteTest"],
    mutationFn: async (t: TestSummary) => {
      const w = undoWindow(UNDO_MS);
      const key = toasts.add({
        text: m.tests_deleted(),
        action: { label: m.action_undo(), onAction: w.undo },
      });
      const commit = await w.done;
      toasts.close(key);
      if (commit) await api.deleteTest(t.id);
    },
    onError: () => notify(m.tests_delete_failed(), true),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tests"] }),
  });
}

/** Returns the ids of the tests whose deletion is pending. */
export const useDeletingTests = () =>
  useMutationState({
    filters: { mutationKey: ["deleteTest"], status: "pending" },
    select: (mut) => (mut.state.variables as TestSummary).id,
  });

export const useClasses = () =>
  useQuery({ queryKey: ["classes"], queryFn: api.listClasses });

export const useClass = (id: string) =>
  useQuery({ queryKey: ["classes", id], queryFn: () => api.getClass(id) });

/**
 * Previews the names the server finds in pasted `text`. While a new text is
 * parsed, the previous preview stays.
 */
export const useParse = (text: string) =>
  useQuery({
    queryKey: ["parse", text],
    queryFn: () => api.parseClass(text),
    enabled: text.trim() !== "",
    placeholderData: keepPreviousData,
  });

function useClassSaved() {
  const qc = useQueryClient();
  return (c: Class) => {
    qc.setQueryData(["classes", c.id], c);
    return qc.invalidateQueries({ queryKey: ["classes"], exact: true });
  };
}

export function useCreateClass() {
  const saved = useClassSaved();
  return useMutation({ mutationFn: api.createClass, onSuccess: saved });
}

export function useSaveClass() {
  const saved = useClassSaved();
  return useMutation({ mutationFn: api.saveClass, onSuccess: saved });
}

export function useDeleteClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteClass,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["classes"], exact: true }),
  });
}

/** The live view; null when no sitting has run since launch. */
export const useLive = () =>
  useQuery({ queryKey: ["live"], queryFn: api.live });

export const useAssignments = () =>
  useQuery({ queryKey: ["assignments"], queryFn: api.listAssignments });

export const useResults = (id: string) =>
  useQuery({ queryKey: ["results", id], queryFn: () => api.results(id) });

export const useNetwork = () =>
  useQuery({ queryKey: ["network"], queryFn: api.getNetwork });

/** Chooses the student address; the reply replaces the cached NetworkInfo. */
export function useSetAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.setAddress,
    onSuccess: (info) => qc.setQueryData(["network"], info),
  });
}

export const settingsQuery = {
  queryKey: ["settings"],
  queryFn: api.getSettings,
};

export const useSettings = () => useQuery(settingsQuery);

/** Saves the settings and switches the UI to the saved language at once. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (s: SettingsInfo) => {
      applyLocale(s.language);
      qc.setQueryData(["settings"], s);
    },
  });
}

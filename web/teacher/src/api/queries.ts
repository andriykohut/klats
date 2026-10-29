import type { Test } from "@klats/shared/generated/testfmt.ts";
import type {
  Class,
  OverrideRequest,
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
 * ["parse", text]. The event stream (events.ts) invalidates ["live"] and the
 * results of the live view's assignment.
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

/**
 * Whether a mutation with `key` is in flight. The cache turns a mutation
 * pending as `mutate` is called, so a press handler that checks this first
 * drops a second press that lands before the button re-renders as pending.
 */
export const busy = (key: string) =>
  queryClient.isMutating({ mutationKey: [key] }) > 0;

export const useTests = () =>
  useQuery({ queryKey: ["tests"], queryFn: api.listTests });

export const useTest = (id: string) =>
  useQuery({ queryKey: ["tests", id], queryFn: () => api.getTest(id) });

/** Creates an empty test titled in the UI language, and caches it. Key: "createTest". */
export function useCreateTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["createTest"],
    mutationFn: () => api.createTest(m.tests_new()),
    onSuccess: (doc) => {
      qc.setQueryData(["tests", doc.id], doc);
      return qc.invalidateQueries({ queryKey: ["tests"], exact: true });
    },
  });
}

/**
 * Saves test `id`. On success the cached TestDoc takes the saved test, its
 * problems and savedAt, and the library list refetches when next shown. A
 * failure shows no toast: the builder's saved indicator reports it and
 * retries.
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
    onError: () => {},
  });
}

/**
 * Deletes a test after {@link UNDO_MS}, while a toast naming it offers
 * «Скасувати». The deletion stays pending through the wait, so
 * {@link useDeletingTests} hides the row at once; an undo or a failed DELETE
 * ends it and the row comes back, the failure with an error toast. A deletion
 * still waiting when the window closes is never sent.
 */
export function useDeleteTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deleteTest"],
    mutationFn: async (t: TestSummary) => {
      const w = undoWindow(UNDO_MS);
      const key = toasts.add({
        text: m.tests_deleted({ title: t.title }),
        action: { label: m.action_undo(), onAction: w.undo },
      });
      const commit = await w.done;
      toasts.close(key);
      if (commit) await api.deleteTest(t.id);
      return commit;
    },
    onSuccess: (deleted, t) => {
      if (deleted) qc.removeQueries({ queryKey: ["tests", t.id], exact: true });
    },
    onError: () => notify(m.tests_delete_failed(), true),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tests"], exact: true }),
  });
}

/** Returns the ids of the tests whose deletion is pending. */
export const useDeletingTests = () =>
  useMutationState({
    filters: { mutationKey: ["deleteTest"], status: "pending" },
    select: (mut) => (mut.state.variables as TestSummary).id,
  });

/**
 * Stores a copy of a test titled «{title} (копія)», which the library lists
 * first. Key: "duplicateTest".
 */
export function useDuplicateTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["duplicateTest"],
    mutationFn: (t: TestSummary) =>
      api.duplicateTest(t.id, m.tests_copy_title({ title: t.title })),
    onSuccess: (doc) => {
      qc.setQueryData(["tests", doc.id], doc);
      return qc.invalidateQueries({ queryKey: ["tests"], exact: true });
    },
  });
}

/** The toasts for the refusals of a test export, by error code. */
const exportTestErrors: Record<string, () => string> = {
  too_large: m.tests_file_too_large,
  write_failed: m.file_write_failed,
};

/**
 * Exports a test as a .klats file (see {@link api.exportTest}). A test too
 * large to open again and a file that cannot be written each get their own
 * error toast. Key: "exportTest".
 */
export const useExportTest = () =>
  useMutation({
    mutationKey: ["exportTest"],
    mutationFn: (id: string) => api.exportTest(id),
    onError: (err) => {
      const text = err instanceof api.ApiError && exportTestErrors[err.code];
      notify(text ? text() : m.error_server(), true);
    },
  });

/** The toasts for the files the server refuses to open, by error code. */
const openErrors: Record<string, () => string> = {
  file_damaged: m.tests_file_damaged,
  test_too_new: m.tests_file_too_new,
  too_large: m.tests_file_too_large,
};

/**
 * Opens a .klats file as a new test, which the library lists first, and names
 * it in a toast. A damaged file, a test from a newer version and a file over
 * the size cap each get their own error toast. Key: "importTest".
 */
export function useImportTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["importTest"],
    mutationFn: (file: File) => api.importTest(file),
    onSuccess: (doc) => {
      qc.setQueryData(["tests", doc.id], doc);
      notify(m.tests_opened({ title: doc.test.title }));
      return qc.invalidateQueries({ queryKey: ["tests"], exact: true });
    },
    onError: (err) => {
      const text = err instanceof api.ApiError && openErrors[err.code];
      notify(text ? text() : m.error_server(), true);
    },
  });
}

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

/** Creates a class. Key: "saveClass", shared with {@link useSaveClass}. */
export function useCreateClass() {
  const saved = useClassSaved();
  return useMutation({
    mutationKey: ["saveClass"],
    mutationFn: api.createClass,
    onSuccess: saved,
  });
}

/** Saves a class. Key: "saveClass". */
export function useSaveClass() {
  const saved = useClassSaved();
  return useMutation({
    mutationKey: ["saveClass"],
    mutationFn: api.saveClass,
    onSuccess: saved,
  });
}

/**
 * Deletes a class. Its own query goes once the list has refetched without
 * it, so no view of it is left to refetch it. Key: "deleteClass".
 */
export function useDeleteClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deleteClass"],
    mutationFn: api.deleteClass,
    onSuccess: async (_, id) => {
      await qc.invalidateQueries({ queryKey: ["classes"], exact: true });
      qc.removeQueries({ queryKey: ["classes", id], exact: true });
    },
  });
}

/**
 * The live view; null when no sitting has run since launch. The event stream
 * refetches it on each change, and it also refetches every 10 s, in case the
 * stream stalls without closing.
 */
export const useLive = () =>
  useQuery({ queryKey: ["live"], queryFn: api.live, refetchInterval: 10_000 });

/**
 * Ends the running sitting. The live view and the results list refetch.
 * Key: "endSitting".
 */
export function useEndSitting() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["endSitting"],
    mutationFn: api.endSitting,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments"] });
      return qc.invalidateQueries({ queryKey: ["live"] });
    },
  });
}

/** A live-view action: the live view refetches once it is done. */
function useLiveAction<T>(key: string, fn: (vars: T) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [key],
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["live"] }),
  });
}

/** Kicks a participant by id. Key: "kick". */
export const useKick = () => useLiveAction("kick", api.kick);

/** Gives a participant more minutes. Key: "addTime". */
export const useAddTime = () =>
  useLiveAction("addTime", (v: { id: string; minutes: number }) =>
    api.addTime(v.id, v.minutes),
  );

/** Answers a pinned event. Key: "resolve". */
export const useResolveEvent = () =>
  useLiveAction("resolve", (v: { id: string; action: string }) =>
    api.resolveEvent(v.id, v.action),
  );

/** Renames a device. Key: "renameDevice". */
export const useRenameDevice = () =>
  useLiveAction("renameDevice", (v: { token: string; label: string }) =>
    api.renameDevice(v.token, v.label),
  );

export const useAssignments = () =>
  useQuery({ queryKey: ["assignments"], queryFn: api.listAssignments });

export const useResults = (id: string) =>
  useQuery({ queryKey: ["results", id], queryFn: () => api.results(id) });

/**
 * Sets or clears an override on assignment `id`; the reply replaces the
 * cached results, so the grade changes at once. Overrides run one at a time,
 * in the order they were made, so a slower reply never overwrites a newer one;
 * a results fetch in flight is cancelled first for the same reason.
 */
export function useSetOverride(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["override"],
    scope: { id: `override-${id}` },
    onMutate: () => qc.cancelQueries({ queryKey: ["results", id] }),
    mutationFn: (req: OverrideRequest) => api.setOverride(id, req),
    onSuccess: (res) => {
      qc.setQueryData(["results", id], res);
      return qc.invalidateQueries({ queryKey: ["assignments"] });
    },
  });
}

/**
 * Exports assignment `id` to Excel (see {@link api.exportResults}); the
 * results refetch, as a finished export clears «Експорт застарів». A file
 * that cannot be written gets its own error toast. Key: "export".
 */
export function useExport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["export"],
    mutationFn: () => api.exportResults(id),
    onError: (err) =>
      notify(
        err instanceof api.ApiError && err.code === "write_failed"
          ? m.results_write_failed()
          : m.error_server(),
        true,
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ["results", id] }),
  });
}

/** The toasts for the refusals of a backup, by error code. */
const backupErrors: Record<string, () => string> = {
  sitting_active: m.backup_running,
  file_damaged: m.tests_file_damaged,
  backup_too_new: m.backup_too_new,
  too_large: m.tests_file_too_large,
  write_failed: m.file_write_failed,
};

function backupFailed(err: Error) {
  const text = err instanceof api.ApiError && backupErrors[err.code];
  notify(text ? text() : m.error_server(), true);
}

/** Exports a backup (see {@link api.exportBackup}). Key: "exportBackup". */
export const useExportBackup = () =>
  useMutation({
    mutationKey: ["exportBackup"],
    mutationFn: api.exportBackup,
    onError: backupFailed,
  });

/**
 * Restores a backup (see {@link api.restoreBackup}) and names it in a toast;
 * every query refetches, as the data under all of them changed. Key:
 * "restoreBackup".
 */
export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["restoreBackup"],
    mutationFn: (file: File) => api.restoreBackup(file),
    onSuccess: () => {
      notify(m.backup_restored());
      return qc.invalidateQueries();
    },
    onError: backupFailed,
  });
}

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

/**
 * Saves the settings and switches the UI to the saved language at once. The
 * network info refetches too: while the student server is down, its port is
 * the saved one. Key: "saveSettings".
 */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["saveSettings"],
    mutationFn: api.saveSettings,
    onSuccess: (s: SettingsInfo) => {
      applyLocale(s.language);
      qc.setQueryData(["settings"], s);
      return qc.invalidateQueries({ queryKey: ["network"] });
    },
  });
}

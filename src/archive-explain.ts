import type {
  ArchiveExplainStep,
  CreateFolderArchiveStreamOptions,
} from "./types.js";

const DEFAULT_TRACE_CAP = 2000;

export type ExplainFiltersSummary = Extract<
  ArchiveExplainStep,
  { kind: "archive.config" }
>["filters"];

export function summarizeFiltersForExplain(
  f: CreateFolderArchiveStreamOptions["filters"],
): ExplainFiltersSummary {
  if (!f) return "none";
  const hasInc = Boolean(f.include?.length);
  const hasExc = Boolean(f.exclude?.length);
  const hasSize = f.minSizeBytes != null || f.maxSizeBytes != null;
  const hasPred = Boolean(f.predicate);
  const n = [hasInc, hasExc, hasSize, hasPred].filter(Boolean).length;
  if (n === 0) return "none";
  if (n > 1) return "mixed";
  if (hasInc) return "include";
  if (hasExc) return "exclude";
  if (hasSize) return "size";
  return "predicate";
}

export function createExplainEmitter(
  options: CreateFolderArchiveStreamOptions,
  cap = DEFAULT_TRACE_CAP,
): {
  emit: (step: ArchiveExplainStep) => void;
  finishTrace: () => ArchiveExplainStep[] | undefined;
} {
  if (!options.explain) {
    return {
      emit: () => {
        /* no-op */
      },
      finishTrace: () => undefined,
    };
  }
  const trace: ArchiveExplainStep[] = [];
  const emit = (step: ArchiveExplainStep): void => {
    options.onExplainStep?.(step);
    if (!options.onExplainStep && trace.length < cap) {
      trace.push(step);
    }
  };
  const finishTrace = (): ArchiveExplainStep[] | undefined =>
    options.onExplainStep ? undefined : trace;
  return { emit, finishTrace };
}

import { defaultTimelineCalendar } from "./calendar";
import type {
  TimelineBranchInput,
  TimelineCalendar,
  TimelineEdgeLayout,
  TimelineLaneLayout,
  TimelineLayout,
  TimelineLayoutDiagnostic,
  TimelineLayoutInput,
  TimelineLayoutResult,
  TimelineLayoutTokens,
  TimelineMonthBand,
  TimelineNodeAccessibility,
  TimelineNodeLayout,
  TimelineProjectionInput,
  TimelineZone,
} from "./types";

export const DEFAULT_TIMELINE_LAYOUT_TOKENS: Readonly<TimelineLayoutTokens> = Object.freeze({
  leftPadding: 56,
  rightPadding: 80,
  topPadding: 132,
  bottomPadding: 112,
  nominalMonthWidth: 144,
  minimumMilestoneGap: 176,
  minimumProjectionGap: 168,
  laneGap: 220,
  undatedSectionGap: 96,
  undatedItemGap: 168,
  labelTierGap: 28,
  labelAngleDegrees: -45,
  maximumVisibleTitleGraphemes: 36,
  averageGraphemeWidth: 7.5,
  labelClearance: 12,
  labelBaseExtent: 112,
  monthAxisGap: 42,
});

type AnchorKind = "boundary" | "milestone" | "projection";

interface Anchor {
  key: string;
  id: string;
  kind: AnchorKind;
  nominalEpochMs: number;
  nominalX: number;
  monthKey: string;
  projectionOrder?: number;
}

interface DraftNode {
  id: string;
  sourceKind: "milestone" | "roadmap";
  x: number;
  laneIndex: number;
  branchId: string;
  treatment: TimelineNodeLayout["treatment"];
  status: TimelineNodeLayout["status"];
  fullTitle: string;
  visibleTitle: string;
  titleWasTruncated: boolean;
  monthKey?: string;
  exactTimestampIso?: string;
  plannedFor?: string;
  currentState?: string;
  calloutLabel?: "CURRENT STATE";
  labelSide: "above" | "below";
  labelTier: number;
  target: TimelineNodeLayout["target"];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function snapCoordinate(value: number): number {
  return Math.round(value);
}

function anchorRank(kind: AnchorKind): number {
  return kind === "boundary" ? 0 : kind === "milestone" ? 1 : 2;
}

function compareAnchors(left: Anchor, right: Anchor): number {
  if (left.nominalEpochMs !== right.nominalEpochMs) {
    return left.nominalEpochMs - right.nominalEpochMs;
  }
  const rank = anchorRank(left.kind) - anchorRank(right.kind);
  if (rank !== 0) return rank;
  if (left.kind === "projection" && right.kind === "projection") {
    const order = (left.projectionOrder ?? 0) - (right.projectionOrder ?? 0);
    if (order !== 0) return order;
  }
  return compareText(left.id, right.id);
}

function milestoneKey(id: string): string {
  return `milestone:${id}`;
}

function projectionKey(id: string): string {
  return `projection:${id}`;
}

function boundaryKey(monthKey: string): string {
  return `boundary:${monthKey}`;
}

function segmentGraphemes(value: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(value)].map((part) => part.segment);
}

function visibleTitle(
  title: string,
  maximumGraphemes: number,
): { value: string; truncated: boolean; graphemeCount: number } {
  const graphemes = segmentGraphemes(title);
  if (graphemes.length <= maximumGraphemes) {
    return { value: title, truncated: false, graphemeCount: graphemes.length };
  }
  const kept = graphemes.slice(0, maximumGraphemes);
  return { value: `${kept.join("")}…`, truncated: true, graphemeCount: kept.length + 1 };
}

function mergedTokens(overrides: Partial<TimelineLayoutTokens>): TimelineLayoutTokens {
  return { ...DEFAULT_TIMELINE_LAYOUT_TOKENS, ...overrides };
}

function invalidTokens(tokens: TimelineLayoutTokens): TimelineLayoutDiagnostic | undefined {
  for (const [name, value] of Object.entries(tokens)) {
    const permitsNegative = name === "labelAngleDegrees";
    if (!Number.isFinite(value) || (!permitsNegative && value <= 0)) {
      return {
        code: "non-finite-coordinate",
        message: `timeline token ${name} must be a positive finite number`,
      };
    }
  }
  return undefined;
}

function emptyLayout(tokens: TimelineLayoutTokens): TimelineLayout {
  return {
    timeScale: { kind: "compressed-calendar", proportional: false },
    width: tokens.leftPadding + tokens.rightPadding,
    height: tokens.topPadding + tokens.bottomPadding,
    lanes: [],
    nodes: [],
    edges: [],
    monthBands: [],
    zones: [],
    navigation: {},
    readingOrder: [],
  };
}

function branchLaneOrder(
  input: TimelineLayoutInput,
  milestones: readonly TimelineLayoutInput["milestones"][number][],
  diagnostics: TimelineLayoutDiagnostic[],
): { branches: TimelineBranchInput[]; laneByBranch: Map<string, number> } {
  const branchById = new Map(input.branches.map((branch) => [branch.id, branch]));
  const firstByBranch = new Map<string, TimelineLayoutInput["milestones"][number]>();
  for (const milestone of milestones) {
    if (!branchById.has(milestone.branchId)) {
      diagnostics.push({
        code: "missing-branch",
        recordId: milestone.id,
        message: `milestone ${milestone.id} references missing branch ${milestone.branchId}`,
      });
      continue;
    }
    const prior = firstByBranch.get(milestone.branchId);
    if (
      prior === undefined ||
      milestone.occurredAtEpochMs < prior.occurredAtEpochMs ||
      (milestone.occurredAtEpochMs === prior.occurredAtEpochMs && milestone.id < prior.id)
    ) {
      firstByBranch.set(milestone.branchId, milestone);
    }
  }
  for (const branch of input.branches) {
    if (!firstByBranch.has(branch.id)) {
      diagnostics.push({
        code: "empty-branch",
        recordId: branch.id,
        message: `branch ${branch.id} has no milestone to place`,
      });
    }
  }
  const branches = [...input.branches].sort((left, right) => {
    const leftFirst = firstByBranch.get(left.id);
    const rightFirst = firstByBranch.get(right.id);
    if (leftFirst === undefined || rightFirst === undefined) return compareText(left.id, right.id);
    return (
      leftFirst.occurredAtEpochMs - rightFirst.occurredAtEpochMs ||
      compareText(leftFirst.id, rightFirst.id) ||
      compareText(left.id, right.id)
    );
  });
  return {
    branches,
    laneByBranch: new Map(branches.map((branch, index) => [branch.id, index])),
  };
}

function monthKeys(
  firstMonth: string,
  lastMonth: string,
  calendar: TimelineCalendar,
): string[] {
  const result: string[] = [];
  let current = firstMonth;
  for (let guard = 0; guard < 2400; guard += 1) {
    result.push(current);
    if (current === lastMonth) return result;
    current = calendar.nextMonthKey(current);
  }
  throw new Error(`month range ${firstMonth} through ${lastMonth} is too large`);
}

function assignLabelTiers(nodes: DraftNode[], tokens: TimelineLayoutTokens): void {
  const buckets = new Map<string, DraftNode[]>();
  for (const node of nodes) {
    const key = `${node.laneIndex}:${node.labelSide}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(node);
    buckets.set(key, bucket);
  }
  const horizontalFactor = Math.abs(Math.cos((tokens.labelAngleDegrees * Math.PI) / 180));
  for (const bucket of buckets.values()) {
    bucket.sort(
      (left, right) =>
        left.x - right.x ||
        (left.sourceKind === right.sourceKind ? 0 : left.sourceKind === "milestone" ? -1 : 1) ||
        compareText(left.id, right.id),
    );
    const tierEnds: number[] = [];
    for (const node of bucket) {
      const graphemeCount = segmentGraphemes(node.visibleTitle).length;
      const footprint =
        graphemeCount * tokens.averageGraphemeWidth * horizontalFactor + tokens.labelClearance * 2;
      const start = node.x - footprint / 2;
      const end = node.x + footprint / 2;
      let tier = tierEnds.findIndex((lastEnd) => start >= lastEnd + tokens.labelClearance);
      if (tier < 0) tier = tierEnds.length;
      tierEnds[tier] = end;
      node.labelTier = tier;
    }
  }
}

function withDiagnostic(
  code: TimelineLayoutDiagnostic["code"],
  message: string,
  recordId?: string,
): TimelineLayoutResult {
  return {
    ok: false,
    diagnostics: [{ code, message, ...(recordId === undefined ? {} : { recordId }) }],
  };
}

export function layoutTimeline(
  input: TimelineLayoutInput,
  tokenOverrides: Partial<TimelineLayoutTokens> = {},
  calendar: TimelineCalendar = defaultTimelineCalendar,
): TimelineLayoutResult {
  const tokens = mergedTokens(tokenOverrides);
  const tokenIssue = invalidTokens(tokens);
  if (tokenIssue !== undefined) return { ok: false, diagnostics: [tokenIssue] };
  if (input.milestones.length === 0) return { ok: true, value: emptyLayout(tokens) };

  const diagnostics: TimelineLayoutDiagnostic[] = [];
  const historical = [...input.milestones].sort(
    (left, right) =>
      left.occurredAtEpochMs - right.occurredAtEpochMs || compareText(left.id, right.id),
  );
  for (const milestone of historical) {
    if (!Number.isFinite(milestone.occurredAtEpochMs)) {
      diagnostics.push({
        code: "invalid-time",
        recordId: milestone.id,
        message: `milestone ${milestone.id} has a non-finite occurred-at instant`,
      });
    }
  }
  const milestoneById = new Map(historical.map((milestone) => [milestone.id, milestone]));
  const { branches, laneByBranch } = branchLaneOrder(input, historical, diagnostics);
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));

  let currentMilestone =
    input.current === undefined ? undefined : milestoneById.get(input.current.milestoneId);
  if (input.current !== undefined && currentMilestone === undefined) {
    diagnostics.push({
      code: "missing-current",
      recordId: input.current.milestoneId,
      message: `current milestone ${input.current.milestoneId} is not present`,
    });
  }
  if (input.projection.length > 0 && input.current === undefined) {
    diagnostics.push({
      code: "projection-without-current",
      message: "projected roadmap items require an explicit current milestone",
    });
  }
  if (currentMilestone !== undefined) {
    for (const item of input.projection) {
      if (item.branchId !== currentMilestone.branchId) {
        diagnostics.push({
          code: "projection-branch-mismatch",
          recordId: item.id,
          message: `projected item ${item.id} is on ${item.branchId}, not current branch ${currentMilestone.branchId}`,
        });
      }
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const datedProjection: { item: TimelineProjectionInput; order: number; epochMs: number; monthKey: string }[] = [];
  const undatedProjection: { item: TimelineProjectionInput; order: number }[] = [];
  let encounteredUndated = false;
  try {
    for (let order = 0; order < input.projection.length; order += 1) {
      const item = input.projection[order]!;
      if (item.plannedFor === undefined) {
        encounteredUndated = true;
        undatedProjection.push({ item, order });
      } else {
        if (encounteredUndated) {
          return withDiagnostic(
            "projection-order-invalid",
            `dated projected item ${item.id} follows an undated item`,
            item.id,
          );
        }
        const epochMs = calendar.localNoonEpochMs(item.plannedFor, input.displayTimeZone);
        datedProjection.push({
          item,
          order,
          epochMs,
          monthKey: item.plannedFor.slice(0, 7),
        });
      }
    }
  } catch (error) {
    return withDiagnostic(
      "calendar-error",
      `cannot resolve projected date: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let firstMonth: string;
  let lastMonth: string;
  const milestoneMonth = new Map<string, string>();
  try {
    for (const milestone of historical) {
      milestoneMonth.set(
        milestone.id,
        calendar.monthKeyForInstant(milestone.occurredAtEpochMs, input.displayTimeZone),
      );
    }
    firstMonth = milestoneMonth.get(historical[0]!.id)!;
    lastMonth = milestoneMonth.get(historical.at(-1)!.id)!;
    for (const projection of datedProjection) {
      if (projection.monthKey > lastMonth) lastMonth = projection.monthKey;
    }
  } catch (error) {
    return withDiagnostic(
      "calendar-error",
      `cannot resolve historical month: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let months: string[];
  let finalBoundaryMonth: string;
  const monthStarts = new Map<string, number>();
  try {
    months = monthKeys(firstMonth, lastMonth, calendar);
    finalBoundaryMonth = calendar.nextMonthKey(lastMonth);
    for (const month of [...months, finalBoundaryMonth]) {
      monthStarts.set(month, calendar.monthStartEpochMs(month, input.displayTimeZone));
    }
  } catch (error) {
    return withDiagnostic(
      "calendar-error",
      `cannot build month range: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const monthIndex = new Map(months.map((month, index) => [month, index]));
  monthIndex.set(finalBoundaryMonth, months.length);

  const nominalX = (epochMs: number, monthKey: string): number => {
    const index = monthIndex.get(monthKey);
    const start = monthStarts.get(monthKey);
    const nextKey = calendar.nextMonthKey(monthKey);
    const end = monthStarts.get(nextKey);
    if (index === undefined || start === undefined || end === undefined || end <= start) {
      throw new Error(`month ${monthKey} lacks a valid boundary pair`);
    }
    const fraction = Math.max(0, Math.min(1, (epochMs - start) / (end - start)));
    return tokens.leftPadding + (index + fraction) * tokens.nominalMonthWidth;
  };

  const anchors: Anchor[] = [];
  try {
    for (const month of [...months, finalBoundaryMonth]) {
      anchors.push({
        key: boundaryKey(month),
        id: month,
        kind: "boundary",
        nominalEpochMs: monthStarts.get(month)!,
        nominalX: tokens.leftPadding + monthIndex.get(month)! * tokens.nominalMonthWidth,
        monthKey: month,
      });
    }
    for (const milestone of historical) {
      const monthKey = milestoneMonth.get(milestone.id)!;
      anchors.push({
        key: milestoneKey(milestone.id),
        id: milestone.id,
        kind: "milestone",
        nominalEpochMs: milestone.occurredAtEpochMs,
        nominalX: nominalX(milestone.occurredAtEpochMs, monthKey),
        monthKey,
      });
    }
    anchors.sort(compareAnchors);

    for (const projected of datedProjection) {
      const anchor: Anchor = {
        key: projectionKey(projected.item.id),
        id: projected.item.id,
        kind: "projection",
        nominalEpochMs: projected.epochMs,
        nominalX: nominalX(projected.epochMs, projected.monthKey),
        monthKey: projected.monthKey,
        projectionOrder: projected.order,
      };
      let nominalInsertion = anchors.findIndex((candidate) => compareAnchors(anchor, candidate) < 0);
      if (nominalInsertion < 0) nominalInsertion = anchors.length;
      const predecessorKey =
        projected.order === 0
          ? milestoneKey(input.current!.milestoneId)
          : projectionKey(input.projection[projected.order - 1]!.id);
      const predecessorIndex = anchors.findIndex((candidate) => candidate.key === predecessorKey);
      if (predecessorIndex < 0) {
        return withDiagnostic(
          "projection-order-invalid",
          `cannot locate predecessor for projected item ${projected.item.id}`,
          projected.item.id,
        );
      }
      anchors.splice(Math.max(nominalInsertion, predecessorIndex + 1), 0, anchor);
    }
  } catch (error) {
    return withDiagnostic(
      "calendar-error",
      `cannot position timeline anchor: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const anchorX = new Map<string, number>();
  let cumulativeShift = 0;
  let previousAnchorX = Number.NEGATIVE_INFINITY;
  let previousNodeX = Number.NEGATIVE_INFINITY;
  let previousNodeKind: AnchorKind | undefined;
  let previousHistoricalX = Number.NEGATIVE_INFINITY;
  const projectionX = new Map<string, number>();
  for (const anchor of anchors) {
    const base = anchor.nominalX + cumulativeShift;
    let required = Math.max(base, previousAnchorX);
    if (anchor.kind !== "boundary" && Number.isFinite(previousNodeX)) {
      const adjacencyGap =
        anchor.kind === "milestone" && previousNodeKind === "milestone"
          ? tokens.minimumMilestoneGap
          : tokens.minimumProjectionGap;
      required = Math.max(required, previousNodeX + adjacencyGap);
    }
    if (anchor.kind === "milestone" && Number.isFinite(previousHistoricalX)) {
      required = Math.max(required, previousHistoricalX + tokens.minimumMilestoneGap);
    }
    if (anchor.kind === "projection") {
      const order = anchor.projectionOrder!;
      const predecessorX =
        order === 0
          ? anchorX.get(milestoneKey(input.current!.milestoneId))
          : projectionX.get(input.projection[order - 1]!.id);
      if (predecessorX === undefined) {
        return withDiagnostic(
          "projection-order-invalid",
          `cannot resolve predecessor coordinate for projected item ${anchor.id}`,
          anchor.id,
        );
      }
      required = Math.max(required, predecessorX + tokens.minimumProjectionGap);
    }
    if (required > base) cumulativeShift += required - base;
    anchorX.set(anchor.key, required);
    previousAnchorX = required;
    if (anchor.kind !== "boundary") {
      previousNodeX = required;
      previousNodeKind = anchor.kind;
    }
    if (anchor.kind === "milestone") previousHistoricalX = required;
    if (anchor.kind === "projection") projectionX.set(anchor.id, required);
  }

  const laneCount = branches.length;
  const currentLane = currentMilestone === undefined ? undefined : laneByBranch.get(currentMilestone.branchId);
  const draftNodes: DraftNode[] = [];
  for (const milestone of historical) {
    const laneIndex = laneByBranch.get(milestone.branchId)!;
    const isCurrent = input.current?.milestoneId === milestone.id;
    const title = visibleTitle(milestone.title, tokens.maximumVisibleTitleGraphemes);
    const side = isCurrent
      ? laneIndex === laneCount - 1
        ? "below"
        : "above"
      : laneIndex === 0 || laneIndex % 2 === 0
        ? "above"
        : "below";
    draftNodes.push({
      id: milestone.id,
      sourceKind: "milestone",
      x: snapCoordinate(anchorX.get(milestoneKey(milestone.id))!),
      laneIndex,
      branchId: milestone.branchId,
      treatment: isCurrent ? "current" : "historical",
      status: milestone.status,
      fullTitle: milestone.title,
      visibleTitle: title.value,
      titleWasTruncated: title.truncated,
      monthKey: milestoneMonth.get(milestone.id),
      exactTimestampIso: milestone.occurredAtIso,
      ...(isCurrent && input.current !== undefined
        ? { currentState: input.current.state, calloutLabel: "CURRENT STATE" as const }
        : {}),
      labelSide: side,
      labelTier: 0,
      target: { kind: "milestone", id: milestone.id },
    });
  }

  let datedLayoutRight = snapCoordinate(anchorX.get(boundaryKey(finalBoundaryMonth))!);
  for (const projected of datedProjection) {
    const title = visibleTitle(projected.item.title, tokens.maximumVisibleTitleGraphemes);
    const x = snapCoordinate(projectionX.get(projected.item.id)!);
    datedLayoutRight = Math.max(datedLayoutRight, x);
    draftNodes.push({
      id: projected.item.id,
      sourceKind: "roadmap",
      x,
      laneIndex: currentLane!,
      branchId: projected.item.branchId,
      treatment: "planned-dated",
      status: projected.item.status,
      fullTitle: projected.item.title,
      visibleTitle: title.value,
      titleWasTruncated: title.truncated,
      plannedFor: projected.item.plannedFor,
      monthKey: projected.monthKey,
      labelSide: "above",
      labelTier: 0,
      target: { kind: "roadmap", id: projected.item.id },
    });
  }

  const zones: TimelineZone[] = [];
  if (undatedProjection.length > 0) {
    const dividerX = datedLayoutRight + tokens.undatedSectionGap;
    let x = dividerX + tokens.undatedSectionGap;
    for (const projected of undatedProjection) {
      const title = visibleTitle(projected.item.title, tokens.maximumVisibleTitleGraphemes);
      draftNodes.push({
        id: projected.item.id,
        sourceKind: "roadmap",
        x,
        laneIndex: currentLane!,
        branchId: projected.item.branchId,
        treatment: "planned-undated",
        status: projected.item.status,
        fullTitle: projected.item.title,
        visibleTitle: title.value,
        titleWasTruncated: title.truncated,
        labelSide: "above",
        labelTier: 0,
        target: { kind: "roadmap", id: projected.item.id },
      });
      projectionX.set(projected.item.id, x);
      x += tokens.undatedItemGap;
    }
    zones.push({
      kind: "undated-plan",
      xStart: dividerX,
      xEnd: x - tokens.undatedItemGap + tokens.undatedSectionGap,
      y: 0,
      label: "UNDATED PLAN",
    });
  }

  assignLabelTiers(draftNodes, tokens);
  const maxAboveTier = Math.max(
    0,
    ...draftNodes.filter((node) => node.labelSide === "above").map((node) => node.labelTier),
  );
  const maxBelowTier = Math.max(
    0,
    ...draftNodes.filter((node) => node.labelSide === "below").map((node) => node.labelTier),
  );
  const firstLaneY = tokens.topPadding + maxAboveTier * tokens.labelTierGap;
  const lanes: TimelineLaneLayout[] = branches.map((branch, laneIndex) => ({
    branchId: branch.id,
    branchTitle: branch.title,
    laneIndex,
    y: firstLaneY + laneIndex * tokens.laneGap,
    styleOrdinal: laneIndex,
  }));
  const laneY = new Map(lanes.map((lane) => [lane.branchId, lane.y]));
  const lastLaneY = lanes.at(-1)!.y;
  const monthAxisY =
    lastLaneY +
    tokens.labelBaseExtent +
    maxBelowTier * tokens.labelTierGap +
    tokens.monthAxisGap;
  for (const zone of zones) zone.y = monthAxisY;

  const readingOrder = [...historical.map((milestone) => milestone.id), ...input.projection.map((item) => item.id)];
  const readingPosition = new Map(readingOrder.map((id, index) => [id, index + 1]));
  const childIds = new Map<string, string[]>();
  for (const milestone of historical) childIds.set(milestone.id, []);
  for (const milestone of historical) {
    for (const parentId of milestone.parentIds) {
      if (!milestoneById.has(parentId)) {
        return withDiagnostic(
          "missing-parent",
          `milestone ${milestone.id} references missing parent ${parentId}`,
          milestone.id,
        );
      }
      childIds.get(parentId)!.push(milestone.id);
    }
  }
  if (input.current !== undefined && input.projection.length > 0) {
    childIds.get(input.current.milestoneId)!.push(input.projection[0]!.id);
  }
  for (let index = 0; index < input.projection.length; index += 1) {
    childIds.set(input.projection[index]!.id, index + 1 < input.projection.length ? [input.projection[index + 1]!.id] : []);
  }

  const projectionParent = new Map<string, string>();
  for (let index = 0; index < input.projection.length; index += 1) {
    projectionParent.set(
      input.projection[index]!.id,
      index === 0 ? input.current!.milestoneId : input.projection[index - 1]!.id,
    );
  }
  const milestoneInput = new Map(historical.map((milestone) => [milestone.id, milestone]));
  const projectionInput = new Map(input.projection.map((item) => [item.id, item]));
  const draftById = new Map(draftNodes.map((node) => [node.id, node]));

  const nodes: TimelineNodeLayout[] = readingOrder.map((id) => {
    const draft = draftById.get(id)!;
    const branch = branchById.get(draft.branchId)!;
    const milestone = milestoneInput.get(id);
    const projection = projectionInput.get(id);
    const parents = milestone?.parentIds ?? [projectionParent.get(id)!];
    const accessibility: TimelineNodeAccessibility = {
      fullLabel:
        milestone !== undefined
          ? `${milestone.title}. ${draft.treatment === "current" ? "Current state. " : ""}${milestone.status}. ${branch.title} (${branch.id}). ${milestone.occurredAtIso}.`
          : `${projection!.title}. Planned ${projection!.status}. ${projection!.plannedFor === undefined ? "Undated" : `Planned for ${projection!.plannedFor}`}. ${branch.title} (${branch.id}).`,
      description:
        milestone?.summary ??
        `Future roadmap item ${projection!.id} on ${branch.title}.`,
      branchId: branch.id,
      branchTitle: branch.title,
      parentIds: [...parents],
      childIds: [...(childIds.get(id) ?? [])],
      ...(milestone === undefined ? {} : { evidenceCount: milestone.evidenceCount }),
      ...(draft.exactTimestampIso === undefined ? {} : { exactTimestampIso: draft.exactTimestampIso }),
      ...(draft.plannedFor === undefined ? {} : { plannedFor: draft.plannedFor }),
      ...(draft.currentState === undefined ? {} : { currentState: draft.currentState }),
      positionInSet: readingPosition.get(id)!,
      setSize: readingOrder.length,
    };
    return {
      id: draft.id,
      sourceKind: draft.sourceKind,
      x: draft.x,
      y: laneY.get(draft.branchId)!,
      laneIndex: draft.laneIndex,
      branchId: draft.branchId,
      treatment: draft.treatment,
      status: draft.status,
      fullTitle: draft.fullTitle,
      visibleTitle: draft.visibleTitle,
      titleWasTruncated: draft.titleWasTruncated,
      label: {
        side: draft.labelSide,
        tier: draft.labelTier,
        angleDegrees: tokens.labelAngleDegrees,
      },
      ...(draft.exactTimestampIso === undefined ? {} : { exactTimestampIso: draft.exactTimestampIso }),
      ...(draft.plannedFor === undefined ? {} : { plannedFor: draft.plannedFor }),
      ...(draft.monthKey === undefined ? {} : { monthKey: draft.monthKey }),
      ...(draft.currentState === undefined ? {} : { currentState: draft.currentState }),
      ...(draft.calloutLabel === undefined ? {} : { calloutLabel: draft.calloutLabel }),
      target: draft.target,
      accessibility,
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const firstMilestoneByBranch = new Map<string, string>();
  for (const milestone of historical) {
    if (!firstMilestoneByBranch.has(milestone.branchId)) {
      firstMilestoneByBranch.set(milestone.branchId, milestone.id);
    }
  }
  const edges: TimelineEdgeLayout[] = [];
  for (const milestone of historical) {
    const child = nodeById.get(milestone.id)!;
    const firstCrossParent =
      firstMilestoneByBranch.get(milestone.branchId) === milestone.id
        ? milestone.parentIds.find((parentId) => milestoneById.get(parentId)?.branchId !== milestone.branchId)
        : undefined;
    for (const parentId of milestone.parentIds) {
      const parent = nodeById.get(parentId);
      if (parent === undefined) {
        return withDiagnostic(
          "missing-parent",
          `milestone ${milestone.id} references missing parent ${parentId}`,
          milestone.id,
        );
      }
      const kind =
        parent.branchId === child.branchId
          ? "continuation"
          : firstCrossParent === parentId
            ? "branch-origin"
            : "merge";
      edges.push({
        id: `historical:${parentId}->${milestone.id}`,
        fromId: parentId,
        toId: milestone.id,
        kind,
        owningBranchId: milestone.branchId,
        points: [
          { x: parent.x, y: parent.y },
          { x: child.x, y: child.y },
        ],
        accessibleLabel: `${parentId} is a parent of ${milestone.id}; ${kind.replace("-", " ")} on ${milestone.branchId}.`,
      });
    }
  }
  for (let index = 0; index < input.projection.length; index += 1) {
    const toId = input.projection[index]!.id;
    const fromId = index === 0 ? input.current!.milestoneId : input.projection[index - 1]!.id;
    const from = nodeById.get(fromId)!;
    const to = nodeById.get(toId)!;
    edges.push({
      id: `projection:${fromId}->${toId}`,
      fromId,
      toId,
      kind: "projection",
      owningBranchId: to.branchId,
      points: [
        { x: from.x, y: from.y },
        { x: to.x, y: to.y },
      ],
      accessibleLabel: `${toId} is planned after ${fromId} on ${to.branchId}.`,
    });
  }

  const monthBands: TimelineMonthBand[] = months.map((month) => ({
    monthKey: month,
    label: calendar.formatMonth(month),
    xStart: snapCoordinate(anchorX.get(boundaryKey(month))!),
    xEnd: snapCoordinate(anchorX.get(boundaryKey(calendar.nextMonthKey(month)))!),
    y: monthAxisY,
    historicalNodeIds: historical
      .filter((milestone) => milestoneMonth.get(milestone.id) === month)
      .map((milestone) => milestone.id),
    datedProjectionIds: datedProjection
      .filter((projected) => projected.monthKey === month)
      .map((projected) => projected.item.id),
  }));

  const historyEndX = Math.max(...historical.map((milestone) => nodeById.get(milestone.id)!.x));
  const fullEndX = Math.max(
    datedLayoutRight,
    ...nodes.map((node) => node.x),
    ...zones.map((zone) => zone.xEnd),
  );
  const width = fullEndX + tokens.rightPadding;
  const height = monthAxisY + tokens.bottomPadding;
  const finiteValues = [
    width,
    height,
    ...lanes.flatMap((lane) => [lane.y]),
    ...nodes.flatMap((node) => [node.x, node.y]),
    ...edges.flatMap((edge) => edge.points.flatMap((point) => [point.x, point.y])),
    ...monthBands.flatMap((band) => [band.xStart, band.xEnd, band.y]),
    ...zones.flatMap((zone) => [zone.xStart, zone.xEnd, zone.y]),
  ];
  if (finiteValues.some((value) => !Number.isFinite(value))) {
    return withDiagnostic("non-finite-coordinate", "timeline layout produced a non-finite coordinate");
  }
  if (monthBands.some((band) => band.xEnd < band.xStart)) {
    return withDiagnostic("non-finite-coordinate", "timeline layout produced a reversed month band");
  }

  return {
    ok: true,
    value: {
      timeScale: { kind: "compressed-calendar", proportional: false },
      width,
      height,
      lanes,
      nodes,
      edges,
      monthBands,
      zones,
      navigation: {
        startX: nodeById.get(historical[0]!.id)!.x,
        ...(input.current === undefined ? {} : { currentX: nodeById.get(input.current.milestoneId)!.x }),
        historyEndX,
        fullEndX,
      },
      readingOrder,
    },
  };
}

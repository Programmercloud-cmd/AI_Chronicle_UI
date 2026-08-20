import type { RoadmapItem } from "../../src/schema";

const acceptsRoadmapItem = (_item: RoadmapItem): void => {};

acceptsRoadmapItem({
  id: "RM-001",
  title: "Pending item",
  status: "pending",
  order: 1,
});
acceptsRoadmapItem({
  id: "RM-002",
  title: "Blocked item",
  status: "blocked",
  order: 2,
  blocker_summary: "External approval is pending.",
});
acceptsRoadmapItem({
  id: "RM-003",
  title: "Superseded item",
  status: "superseded",
  order: 3,
  superseded_by: "RM-004",
});

// @ts-expect-error A blocked item requires blocker_summary.
acceptsRoadmapItem({ id: "RM-010", title: "Blocked", status: "blocked", order: 10 });

// @ts-expect-error A superseded item requires superseded_by.
acceptsRoadmapItem({ id: "RM-011", title: "Old", status: "superseded", order: 11 });

// @ts-expect-error Other statuses cannot carry superseded_by.
acceptsRoadmapItem({ id: "RM-012", title: "Active", status: "active", order: 12, superseded_by: "RM-013" });

// @ts-expect-error Generated record declarations reject unknown properties.
acceptsRoadmapItem({ id: "RM-014", title: "Pending", status: "pending", order: 14, color: "orange" });

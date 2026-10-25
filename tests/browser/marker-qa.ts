import { MarkerLayer } from "../../src/content/markers";
import type { JobMarker } from "../../src/shared/schema";
let markers: JobMarker[] = [
  {
    jobId: "testjob001",
    status: "evaluating",
    label: "AI 分析",
    reason: "演示：正在准备个性化留言",
    canSkip: true,
  },
];
const layer = new MarkerLayer(async (jobId) => {
  markers = markers.filter((m) => m.jobId !== jobId);
  markers.push({
    jobId,
    status: "skipped",
    label: "已跳过",
    reason: "演示：用户跳过此岗位",
    canSkip: false,
  });
  layer.update(markers);
});
layer.update(markers);

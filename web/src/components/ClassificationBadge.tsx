import { Classification } from "../gen/livemap/v1/livemap_pb";
import { getClassificationName, getClassificationColor } from "../dataService";

export function ClassificationBadge({ classification }: { classification: Classification }) {
  const name = getClassificationName(classification);
  const color = getClassificationColor(classification);
  
  return (
    <span className="badge" style={{ borderColor: color, color: color }}>
      {name}
    </span>
  );
}

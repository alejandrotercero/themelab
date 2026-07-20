// packages/overlay/src/utils/rdp.ts

interface Point {
  x: number;
  y: number;
}

function perpendicularDistance(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    const ddx = point.x - lineStart.x;
    const ddy = point.y - lineStart.y;
    return Math.hypot(ddx, ddy);
  }

  const num = Math.abs(
    dy * point.x -
      dx * point.y +
      lineEnd.x * lineStart.y -
      lineEnd.y * lineStart.x
  );
  return num / Math.sqrt(lengthSq);
}

/**
 * Ramer-Douglas-Peucker algorithm for simplifying a polyline.
 * Reduces point count while preserving shape within epsilon tolerance.
 */
export function simplifyPoints(points: Point[], epsilon = 2): Point[] {
  if (points.length <= 2) {
    return points;
  }

  let maxDist = 0;
  let maxIndex = 0;
  const [start] = points;
  const end = points.at(-1) as Point;

  for (let i = 1; i < points.length - 1; i += 1) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPoints(points.slice(0, maxIndex + 1), epsilon);
    const right = simplifyPoints(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

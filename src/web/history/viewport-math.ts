export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface CameraPose {
  centerX: number;
  centerY: number;
  scale: number;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
}

function assertPoint(point: GraphPoint, name: string): void {
  assertFinite(point.x, `${name}.x`);
  assertFinite(point.y, `${name}.y`);
}

function rectDimensions(rect: GraphRect, name: string): ViewportSize {
  assertFinite(rect.left, `${name}.left`);
  assertFinite(rect.top, `${name}.top`);
  assertFinite(rect.right, `${name}.right`);
  assertFinite(rect.bottom, `${name}.bottom`);

  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  assertFinite(width, `${name}.width`);
  assertFinite(height, `${name}.height`);
  if (width < 0 || height < 0) {
    throw new RangeError(`${name} must have ordered bounds`);
  }

  return { width, height };
}

function assertViewport(viewport: ViewportSize): void {
  assertPositive(viewport.width, "viewport.width");
  assertPositive(viewport.height, "viewport.height");
}

function assertCamera(camera: CameraPose): void {
  assertFinite(camera.centerX, "camera.centerX");
  assertFinite(camera.centerY, "camera.centerY");
  assertPositive(camera.scale, "camera.scale");
}

function finitePoint(x: number, y: number, name: string): GraphPoint {
  assertFinite(x, `${name}.x`);
  assertFinite(y, `${name}.y`);
  return { x, y };
}

function finiteRect(left: number, top: number, right: number, bottom: number, name: string): GraphRect {
  const rect = { left, top, right, bottom };
  rectDimensions(rect, name);
  return rect;
}

/**
 * Expands content bounds symmetrically only where the minimum-scale viewport
 * would otherwise be larger. Added area is empty navigation margin; supplied
 * content geometry is never scaled or shifted.
 */
export function deriveNavigationBounds(
  contentBounds: GraphRect,
  viewport: ViewportSize,
  minScale: number,
): GraphRect {
  const content = rectDimensions(contentBounds, "contentBounds");
  assertViewport(viewport);
  assertPositive(minScale, "minScale");

  const requiredWidth = viewport.width / minScale;
  const requiredHeight = viewport.height / minScale;
  assertFinite(requiredWidth, "required navigation width");
  assertFinite(requiredHeight, "required navigation height");

  const extraWidth = Math.max(0, requiredWidth - content.width);
  const extraHeight = Math.max(0, requiredHeight - content.height);
  return finiteRect(
    contentBounds.left - extraWidth / 2,
    contentBounds.top - extraHeight / 2,
    contentBounds.right + extraWidth / 2,
    contentBounds.bottom + extraHeight / 2,
    "navigationBounds",
  );
}

export function visibleGraphRect(camera: CameraPose, viewport: ViewportSize): GraphRect {
  assertCamera(camera);
  assertViewport(viewport);

  const halfWidth = viewport.width / (2 * camera.scale);
  const halfHeight = viewport.height / (2 * camera.scale);
  assertFinite(halfWidth, "visible graph half-width");
  assertFinite(halfHeight, "visible graph half-height");
  return finiteRect(
    camera.centerX - halfWidth,
    camera.centerY - halfHeight,
    camera.centerX + halfWidth,
    camera.centerY + halfHeight,
    "visibleGraphRect",
  );
}

export function graphToScreen(
  point: GraphPoint,
  camera: CameraPose,
  viewport: ViewportSize,
): GraphPoint {
  assertPoint(point, "point");
  assertCamera(camera);
  assertViewport(viewport);

  return finitePoint(
    (point.x - camera.centerX) * camera.scale + viewport.width / 2,
    (point.y - camera.centerY) * camera.scale + viewport.height / 2,
    "screenPoint",
  );
}

export function screenToGraph(
  point: GraphPoint,
  camera: CameraPose,
  viewport: ViewportSize,
): GraphPoint {
  assertPoint(point, "point");
  assertCamera(camera);
  assertViewport(viewport);

  return finitePoint(
    camera.centerX + (point.x - viewport.width / 2) / camera.scale,
    camera.centerY + (point.y - viewport.height / 2) / camera.scale,
    "graphPoint",
  );
}

/**
 * Clamps a camera without changing its scale. The bounds must already be large
 * enough for the requested visible rectangle (normally via
 * deriveNavigationBounds); impossible containment is rejected explicitly.
 */
export function clampCamera(
  camera: CameraPose,
  viewport: ViewportSize,
  navigationBounds: GraphRect,
): CameraPose {
  assertCamera(camera);
  assertViewport(viewport);
  rectDimensions(navigationBounds, "navigationBounds");

  const halfWidth = viewport.width / (2 * camera.scale);
  const halfHeight = viewport.height / (2 * camera.scale);
  assertFinite(halfWidth, "visible graph half-width");
  assertFinite(halfHeight, "visible graph half-height");

  const minCenterX = navigationBounds.left + halfWidth;
  const maxCenterX = navigationBounds.right - halfWidth;
  const minCenterY = navigationBounds.top + halfHeight;
  const maxCenterY = navigationBounds.bottom - halfHeight;
  assertFinite(minCenterX, "minimum camera centerX");
  assertFinite(maxCenterX, "maximum camera centerX");
  assertFinite(minCenterY, "minimum camera centerY");
  assertFinite(maxCenterY, "maximum camera centerY");

  if (minCenterX > maxCenterX || minCenterY > maxCenterY) {
    throw new RangeError("navigationBounds cannot contain the visible viewport at camera.scale");
  }

  return {
    centerX: Math.min(maxCenterX, Math.max(minCenterX, camera.centerX)),
    centerY: Math.min(maxCenterY, Math.max(minCenterY, camera.centerY)),
    scale: camera.scale,
  };
}

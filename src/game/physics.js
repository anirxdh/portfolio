// Lightweight 2D (XZ-plane) collision helpers for the Explore world.
// Boxes are axis-aligned: { x, z, hw, hd } (center + half extents).
// Circles are { x, z, r }.
// `pos` ({x,z}) and `vel` ({x,z}) are mutated in place.

/**
 * Resolve a moving circle against a list of AABBs.
 * Pushes the circle out of any overlapping box and removes (plus a little
 * bounce) the velocity component pointing into the wall, so the mover slides
 * along surfaces instead of sticking or tunnelling through.
 */
export function collideCircleWithBoxes(pos, vel, r, boxes, restitution = 0.2) {
  let hit = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    // Closest point on the box to the circle centre.
    const cx = Math.max(b.x - b.hw, Math.min(pos.x, b.x + b.hw));
    const cz = Math.max(b.z - b.hd, Math.min(pos.z, b.z + b.hd));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;

    let nx;
    let nz;
    let pen;
    const d = Math.sqrt(d2);
    if (d > 1e-4) {
      nx = dx / d;
      nz = dz / d;
      pen = r - d;
    } else {
      // Centre is inside the box — push out along the axis of least penetration.
      const left = pos.x - (b.x - b.hw);
      const right = b.x + b.hw - pos.x;
      const top = pos.z - (b.z - b.hd);
      const bottom = b.z + b.hd - pos.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) [nx, nz, pen] = [-1, 0, left + r];
      else if (m === right) [nx, nz, pen] = [1, 0, right + r];
      else if (m === top) [nx, nz, pen] = [0, -1, top + r];
      else [nx, nz, pen] = [0, 1, bottom + r];
    }

    pos.x += nx * pen;
    pos.z += nz * pen;

    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) {
      vel.x -= (1 + restitution) * vn * nx;
      vel.z -= (1 + restitution) * vn * nz;
    }
    hit = true;
  }
  return hit;
}

/** Resolve a moving circle against a list of static circles (trees, posts…). */
export function collideCircleWithCircles(pos, vel, r, circles, restitution = 0.2) {
  let hit = false;
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const rr = r + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;

    const d = Math.sqrt(d2) || 1e-4;
    const nx = dx / d;
    const nz = dz / d;
    const pen = rr - d;

    pos.x += nx * pen;
    pos.z += nz * pen;

    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) {
      vel.x -= (1 + restitution) * vn * nx;
      vel.z -= (1 + restitution) * vn * nz;
    }
    hit = true;
  }
  return hit;
}

declare const __HEALTH_BUILD_SHA__: string;

/** Runtime labels override the commit embedded by the production build. */
export function getHealthBuild(): string {
  return process.env.HEALTH_BUILD_LABEL ||
    (typeof __HEALTH_BUILD_SHA__ === "undefined" ? "unknown" : __HEALTH_BUILD_SHA__);
}

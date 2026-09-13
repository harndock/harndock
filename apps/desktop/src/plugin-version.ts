export type PluginVersionState =
  | "not-installed"
  | "latest"
  | "update-available"
  | "local-newer"
  | "unavailable";

interface ParsedVersion {
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
}

function parseVersion(version: string): ParsedVersion | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match) return null;

  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((identifier) => /^0\d+$/.test(identifier))) return null;

  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease,
  };
}

function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return compareNumericIdentifiers(leftPart, rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function comparePluginVersions(left: string, right: string): number | null {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return null;

  for (const key of ["major", "minor", "patch"] as const) {
    const comparison = compareNumericIdentifiers(parsedLeft[key], parsedRight[key]);
    if (comparison !== 0) return comparison;
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

export function pluginVersionState(
  latestVersion: string | null,
  installedVersion: string | null | undefined,
): PluginVersionState {
  if (!installedVersion) return latestVersion ? "not-installed" : "unavailable";
  if (!latestVersion) return "unavailable";

  const comparison = comparePluginVersions(latestVersion, installedVersion);
  if (comparison === null) return "unavailable";
  if (comparison > 0) return "update-available";
  if (comparison < 0) return "local-newer";
  return "latest";
}

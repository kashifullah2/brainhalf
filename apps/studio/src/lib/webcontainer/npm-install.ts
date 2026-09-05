/** Parse "three", "three@0.160.0", "@scope/pkg@1.0.0" */
export function parsePackageSpec(spec: string): { name: string; version?: string } {
  const trimmed = spec.trim();
  if (trimmed.startsWith("@")) {
    const slash = trimmed.indexOf("/");
    if (slash === -1) return { name: trimmed };
    const scope = trimmed.slice(0, slash);
    const rest = trimmed.slice(slash + 1);
    const at = rest.indexOf("@");
    if (at === -1) return { name: `${scope}/${rest}` };
    return {
      name: `${scope}/${rest.slice(0, at)}`,
      version: rest.slice(at + 1) || undefined,
    };
  }
  const at = trimmed.indexOf("@");
  if (at === -1) return { name: trimmed };
  return { name: trimmed.slice(0, at), version: trimmed.slice(at + 1) || undefined };
}

export function packageFingerprint(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): string {
  return JSON.stringify({
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
  });
}

export function isListedInPackageJson(
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  packageName: string
): boolean {
  const { name } = parsePackageSpec(packageName);
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

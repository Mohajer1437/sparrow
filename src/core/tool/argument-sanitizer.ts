import * as path from 'path';

/**
 * Keys in tool arguments that are likely to be file paths.
 */
const PATH_LIKE_KEYS = new Set([
  'path', 'filePath', 'file_path', 'filepath',
  'targetPath', 'target_path', 'targetpath',
  'sourcePath', 'source_path', 'sourcepath',
  'destinationPath', 'destination_path',
  'from', 'to',
]);

/**
 * Sanitize tool arguments to prevent path resolution bugs.
 *
 * Fixes: strips duplicate workspace name prefix from path arguments.
 * Example: if workspacePath is "E:\\new-test-2" and the model passes
 * "new-test-2/data/file.json" as a path, returns "data/file.json".
 *
 * Safety: never throws — returns original args on unexpected input.
 */
export function sanitizeToolArguments(
  args: Record<string, any>,
  workspacePath: string,
): Record<string, any> {
  try {
    if (!args || typeof args !== 'object') return args;
    if (!workspacePath || typeof workspacePath !== 'string') return args;

    const workspaceName = path.basename(workspacePath);
    if (!workspaceName) return args;

    const prefixes = [`${workspaceName}/`, `${workspaceName}\\`];

    const sanitized: Record<string, any> = { ...args };
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && isPathLikeKey(key)) {
        const stripped = stripDuplicateWorkspacePrefix(value, prefixes);
        if (stripped !== value) {
          sanitized[key] = stripped;
        }
      }
    }
    return sanitized;
  } catch {
    return args;
  }
}

function isPathLikeKey(key: string): boolean {
  return PATH_LIKE_KEYS.has(key);
}

function stripDuplicateWorkspacePrefix(value: string, prefixes: string[]): string {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return value.substring(prefix.length);
    }
  }
  return value;
}

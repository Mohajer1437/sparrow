import * as fs from 'fs/promises';
import * as path from 'path';
import { GlobalConfiguration } from '../../core/configuration/global-configuration';

export async function useCommand(targetPath: string) {
  if (!targetPath || targetPath.trim().length === 0) {
    console.error('Error: Workspace path cannot be empty.');
    console.error('Usage: agent use <path>');
    process.exit(1);
    return;
  }

  const resolvedPath = path.resolve(targetPath);

  try {
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      console.error(`Error: Path is not a directory: ${resolvedPath}`);
      process.exit(1);
      return;
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.error(`Error: Path does not exist: ${resolvedPath}`);
    } else {
      console.error(`Error: Cannot access path: ${err.message}`);
    }
    process.exit(1);
    return;
  }

  const globalConfig = new GlobalConfiguration();
  await globalConfig.setCurrentWorkspace(resolvedPath);

  // Fix: path.basename('E:\\') returns '' on Windows, so fall back to full path
  const displayName = path.basename(resolvedPath) || resolvedPath;

  console.log('✓ Workspace selected');
  console.log(`Name: ${displayName}`);
  console.log(`Path: ${resolvedPath}`);
}

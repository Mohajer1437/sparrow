import * as path from 'path';
import { GlobalConfiguration } from '../../core/configuration/global-configuration';

export async function workspaceCommand() {
  const globalConfig = new GlobalConfiguration();
  const current = await globalConfig.getCurrentWorkspace();

  if (!current) {
    console.log('No workspace selected.');
    console.log('Use: agent use <path>');
    return;
  }

  // Fix: path.basename('E:\\') returns '' on Windows
  const displayName = path.basename(current) || current;

  console.log('✓ Current Workspace');
  console.log(`Name: ${displayName}`);
  console.log(`Path: ${current}`);
}

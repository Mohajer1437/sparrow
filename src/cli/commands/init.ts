import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
// Note: init intentionally does NOT use resolveWorkspaceRoot().
// It must always operate on process.cwd() because init creates a NEW workspace.
// Using resolveWorkspaceRoot would cause init to target the previously selected
// workspace (from GlobalConfiguration) instead of the current directory.

export async function initCommand() {
  const logger: Logger = { debug: () => {}, info: console.log, warn: console.warn, error: console.error };
  const factory = new AppFactory(process.cwd(), logger);
  const config = factory.createConfiguration();
  
  if (await config.exists()) {
    console.log('Workspace already initialized.');
    return;
  }
  
  await config.initialize();
  
  const runtime = factory.createRuntimeRepository();
  const dirs = [
    'manifest', 'rules', 'knowledge', 'memory', 'sessions', 
    'experience', 'summaries', 'checkpoints', 'providers', 
    'roles', 'prompts', 'cache'
  ];
  
  for (const d of dirs) {
    await runtime.mkdir(d);
  }
  
  // Create default manifest.json
  const manifestDir = 'manifest';
  const manifestFile = 'manifest.json';
  const manifestPath = path.join(manifestDir, manifestFile);
  
  let projectName = path.basename(process.cwd());
  let projectVersion = '1.0.0';
  let projectDescription = 'AI-enabled project';
  
  // Try to read package.json if it exists
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    
    if (packageJson.name) projectName = packageJson.name;
    if (packageJson.version) projectVersion = packageJson.version;
    if (packageJson.description) projectDescription = packageJson.description;
  } catch (err) {
    // package.json doesn't exist or is invalid, use defaults
  }
  
  const manifest = {
    name: projectName,
    version: projectVersion,
    description: projectDescription,
    metadata: {
      createdAt: new Date().toISOString()
    }
  };
  
  await runtime.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  console.log('Workspace initialized successfully.');
  console.log(`Created manifest: ${projectName}@${projectVersion}`);
}

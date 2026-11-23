import { DefaultCliRole, DEFAULT_MODEL } from '../../../src/cli/shared/cli-role';

describe('DefaultCliRole', () => {
  it('should include model name in system prompt', () => {
    const role = new DefaultCliRole();
    const config = role.getConfig();
    
    expect(config.systemPrompt).toContain(DEFAULT_MODEL);
    expect(config.systemPrompt).toContain('You are currently running as model');
  });

  it('should include rule against fake actions', () => {
    const role = new DefaultCliRole();
    const config = role.getConfig();
    
    expect(config.systemPrompt).toContain('Never claim to have performed an action without using a tool');
    expect(config.systemPrompt).toContain('NEVER say "the file already exists with this content"');
  });

  it('should include tool selection guide', () => {
    const role = new DefaultCliRole();
    const config = role.getConfig();
    
    expect(config.systemPrompt).toContain('create_file');
    expect(config.systemPrompt).toContain('write_file');
    expect(config.systemPrompt).toContain('FAILS if file already exists');
  });

  it('should distinguish create_file from write_file', () => {
    const role = new DefaultCliRole();
    const config = role.getConfig();
    
    // create_file is for NEW files only
    expect(config.systemPrompt).toMatch(/create_file.*NEW/i);
    // write_file handles both new and existing
    expect(config.systemPrompt).toMatch(/write_file.*OVERWRITES/i);
  });
});

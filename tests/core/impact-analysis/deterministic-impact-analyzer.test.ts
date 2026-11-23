import { DefaultImpactAnalyzer } from '../../../src/core/impact-analysis/default-impact-analyzer';
import { Workspace } from '../../../src/contracts/workspace';

describe('DeterministicImpactAnalyzer - Advanced Scenarios', () => {
  let mockWorkspace: jest.Mocked<Workspace>;
  let analyzer: DefaultImpactAnalyzer;

  beforeEach(() => {
    mockWorkspace = {
      exists: jest.fn(),
      readFile: jest.fn(),
      listFiles: jest.fn(),
    } as any;
    analyzer = new DefaultImpactAnalyzer(mockWorkspace);
  });

  it('detects Next.js route handlers and pages as affected endpoints', async () => {
    mockWorkspace.exists.mockImplementation(async (p: string) => {
      return (
        p === 'app/api/users/route.ts' ||
        p === 'app/login/page.tsx' ||
        p === 'components/LoginForm.tsx'
      );
    });

    mockWorkspace.readFile.mockImplementation(async (p: string) => {
      if (p === 'components/LoginForm.tsx') return 'export function LoginForm() { return <form></form>; }';
      if (p === 'app/login/page.tsx') return 'import { LoginForm } from "../../components/LoginForm";\nexport default function LoginPage() { return <LoginForm />; }';
      if (p === 'app/api/users/route.ts') return 'export async function GET() { return Response.json([]); }';
      return '';
    });

    mockWorkspace.listFiles.mockImplementation(async (dir: string) => {
      if (dir === 'app') return ['app/api/users/route.ts', 'app/login/page.tsx'];
      if (dir === 'components') return ['components/LoginForm.tsx'];
      return [];
    });

    const report = await analyzer.analyze(['components/LoginForm.tsx']);
    const analysis = report.analysis!;

    expect(analysis.directlyAffected).toContain('components/LoginForm.tsx');
    expect(analysis.indirectlyAffected).toContain('app/login/page.tsx');
    expect(analysis.affectedEndpoints).toContain('PAGE /login');
    expect(analysis.affectedDomains).toContain('frontend');
  });

  it('detects NestJS @Controller and HTTP methods as affected endpoints', async () => {
    mockWorkspace.exists.mockImplementation(async (p: string) => {
      return p === 'src/users/users.service.ts' || p === 'src/users/users.controller.ts';
    });

    mockWorkspace.readFile.mockImplementation(async (p: string) => {
      if (p === 'src/users/users.service.ts') return 'export class UsersService {}';
      if (p === 'src/users/users.controller.ts') {
        return `
          import { UsersService } from './users.service';
          @Controller('api/v1/users')
          export class UsersController {
            @Get(':id')
            getUser() {}
          }
        `;
      }
      return '';
    });

    mockWorkspace.listFiles.mockImplementation(async (dir: string) => {
      if (dir === 'src') return ['src/users/users.service.ts', 'src/users/users.controller.ts'];
      return [];
    });

    const report = await analyzer.analyze(['src/users/users.service.ts']);
    const analysis = report.analysis!;

    expect(analysis.directlyAffected).toContain('src/users/users.service.ts');
    expect(analysis.indirectlyAffected).toContain('src/users/users.controller.ts');
    expect(analysis.affectedEndpoints).toContain('GET /api/v1/users/:id');
    expect(analysis.affectedDomains).toContain('backend');
  });

  it('handles cyclic dependencies gracefully without infinite recursion', async () => {
    // A -> imports -> B -> imports -> A (Cycle)
    mockWorkspace.exists.mockImplementation(async (p: string) => {
      return p === 'src/a.ts' || p === 'src/b.ts';
    });

    mockWorkspace.readFile.mockImplementation(async (p: string) => {
      if (p === 'src/a.ts') return 'import { B } from "./b"; export const A = 1;';
      if (p === 'src/b.ts') return 'import { A } from "./a"; export const B = 2;';
      return '';
    });

    mockWorkspace.listFiles.mockImplementation(async (dir: string) => {
      if (dir === 'src') return ['src/a.ts', 'src/b.ts'];
      return [];
    });

    const report = await analyzer.analyze(['src/a.ts']);
    const analysis = report.analysis!;

    expect(analysis.directlyAffected).toContain('src/a.ts');
    expect(analysis.indirectlyAffected).toContain('src/b.ts');
    expect(analysis.confidence).toBe('CONFIRMED');
    // Traversal completed and did not hang
  });

  it('bounds impact traversal according to limits and marks limitsReached', async () => {
    mockWorkspace.exists.mockResolvedValue(true);
    mockWorkspace.readFile.mockImplementation(async (p: string) => {
      // Chain: node0 -> node1 -> node2 -> node3 -> node4 -> node5 ...
      const match = p.match(/node(\d+)\.ts$/);
      if (match) {
        const next = parseInt(match[1], 10) + 1;
        return `import { n } from "./node${next}";`;
      }
      return '';
    });

    mockWorkspace.listFiles.mockResolvedValue([]);

    const report = await analyzer.analyze(['src/node0.ts'], {
      limits: {
        maxImpactDepth: 2,
        maxImpactNodes: 2,
      },
    });

    const analysis = report.analysis!;
    expect(analysis.limitsReached).toBe(true);
    expect(analysis.indirectlyAffected.length).toBeLessThanOrEqual(3);
  });
});

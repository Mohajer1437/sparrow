import {
  SourceSyntaxValidator,
  isSyntaxCheckable,
} from '../../../../src/core/execution/mutation/source-syntax-validator';

const validator = new SourceSyntaxValidator();

describe('R2 syntax validation (R2.8)', () => {
  it('accepts valid TypeScript', () => {
    const result = validator.validate('src/util.ts', 'export const add = (a: number, b: number): number => a + b;\n');
    expect(result.valid).toBe(true);
    expect(result.applicable).toBe(true);
  });

  it('rejects invalid TypeScript', () => {
    const result = validator.validate('src/util.ts', 'export const add = (a: number =>\n');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('accepts valid JavaScript', () => {
    expect(validator.validate('scripts/run.js', 'function main() { return 1; }\nmain();\n').valid).toBe(true);
  });

  it('rejects invalid JavaScript', () => {
    expect(validator.validate('scripts/run.js', 'function main() { return 1;\n').valid).toBe(false);
  });

  it('has no verdict for a file type with no deterministic validator', () => {
    const result = validator.validate('data/saved_cards.json', '{ not really json ');
    expect(result.valid).toBeNull();
    expect(result.applicable).toBe(false);
  });

  it('reports which file types it can check', () => {
    expect(isSyntaxCheckable('app/page.tsx')).toBe(true);
    expect(isSyntaxCheckable('app/page.jsx')).toBe(true);
    expect(isSyntaxCheckable('README.md')).toBe(false);
    expect(isSyntaxCheckable('styles/app.css')).toBe(false);
  });
});

describe('R2 JSX/TSX protection (R2.9)', () => {
  const validPage = `'use client';

export default function Page() {
  return (
    <main className="p-4">
      {/* r2-write-e2e */}
      <h1>Hello</h1>
    </main>
  );
}
`;

  it('accepts a valid TSX client component', () => {
    expect(validator.validate('app/page.tsx', validPage).valid).toBe(true);
  });

  it('accepts valid JSX in a .jsx file', () => {
    expect(validator.validate('app/page.jsx', 'export default () => <div>hi</div>;\n').valid).toBe(true);
  });

  it('accepts JSX inside a .js file, which Next.js projects rely on', () => {
    expect(validator.validate('components/Card.js', 'export default () => <div>hi</div>;\n').valid).toBe(true);
  });

  it('detects an unclosed JSX tag', () => {
    const broken = validPage.replace('</main>', '');
    const result = validator.validate('app/page.tsx', broken);
    expect(result.valid).toBe(false);
  });

  it('detects a mismatched JSX closing tag', () => {
    const result = validator.validate('app/page.tsx', 'export default () => <div>hi</span>;\n');
    expect(result.valid).toBe(false);
  });

  it('detects invalid JSX attribute syntax', () => {
    const result = validator.validate('app/page.tsx', 'export default () => <div className=>hi</div>;\n');
    expect(result.valid).toBe(false);
  });

  it('detects malformed braces', () => {
    const result = validator.validate('app/page.tsx', 'export default function P() { return <div>{ }\n');
    expect(result.valid).toBe(false);
  });

  it('detects a truncated file, which is what a partial write looks like', () => {
    const truncated = validPage.slice(0, Math.floor(validPage.length / 2));
    expect(validator.validate('app/page.tsx', truncated).valid).toBe(false);
  });

  it('reports a line number so repair gets actionable evidence', () => {
    const result = validator.validate('app/page.tsx', validPage.replace('</main>', ''));
    expect(result.detail).toMatch(/line \d+/);
  });

  it('is deterministic: the same content always produces the same verdict', () => {
    const first = validator.validate('app/page.tsx', validPage);
    const second = validator.validate('app/page.tsx', validPage);
    expect(first).toEqual(second);
  });
});

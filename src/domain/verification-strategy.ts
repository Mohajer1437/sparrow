export interface VerificationStrategy {
  readonly runFormatting: boolean;
  readonly runLint: boolean;
  readonly runTypeCheck: boolean;
  readonly runUnitTests: boolean;
  readonly runIntegrationTests: boolean;
  readonly runBuild: boolean;
  readonly runCustomCommands: ReadonlyArray<string>;
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly reasons: ReadonlyArray<string>;
}

/**
 * Capability parity inspection for CLI and REPL (H.4, H.29).
 *
 * The table is printed from the shared application inventory, so a gap shown
 * here is the same gap the Web API reports.
 */

import {
  CapabilityCatalog,
  InterfaceSupport,
  buildCapabilityCatalog,
} from '../../app/platform-capabilities';

const MARK: Readonly<Record<InterfaceSupport, string>> = Object.freeze({
  SUPPORTED: 'yes',
  PARTIAL: 'partial',
  BLOCKED: 'blocked',
  NOT_APPLICABLE: 'n/a',
});

export async function capabilitiesCommand(args: string[] = []): Promise<void> {
  const catalog = buildCapabilityCatalog();
  if (args.includes('--json')) {
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }
  print(catalog);
}

function print(catalog: CapabilityCatalog): void {
  console.log('Sparrow capability parity (one application layer, four interfaces)');
  console.log(`API version: ${catalog.apiVersion}   HTTP surface: read-only`);
  console.log('');
  console.log(`${'capability'.padEnd(28)}${'CLI'.padEnd(9)}${'REPL'.padEnd(9)}${'API'.padEnd(9)}${'UI'.padEnd(9)}application service`);
  console.log('-'.repeat(110));
  for (const capability of catalog.capabilities) {
    console.log(
      capability.id.padEnd(28)
      + MARK[capability.cli.support].padEnd(9)
      + MARK[capability.repl.support].padEnd(9)
      + MARK[capability.api.support].padEnd(9)
      + MARK[capability.ui.support].padEnd(9)
      + capability.applicationService,
    );
  }
  console.log('');
  if (catalog.gaps.length === 0) {
    console.log('No interface gaps are declared.');
    return;
  }
  console.log(`Declared gaps (${catalog.gaps.length}):`);
  for (const gap of catalog.gaps) {
    console.log(`  ${gap.capabilityId} · ${gap.interfaceId} · ${gap.support}`);
    console.log(`      ${gap.detail}`);
  }
}

/**
 * Backward-compatible alias for deployments that still invoke the historical
 * extension entry point. Both commands now execute the same mono-server
 * bootstrap; there is no second HTTP stack or lifecycle implementation.
 */
import { startServerOrExit } from '../app';

if (require.main === module) {
  startServerOrExit();
}

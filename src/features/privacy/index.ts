// Public surface for the GDPR / privacy module.
export { PrivacyPolicyScreen } from './screens/PrivacyPolicyScreen';
export { TermsScreen } from './screens/TermsScreen';
export { DataExportScreen } from './screens/DataExportScreen';
export { DeleteAccountScreen } from './screens/DeleteAccountScreen';
export { AccountRestorationGate } from './components/AccountRestorationGate';
export { LegalAcceptanceGate } from './components/LegalAcceptanceGate';
export { useAnalyticsConsentStore } from './store/analyticsConsentStore';
export { privacyService } from './services/privacyService';
export type { DeletionStatus } from './services/privacyService';

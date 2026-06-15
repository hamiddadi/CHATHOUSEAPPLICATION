// Public API of the extensions feature module.
// Import via: `import { ExtSuggestedFollowsScreen } from '@/features/extensions'`

// ─── Vague 1 ───
export { ExtLinkifiedText } from './components/ExtLinkifiedText';
export { ExtAvailablePeopleStrip } from './components/ExtAvailablePeopleStrip';
export { ExtSuggestedFollowsStrip } from './components/ExtSuggestedFollowsStrip';
export { ExtSuggestedFollowsScreen } from './screens/ExtSuggestedFollowsScreen';
export { ExtTopicExplorerScreen } from './screens/ExtTopicExplorerScreen';
export { useExtSuggestions } from './hooks/useSuggestions';
export { useExtAvailablePeople } from './hooks/usePresence';
export { useExtTopicsTree, useExtTopicsFlat } from './hooks/useTopics';
export { openTwitterHandle, openInstagramHandle } from './utils/socialDeepLink';
export { suggestionsApi } from './api/suggestionsApi';
export { presenceApi } from './api/presenceApi';
export { contactsApi } from './api/contactsApi';
export { topicsApi } from './api/topicsApi';
export type { SuggestedUser } from './api/suggestionsApi';
export type { AvailableUser } from './api/presenceApi';
export type { ContactMatch } from './api/contactsApi';
export type { Topic, FlatTopic } from './hooks/useTopics';

// ─── Vague 2 ───
export { ExtThemeProvider, useExtThemeMode, useExtColorScheme } from './providers/ExtThemeProvider';
export type { ExtThemeMode, EffectiveColorScheme } from './providers/ExtThemeProvider';
export { ExtThemeToggle } from './components/ExtThemeToggle';
export { validateInterests, INTEREST_MIN, INTEREST_MAX } from './utils/interestsValidator';
export type { InterestValidationResult } from './utils/interestsValidator';
export { eventsApi } from './api/eventsApi';
export { chatmodApi } from './api/chatmodApi';
export type { CancelResult } from './api/eventsApi';

// ─── Vague 3 ───
export { ExtUpcomingForYouStrip } from './components/ExtUpcomingForYouStrip';
export { upcomingApi } from './api/upcomingApi';
export { privacyApi } from './api/privacyApi';
export { searchExtApi } from './api/searchExtApi';
export { useExtUpcoming, useExtPrivacy, useExtSearchRooms } from './hooks/useUpcoming';
export type { UpcomingEvent } from './api/upcomingApi';
export type { PrivacySettings } from './api/privacyApi';
export type { RoomSearchResult, RoomSearchFilter } from './api/searchExtApi';

// ─── Vague 4 ───
export { audioApi } from './api/audioApi';
export { netqualityApi } from './api/netqualityApi';
export type { AudioPreferences, AudioQualityTier, DropInMode } from './api/audioApi';
export type { NetQualityReport } from './api/netqualityApi';

// ─── Vague 5 ───
export { clubReqApi } from './api/clubReqApi';
export type { ClubJoinRequest } from './api/clubReqApi';
export { useExtJoinHouse } from './hooks/useExtJoinHouse';
export type {
  ExtJoinPhase,
  UseExtJoinHouseOpts,
  UseExtJoinHouseResult,
} from './hooks/useExtJoinHouse';
export { ExtJoinHouseButton } from './components/ExtJoinHouseButton';
export type { ExtJoinHouseButtonProps } from './components/ExtJoinHouseButton';

// ─── Vague 6 ───
export { useExtFontScale, useExtScaledFont } from './hooks/useExtFontScale';

// ─── Vague 7 ───
export { paymentsApi } from './api/paymentsApi';
export type { PaymentStatus, PaymentAccount, TipResult, TipHistoryItem } from './api/paymentsApi';
export { premiumApi } from './api/premiumApi';
export type { PremiumStatus } from './api/premiumApi';
export { useTip, type TipVars } from './hooks/useTip';
export {
  usePremiumStatus,
  useStartPremiumCheckout,
  useOpenBillingPortal,
  premiumKeys,
} from './hooks/usePremium';
export { ExtTipSheet } from './components/ExtTipSheet';
export { ExtPremiumRow } from './components/ExtPremiumRow';

// ─── Vague 9 ───
export { calendarApi } from './api/calendarApi';
export { shareApi } from './api/shareApi';
export type { ShareLinks } from './api/shareApi';
export { speakInviteApi } from './api/speakInviteApi';
export { useExtSocketAliases } from './hooks/useExtSocketAliases';
export type { ExtSocketAliasHandlers } from './hooks/useExtSocketAliases';
export { useExtNetworkQuality, type UseExtNetworkQualityOpts } from './hooks/useExtNetworkQuality';
export { useExtRoomParticipantSearch } from './hooks/useExtRoomParticipantSearch';
export type { ParticipantLike } from './hooks/useExtRoomParticipantSearch';
export { ExtNetworkQualityBars } from './components/ExtNetworkQualityBars';
export { ExtShareSheet } from './components/ExtShareSheet';
export { ExtCalendarExportButton } from './components/ExtCalendarExportButton';

// ─── Vague 10 ───
export { captionsApi } from './api/captionsApi';
export { useExtCaptions } from './hooks/useExtCaptions';
export type { CaptionLine } from './hooks/useExtCaptions';
export { ExtCaptionsOverlay } from './components/ExtCaptionsOverlay';
export { ExtReactionPicker } from './components/ExtReactionPicker';
export { useExtWave } from './hooks/useExtWave';
export { ExtSettingsScreen } from './screens/ExtSettingsScreen';
export { ExtBackToRoomBanner } from './components/ExtBackToRoomBanner';

// ─── Vague 11 ───
export { useExtRoomFullState } from './hooks/useExtRoomFullState';
export type { UseExtRoomFullStateOpts } from './hooks/useExtRoomFullState';
export { useExtPresenceHeartbeat } from './hooks/useExtPresenceHeartbeat';
export { activityApi } from './api/activityApi';
export type { ActivityItem } from './api/activityApi';
export { ExtActivityFeedScreen } from './screens/ExtActivityFeedScreen';
export { ExtPlaygroundScreen } from './screens/ExtPlaygroundScreen';

// ─── Vague 12 ───
export { hideRoomApi } from './api/hideRoomApi';
export { useExtHideRoom } from './hooks/useExtHideRoom';
export { notifPrefsExtApi } from './api/notifPrefsExtApi';
export type { FrequencyTier, NotifPrefsExt } from './api/notifPrefsExtApi';
export { clubsListApi } from './api/clubsListApi';
export type { ClubLite } from './api/clubsListApi';
export { ExtClubPickerSheet } from './components/ExtClubPickerSheet';
export { useExtPushToken } from './hooks/useExtPushToken';

// ─── Vague 13 ───
export { chatReactionsApi } from './api/chatReactionsApi';
export type { ReactionsByEmoji } from './api/chatReactionsApi';
export { recentlyPlayedApi } from './api/recentlyPlayedApi';
export type { RecentRoom } from './api/recentlyPlayedApi';
export { ExtRecentlyPlayedStrip } from './components/ExtRecentlyPlayedStrip';
export { useExtRecentlyPlayed } from './hooks/useUpcoming';
export { roomSettingsExtApi } from './api/roomSettingsExtApi';
export type { HandRaiseRestriction, ExtRoomSettings } from './api/roomSettingsExtApi';
export { badgesApi, BADGE_META } from './api/badgesApi';
export type { Badge } from './api/badgesApi';
export { ExtBadgesRow } from './components/ExtBadgesRow';

// ─── Vague 14 ───
export { nominatorApi } from './api/nominatorApi';
export type { InvitationRecord } from './api/nominatorApi';
export { searchHistoryApi } from './api/searchHistoryApi';
export { clubMetaApi } from './api/clubMetaApi';
export type { ClubMeta } from './api/clubMetaApi';
export { profileLinksApi } from './api/profileLinksApi';
export type { ProfileLink } from './api/profileLinksApi';

// ─── Vague 15 ───
export { ExtChatReactionsBar } from './components/ExtChatReactionsBar';
export { ExtFeaturedMembersStrip } from './components/ExtFeaturedMembersStrip';
export { ExtProfileLinks } from './components/ExtProfileLinks';
export { ExtNominatorPanel } from './components/ExtNominatorPanel';
export { useExtSearchHistory } from './hooks/useExtSearchHistory';

// ─── Vague 17 — Wrap & probe ───
export { useExtBackend } from './hooks/useExtBackend';
export type { ExtBackendStatus } from './hooks/useExtBackend';
export { ExtensionsProvider, useExtensions } from './providers/ExtensionsProvider';

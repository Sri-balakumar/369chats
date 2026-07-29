// components/ui — the app's design system.
//
// These were extracted from the screens rather than invented: each one is the
// pattern that ~20 screens had each re-implemented with its own copy of the same
// StyleSheet block. Build new screens out of these so the look stays one system.
//
//   import { Screen, ScreenHeader, DataList, Card } from '../components/ui';
//
// Tokens (COLORS, SHADOW, SPACING, RADIUS, TYPE, SCRIM, TOP) live in ../../theme.

export { default as Screen } from './Screen';
export { default as ScreenHeader, HeaderButton } from './ScreenHeader';
export { default as Banner } from './Banner';
export { default as Card } from './Card';
export { default as ChipRow } from './ChipRow';
export { default as DataList } from './DataList';
export { default as Loader } from './Loader';
export { default as EmptyState, emptyWrap } from './EmptyState';
export { default as Sheet } from './Sheet';
export { default as PopupModal } from './PopupModal';
export { default as MenuPopup } from './MenuPopup';
export { default as SectionCard } from './SectionCard';
export { default as SelectField } from './SelectField';
export { default as Switch } from './Switch';
export { default as ConfirmDialog } from './ConfirmDialog';
export { default as Accordion, animateNext } from './Accordion';
export { default as Row } from './Row';
export { default as Icon } from './Icon';
export { default as Avatar, colorForName, initialsFor } from './Avatar';
export { default as AnimatedTile, TILE_W, useTileAnimation } from './AnimatedTile';
export { default as StatCard, STAT_W } from './StatCard';

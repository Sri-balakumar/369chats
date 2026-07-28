// DataList — the loading / error / empty / list state machine that every data
// screen in the app re-implemented by hand.
//
// Order matters and matches what the screens did: a first-load spinner wins over
// everything, then an error (still pull-to-refreshable, so a failed load can be
// retried by pulling), then empty, then the list. Pull-to-refresh is wired in all
// three non-loading states — an empty or errored screen is exactly where a user
// reaches for it.
import React from 'react';
import { FlatList, RefreshControl, ScrollView } from 'react-native';
import Loader from './Loader';
import EmptyState, { emptyWrap } from './EmptyState';
import { SPACING } from '../../theme';

export default function DataList({
  data,
  renderItem,
  keyExtractor,
  loading = false,
  refreshing = false,
  onRefresh,
  error = null,
  emptyIcon,
  emptyTitle = 'Nothing here yet',
  emptySub,
  ...rest
}) {
  const refreshControl = onRefresh
    ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
    : undefined;

  if (loading) return <Loader />;

  if (error) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={emptyWrap} refreshControl={refreshControl}>
        <EmptyState icon="alert-circle-outline" tone="error" title={error} onRetry={onRefresh} />
      </ScrollView>
    );
  }

  const items = data || [];
  return (
    <FlatList
      style={{ flex: 1 }}
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      refreshControl={refreshControl}
      contentContainerStyle={
        items.length ? { padding: SPACING.screen, paddingBottom: 40 } : emptyWrap
      }
      ListEmptyComponent={<EmptyState icon={emptyIcon} title={emptyTitle} sub={emptySub} />}
      {...rest}
    />
  );
}

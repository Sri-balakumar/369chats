// Smoke test for the design system. It does not assert styling — it asserts the
// components mount and render what they are given, which is what breaks first
// when a token is renamed or an import goes stale.
import React from 'react';
import { render } from '@testing-library/react-native';

import Screen from '../Screen';
import ScreenHeader from '../ScreenHeader';
import Banner from '../Banner';
import Card from '../Card';
import ChipRow from '../ChipRow';
import DataList from '../DataList';
import EmptyState from '../EmptyState';
import Row from '../Row';
import SelectField from '../SelectField';
import SectionCard from '../SectionCard';

describe('components/ui', () => {
  it('renders a screen with a header and a card', () => {
    const { getByText } = render(
      <Screen>
        <ScreenHeader title="Settings" onBack={() => {}} />
        <Card><Row label="Server" value="odoo.example.com" /></Card>
      </Screen>,
    );
    expect(getByText('Settings')).toBeTruthy();
    expect(getByText('Server')).toBeTruthy();
    expect(getByText('odoo.example.com')).toBeTruthy();
  });

  it('shows the banner only when there is a message', () => {
    const { queryByText, rerender } = render(<Banner banner={null} />);
    expect(queryByText('Saved')).toBeNull();
    rerender(<Banner banner={{ kind: 'ok', msg: 'Saved' }} />);
    expect(queryByText('Saved')).toBeTruthy();
  });

  it('renders chips and marks the active one', () => {
    const chips = [{ key: 'all', label: 'All' }, { key: 'new', label: 'New', count: 3 }];
    const { getByText } = render(<ChipRow chips={chips} value="all" onChange={() => {}} />);
    expect(getByText('All')).toBeTruthy();
    // count is appended to the label
    expect(getByText('New 3')).toBeTruthy();
  });

  it('DataList falls through loading → error → empty → rows', () => {
    const item = { id: 1, name: 'Row one' };
    const renderItem = ({ item: it }) => <Row label={it.name} value="ok" />;
    const keyExtractor = (it) => String(it.id);

    const { queryByText, rerender } = render(
      <DataList data={[]} loading renderItem={renderItem} keyExtractor={keyExtractor} />,
    );
    expect(queryByText('Nothing here yet')).toBeNull();   // loading, not empty

    rerender(<DataList data={[]} error="Could not load." renderItem={renderItem} keyExtractor={keyExtractor} />);
    expect(queryByText('Could not load.')).toBeTruthy();

    rerender(<DataList data={[]} renderItem={renderItem} keyExtractor={keyExtractor} />);
    expect(queryByText('Nothing here yet')).toBeTruthy();

    rerender(<DataList data={[item]} renderItem={renderItem} keyExtractor={keyExtractor} />);
    expect(queryByText('Row one')).toBeTruthy();
    expect(queryByText('Nothing here yet')).toBeNull();
  });

  it('renders an empty state and a section card with a select field', () => {
    const { getByText } = render(
      <SectionCard title="Account" icon="cog">
        <SelectField label="Country" value="" placeholder="Pick one" onPress={() => {}} />
      </SectionCard>,
    );
    expect(getByText('Account')).toBeTruthy();
    expect(getByText('Country')).toBeTruthy();
    expect(getByText('Pick one')).toBeTruthy();
  });

  it('EmptyState shows a retry only when given a handler', () => {
    const { queryByText, rerender } = render(<EmptyState title="No features yet" />);
    expect(queryByText('Retry')).toBeNull();
    rerender(<EmptyState title="No features yet" onRetry={() => {}} />);
    expect(queryByText('Retry')).toBeTruthy();
  });
});

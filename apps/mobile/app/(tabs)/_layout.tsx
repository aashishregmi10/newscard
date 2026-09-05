import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, type ColorValue } from 'react-native';
import { useSettings } from '../../src/state/SettingsContext';
import { useBookmarks } from '../../src/state/BookmarksContext';

/**
 * Bottom navigation.  Spec Ch. 7.9.
 *
 * THREE tabs, not seven. The reference app runs My Feed / Daily Ritual /
 * Finance / Timelines / Videos / Insights / Good News across a scrolling strip,
 * plus Search / Home / Profile beneath. Ours is Feed / Saved / Settings because:
 *
 *   Search    — v2. Needs an indexed corpus, Nepali stemming and spelling
 *               correction, and behavioural data to rank. A search box that
 *               returns nothing for a name on screen is worse than no box.
 *   Finance   — needs a paid NEPSE market-data licence.
 *   Videos    — v2, and it is the data-cost problem in a market where data is
 *               metered.
 *   Timelines / Insights — v2.
 *   Daily Ritual — rejected outright. It is a streak mechanic, and the review
 *               mining behind this product found undisableable streak reminders
 *               are a leading cause of uninstalls.
 *   Profile   — the MVP has no accounts, so there is no avatar to show. The
 *               settings that would live behind it are in Settings instead.
 *
 * A tab bar with five dead ends is worse than three that work.
 */

/** Simple glyph icons: no icon-font dependency, which keeps the bundle inside
 *  the size budget (Ch. 12.6). Each is paired with a label, so meaning never
 *  rests on the glyph alone. */
function TabIcon({
  glyph,
  focused,
  color,
  badge,
}: {
  glyph: string;
  focused: boolean;
  /** react-navigation hands back a ColorValue, not a plain string. */
  color: ColorValue;
  badge?: number;
}) {
  return (
    <View style={styles.iconWrap}>
      <Text style={{ fontSize: 19, color, opacity: focused ? 1 : 0.75 }}>{glyph}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function TabsLayout() {
  const { theme } = useSettings();
  const { items } = useBookmarks();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.divider,
          height: 58,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon glyph="▤" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon glyph="♡" focused={focused} color={color} badge={items.length} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon glyph="⚙" focused={focused} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: { width: 34, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#C0392B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});

import { Tabs } from 'expo-router';
import { View, StyleSheet, Pressable, type ColorValue, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSettings } from '../../src/state/SettingsContext';
import { emitFeedTabPress } from '../../src/lib/feedTabSignal';
import { textSize } from '../../src/theme/tokens';

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

/**
 * Material icons from @expo/vector-icons, which ships with Expo — no extra
 * download and no webfont request at runtime.
 *
 * The filled/outlined pair carries the selected state as SHAPE, not only as
 * colour, so the active tab is still obvious to someone who cannot distinguish
 * the accent from the muted grey (Ch. 11.7).
 */
type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * No count badge on Saved.
 *
 * A number on a tab is a nag: it asks to be cleared, and there is nothing here
 * to clear — a saved story is something the reader chose to keep, not an unread
 * item demanding attention. The icon already changes shape when the tab is
 * active, which is all the state this needs.
 */
function TabIcon({
  name,
  nameFocused,
  focused,
  color,
}: {
  name: IconName;
  nameFocused: IconName;
  focused: boolean;
  /** react-navigation hands back a ColorValue, not a plain string. */
  color: ColorValue;
}) {
  return (
    <View style={styles.iconWrap}>
      <MaterialCommunityIcons
        name={focused ? nameFocused : name}
        size={23}
        color={color as string}
      />
    </View>
  );
}

export default function TabsLayout() {
  const { theme, languages } = useSettings();
  const ne = languages.includes('ne');
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.divider,
          /*
           * Room for an icon and a label at BASE_TEXT_SCALE, PLUS the phone's
           * own bottom inset. A height set here replaces the one the tab bar
           * would compute, inset included — and the app draws edge to edge, so
           * without adding it back the icons sit under Android's navigation
           * buttons and the iPhone's home indicator.
           */
          height: 64 + insets.bottom,
          paddingBottom: 6 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: textSize(11), fontWeight: '600' },
        /*
         * A light tint inside the tab, not Android's default press effect.
         *
         * The default is an unbounded ripple at 32% black, drawn as a circle
         * wider than the tab itself; on a light bar it read as the screen going
         * dark on every tap (a reader's recording, 6 Oct 2026). Bounded and in
         * the accent at about 12%, it still acknowledges the touch at once.
         */
        tabBarButton: ({ children, style, onPress, onLongPress, testID, ...rest }) => (
          <Pressable
            onPress={onPress as ((e: GestureResponderEvent) => void) | undefined}
            onLongPress={onLongPress as ((e: GestureResponderEvent) => void) | null | undefined}
            testID={testID}
            style={style}
            android_ripple={{ color: `${theme.accent}1F`, borderless: false }}
            accessibilityRole="tab"
            accessibilityLabel={rest['aria-label']}
            accessibilityState={{ selected: rest['aria-selected'] === true }}
          >
            {children}
          </Pressable>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        /**
         * Pressing Feed while Feed is already open returns to the top, and
         * pressing it again refreshes — the behaviour every other app on the
         * reader's phone has. When the Feed tab is NOT focused this is ordinary
         * navigation, so nothing is emitted and nothing is intercepted.
         */
        listeners={({ navigation }) => ({
          tabPress: () => {
            if (navigation.isFocused()) emitFeedTabPress();
          },
        })}
        options={{
          title: ne ? 'समाचार' : 'Feed',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              name="card-text-outline"
              nameFocused="card-text"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="videos"
        options={{
          title: ne ? 'भिडियो' : 'Shorts',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              name="play-circle-outline"
              nameFocused="play-circle"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: ne ? 'सुरक्षित' : 'Saved',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              name="bookmark-outline"
              nameFocused="bookmark"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: ne ? 'सेटिङ' : 'Settings',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="cog-outline" nameFocused="cog" focused={focused} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: { width: 34, alignItems: 'center', justifyContent: 'center' },
});

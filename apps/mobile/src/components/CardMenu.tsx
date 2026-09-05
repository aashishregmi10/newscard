import { Modal, View, Text, Pressable, StyleSheet, Share, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Card } from '../api/client';
import type { Theme } from '../theme/tokens';

/**
 * The card overflow menu.  Spec Ch. 7.8.
 *
 * A bottom sheet rather than a popover: it is reachable one-handed on a large
 * phone, which a menu anchored to a top-right icon is not.
 *
 * The important item is "Not interested". It must VISIBLY change the feed —
 * competitor reviews are full of complaints that the control does nothing, and
 * each of those is a reader learning the app ignores them.
 */

interface Props {
  visible: boolean;
  card: Card | null;
  theme: Theme;
  lang: 'ne' | 'en';
  onClose: () => void;
  onNotInterested: (card: Card) => void;
  onHideSource: (card: Card) => void;
}

const T = {
  notInterested: { en: 'Not interested in this topic', ne: 'यो विषयमा रुचि छैन' },
  hideSource: { en: 'Hide stories from this source', ne: 'यो स्रोतका समाचार नदेखाउने' },
  report: { en: 'Report a problem', ne: 'समस्या रिपोर्ट गर्नुहोस्' },
  copy: { en: 'Copy link', ne: 'लिङ्क कपी गर्नुहोस्' },
  share: { en: 'Share', ne: 'सेयर गर्नुहोस्' },
  browser: { en: 'Open in browser', ne: 'ब्राउजरमा खोल्नुहोस्' },
  cancel: { en: 'Cancel', ne: 'रद्द गर्नुहोस्' },
} as const;

export function CardMenu({
  visible,
  card,
  theme,
  lang,
  onClose,
  onNotInterested,
  onHideSource,
}: Props) {
  if (!card) return null;

  const Item = ({
    label,
    onPress,
    destructive,
  }: {
    label: string;
    onPress: () => void;
    destructive?: boolean;
  }) => (
    <Pressable
      style={({ pressed }) => [
        styles.item,
        { borderBottomColor: theme.divider, backgroundColor: pressed ? theme.surfaceRaised : 'transparent' },
      ]}
      onPress={() => {
        onPress();
        onClose();
      }}
      accessibilityRole="button"
    >
      <Text style={{ fontSize: 15.5, color: destructive ? '#C0392B' : theme.textPrimary }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping outside dismisses — a sheet with no escape but a button is a
          trap on a phone. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={[styles.sheet, { backgroundColor: theme.surface, borderTopColor: theme.divider }]}>
        <View style={[styles.grabber, { backgroundColor: theme.divider }]} />

        <Text style={[styles.title, { color: theme.textSecondary }]} numberOfLines={2}>
          {card.headline}
        </Text>

        <Item label={T.notInterested[lang]} onPress={() => onNotInterested(card)} />
        <Item label={T.hideSource[lang]} onPress={() => onHideSource(card)} />
        <Item
          label={T.copy[lang]}
          onPress={() => void Clipboard.setStringAsync(card.publisherUrl)}
        />
        <Item
          label={T.share[lang]}
          onPress={() =>
            void Share.share({
              // Attribution travels with the share; the recipient should never
              // have to guess who reported it.
              message: `${card.headline}\n\n${card.summary}\n\nSource: ${card.source.name}\n${card.publisherUrl}`,
            })
          }
        />
        <Item
          label={T.browser[lang]}
          onPress={() => void Linking.openURL(card.publisherUrl)}
        />
        <Item label={T.report[lang]} onPress={() => undefined} destructive />

        <Pressable style={styles.cancel} onPress={onClose}>
          <Text style={{ fontSize: 15.5, fontWeight: '600', color: theme.accent }}>
            {T.cancel[lang]}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 28,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 9, marginBottom: 6 },
  title: { fontSize: 12.5, paddingHorizontal: 20, paddingVertical: 10 },
  item: { paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth },
  cancel: { paddingVertical: 15, alignItems: 'center' },
});

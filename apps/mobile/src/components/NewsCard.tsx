import { View, Text, StyleSheet, Pressable, Linking, Share } from 'react-native';
import type { Card } from '../api/client';
import { CardImage } from './CardImage';
import { relativeTime } from '../lib/relativeTime';
import { useBookmarks } from '../state/BookmarksContext';
import { LINE_HEIGHT, TYPE, type Theme } from '../theme/tokens';

/**
 * One story card.  Spec Ch. 7.2.
 *
 * Layout order is fixed: image → action row → headline → summary → attribution
 * → read-more strip. The attribution line is NOT optional and NOT conditional
 * (Ch. 7.2.2) — it is an ethical commitment, what our publishers get in return
 * for licensing to us, and a legal protection, all at once.
 */

interface Props {
  card: Card;
  theme: Theme;
  height: number;
  textScale: number;
  dataSaver: boolean;
  isDark?: boolean;
  /** Opens the overflow menu (Ch. 7.8). */
  onMenu?: (card: Card) => void;
}

export function NewsCard({ card, theme, height, textScale, dataSaver, onMenu }: Props) {
  const bookmarks = useBookmarks();
  const saved = bookmarks.has(card.id);
  const lh = LINE_HEIGHT[card.language];
  const summarySize = TYPE.summary.size * textScale;
  const headlineSize = TYPE.headline.size * textScale;

  const when = card.sourcePublishedAt ?? card.publishedAt;
  const attribution = [
    relativeTime(new Date(when), card.language),
    card.author,
    // A wire story republished by an outlet must credit the agency, not just the
    // outlet that carried it (plan §2c).
    card.originatingAgency ?? card.source.name,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const openArticle = () => {
    void Linking.openURL(card.publisherUrl);
  };

  return (
    <View style={[styles.card, { height, backgroundColor: theme.surface }]}>
      {onMenu && (
        <Pressable
          style={styles.overflow}
          hitSlop={12}
          onPress={() => onMenu(card)}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <Text style={[styles.overflowIcon, { color: theme.stripText }]}>⋯</Text>
        </Pressable>
      )}

      <CardImage
        image={card.image}
        theme={theme}
        height={height * 0.38}
        dataSaver={dataSaver}
      />

      <View style={[styles.actionRow, { borderBottomColor: theme.divider }]}>
        <Text style={[styles.sourceChip, { color: theme.accent }]} numberOfLines={1}>
          {card.source.name}
        </Text>
        <View style={styles.actions}>
          {/* Optimistic and instant — nothing leaves the device, so there is
              nothing to fail and no spinner to show (Ch. 9.4). */}
          <Pressable
            onPress={() => bookmarks.toggle(card)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Remove from saved' : 'Save story'}
          >
            <Text style={[styles.actionIcon, { color: saved ? theme.accent : theme.textSecondary }]}>
              {saved ? '♥' : '♡'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              // Attribution travels with the share — the source name is part of
              // the payload, not something the recipient has to guess.
              void Share.share({
                message: `${card.headline}\n\n${card.summary}\n\nSource: ${card.source.name}\n${card.publisherUrl}`,
              });
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Share story"
          >
            <Text style={[styles.actionIcon, { color: theme.textSecondary }]}>↗</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        <Text
          style={[
            styles.headline,
            {
              color: theme.textPrimary,
              fontSize: headlineSize,
              lineHeight: headlineSize * TYPE.headline.lineHeight,
            },
          ]}
          numberOfLines={TYPE.headline.maxLines}
        >
          {card.headline}
        </Text>

        {/* Never truncated. The summary IS the product; a cut-off short is a
            broken product (Ch. 7.7). If it does not fit, it scrolls. */}
        <Text
          style={[
            styles.summary,
            {
              color: theme.textPrimary,
              fontSize: summarySize,
              lineHeight: summarySize * lh,
            },
          ]}
        >
          {card.summary}
        </Text>

        <Text
          style={[
            styles.attribution,
            { color: theme.textSecondary, fontSize: TYPE.attribution.size * textScale },
          ]}
          numberOfLines={1}
        >
          {attribution}
        </Text>
      </View>

      <Pressable
        style={[styles.strip, { backgroundColor: theme.strip }]}
        onPress={openArticle}
        accessibilityRole="link"
      >
        {card.pullQuote ? (
          <Text style={[styles.pullQuote, { color: theme.stripText }]} numberOfLines={1}>
            {card.pullQuote}
          </Text>
        ) : null}
        <Text style={[styles.stripCta, { color: theme.stripText }]}>
          {card.language === 'ne' ? 'पूरा समाचार पढ्न ट्याप गर्नुहोस्' : 'Tap to read the full story'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { justifyContent: 'flex-start' },
  overflow: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  overflowIcon: { fontSize: 19, lineHeight: 21, fontWeight: '700' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sourceChip: { fontSize: TYPE.chip.size, fontWeight: TYPE.chip.weight, flex: 1 },
  actions: { flexDirection: 'row', gap: 20 },
  actionIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  body: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },
  headline: { fontWeight: TYPE.headline.weight, marginBottom: 10 },
  summary: { marginBottom: 14 },
  attribution: { marginTop: 'auto', marginBottom: 12 },
  strip: { paddingHorizontal: 18, paddingVertical: 12, minHeight: 64, justifyContent: 'center' },
  pullQuote: { fontSize: 15, fontWeight: '600', marginBottom: 3 },
  stripCta: { fontSize: 13, opacity: 0.75 },
});

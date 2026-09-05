import { View, Text, ScrollView, StyleSheet, Switch, Pressable, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings, type ThemeMode } from '../../src/state/SettingsContext';
import { useBookmarks } from '../../src/state/BookmarksContext';
import { useFilters } from '../../src/state/FiltersContext';
import { TEXT_SCALE, type TextSizeSetting } from '../../src/theme/tokens';
import type { Theme } from '../../src/theme/tokens';

/**
 * Settings.  Spec Ch. 11.2, 11.6.1, 12.2.
 *
 * Everything the reader can change lives here and nowhere else. Notably ABSENT,
 * and deliberately so:
 *
 *   Login / profile     — the MVP has no accounts (Ch. 13.1)
 *   Autoplay            — no video in the MVP
 *   Auto-start          — we do not run at boot
 *   Notification prefs  — the surface arrives with notifications in M6; adding a
 *                         dead toggle now would be a promise we cannot keep
 */

function Section({ title, theme, children }: { title: string; theme: Theme; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.divider }]}>
        {children}
      </View>
    </View>
  );
}

function Row({
  label,
  hint,
  theme,
  right,
  onPress,
  last,
}: {
  label: string;
  hint?: string;
  theme: Theme;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
      ]}
    >
      <View style={styles.rowLabel}>
        <Text style={[styles.rowText, { color: theme.textPrimary }]}>{label}</Text>
        {hint ? <Text style={[styles.rowHint, { color: theme.textSecondary }]}>{hint}</Text> : null}
      </View>
      {right}
    </Wrapper>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  theme,
}: {
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  theme: Theme;
}) {
  return (
    <View style={[styles.seg, { borderColor: theme.divider }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[styles.segItem, on && { backgroundColor: theme.accent }]}
          >
            <Text
              style={{
                fontSize: 12.5,
                fontWeight: '600',
                color: on ? '#fff' : theme.textSecondary,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const s = useSettings();
  const { items, clear } = useBookmarks();
  const filters = useFilters();
  const insets = useSafeAreaInsets();
  const t = s.theme;
  const ne = s.languages.includes('ne');

  return (
    <View style={[styles.root, { backgroundColor: t.surface, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: t.divider }]}>
        <Text style={[styles.title, { color: t.textPrimary }]}>
          {ne ? 'सेटिङ' : 'Settings'}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        <Section title={ne ? 'पढ्ने भाषा' : 'READING LANGUAGES'} theme={t}>
          <Row
            label="नेपाली"
            theme={t}
            right={
              <Switch
                value={s.languages.includes('ne')}
                onValueChange={() => s.toggleLanguage('ne')}
                trackColor={{ true: t.accent }}
              />
            }
          />
          <Row
            label="English"
            theme={t}
            last
            right={
              <Switch
                value={s.languages.includes('en')}
                onValueChange={() => s.toggleLanguage('en')}
                trackColor={{ true: t.accent }}
              />
            }
          />
        </Section>
        <Text style={[styles.note, { color: t.textSecondary }]}>
          {ne
            ? 'एउटा मात्र भाषा छनोट गर्दा दैनिक समाचारको संख्या उल्लेख्य रूपमा घट्छ।'
            : 'Choosing a single language substantially reduces how many stories you see each day.'}
        </Text>

        <Section title={ne ? 'डाटा' : 'DATA'} theme={t}>
          <Row
            label={ne ? 'डाटा सेभर' : 'Data Saver'}
            hint={
              ne
                ? 'तस्बिर आफैँ लोड हुँदैन — ट्याप गरेपछि मात्र।'
                : 'Images load only when you tap them.'
            }
            theme={t}
            last
            right={
              <Switch
                value={s.dataSaver}
                onValueChange={s.setDataSaver}
                trackColor={{ true: t.accent }}
              />
            }
          />
        </Section>

        <Section title={ne ? 'देखिने रूप' : 'APPEARANCE'} theme={t}>
          <Row
            label={ne ? 'थिम' : 'Theme'}
            theme={t}
            right={
              <Segmented<ThemeMode>
                theme={t}
                value={s.themeMode}
                onChange={s.setThemeMode}
                options={[
                  { key: 'system', label: 'Auto' },
                  { key: 'light', label: 'Light' },
                  { key: 'dark', label: 'Dark' },
                ]}
              />
            }
          />
          <Row
            label={ne ? 'अक्षरको आकार' : 'Text size'}
            theme={t}
            last
            right={
              <Segmented<TextSizeSetting>
                theme={t}
                value={s.textSize}
                onChange={s.setTextSize}
                options={(Object.keys(TEXT_SCALE) as TextSizeSetting[]).map((k) => ({
                  key: k,
                  label: k === 'default' ? 'M' : k === 'small' ? 'S' : k === 'large' ? 'L' : 'XL',
                }))}
              />
            }
          />
        </Section>

        <Section title={ne ? 'सुरक्षित समाचार' : 'SAVED STORIES'} theme={t}>
          <Row
            label={ne ? 'सुरक्षित संख्या' : 'Saved on this device'}
            hint={
              ne
                ? 'यो यन्त्रमा मात्र सुरक्षित छ। एप हटाए हराउँछ।'
                : 'Stored on this device only. Lost if you uninstall the app.'
            }
            theme={t}
            last
            right={
              <Pressable
                disabled={items.length === 0}
                onPress={() =>
                  Alert.alert(
                    ne ? 'सबै हटाउने?' : 'Clear all saved?',
                    ne ? 'यो फिर्ता गर्न मिल्दैन।' : 'This cannot be undone.',
                    [
                      { text: ne ? 'रद्द' : 'Cancel', style: 'cancel' },
                      { text: ne ? 'हटाउने' : 'Clear', style: 'destructive', onPress: clear },
                    ],
                  )
                }
              >
                <Text style={{ color: items.length ? '#C0392B' : t.textSecondary, fontWeight: '600' }}>
                  {items.length} {items.length ? (ne ? 'हटाउने' : 'Clear') : ''}
                </Text>
              </Pressable>
            }
          />
        </Section>

        {/* Every "not interested" tap is reversible here. A filter the reader
            cannot find and undo is a trap, not a preference (Ch. 7.8). */}
        {(filters.mutedCategories.length > 0 || filters.mutedSources.length > 0) && (
          <>
            <Section title={ne ? 'लुकाइएका' : 'HIDDEN'} theme={t}>
              {filters.mutedCategories.map((slug, i, arr) => (
                <Row
                  key={`c-${slug}`}
                  label={slug}
                  hint={ne ? 'विषय लुकाइएको' : 'Topic hidden'}
                  theme={t}
                  last={i === arr.length - 1 && filters.mutedSources.length === 0}
                  right={
                    <Pressable onPress={() => filters.unmuteCategory(slug)} hitSlop={8}>
                      <Text style={{ color: t.accent, fontWeight: '600' }}>
                        {ne ? 'देखाउने' : 'Unhide'}
                      </Text>
                    </Pressable>
                  }
                />
              ))}
              {filters.mutedSources.map((name, i, arr) => (
                <Row
                  key={`s-${name}`}
                  label={name}
                  hint={ne ? 'स्रोत लुकाइएको' : 'Source hidden'}
                  theme={t}
                  last={i === arr.length - 1}
                  right={
                    <Pressable onPress={() => filters.unmuteSource(name)} hitSlop={8}>
                      <Text style={{ color: t.accent, fontWeight: '600' }}>
                        {ne ? 'देखाउने' : 'Unhide'}
                      </Text>
                    </Pressable>
                  }
                />
              ))}
            </Section>
          </>
        )}

        <Section title={ne ? 'बारेमा' : 'ABOUT'} theme={t}>
          <Row
            label={ne ? 'गोपनीयता नीति' : 'Privacy policy'}
            theme={t}
            onPress={() => void Linking.openURL('https://example.invalid/privacy')}
          />
          <Row
            label={ne ? 'सर्तहरू' : 'Terms of use'}
            theme={t}
            onPress={() => void Linking.openURL('https://example.invalid/terms')}
          />
          <Row label={ne ? 'संस्करण' : 'Version'} theme={t} last right={
            <Text style={{ color: t.textSecondary }}>0.1.0</Text>
          } />
        </Section>

        <Text style={[styles.note, { color: t.textSecondary, marginTop: 4 }]}>
          {ne
            ? 'यो एप कुनै विज्ञापन पहिचानकर्ता, स्थान वा सम्पर्क सङ्कलन गर्दैन।'
            : 'This app collects no advertising ID, no location, and no contacts.'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: '700' },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 7,
    marginLeft: 4,
  },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 54,
    gap: 12,
  },
  rowLabel: { flex: 1 },
  rowText: { fontSize: 15, fontWeight: '500' },
  rowHint: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  note: { fontSize: 12, lineHeight: 17, marginTop: -12, marginBottom: 20, marginHorizontal: 4 },
  seg: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  segItem: { paddingHorizontal: 11, paddingVertical: 6 },
});

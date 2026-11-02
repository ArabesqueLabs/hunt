// The app's few building blocks: text, buttons, fields, cards and states
// (loading, empty, an error), in the design system's colours.

import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewStyle } from "react-native";
import { radius, space, useColors } from "@/lib/theme";

export function Title({ children, style, ...rest }: TextProps & { children: ReactNode }) {
  const c = useColors();
  return <Text {...rest} style={[styles.title, { color: c.text }, style]}>{children}</Text>;
}

export function Body({ children, style, ...rest }: TextProps & { children: ReactNode }) {
  const c = useColors();
  return <Text {...rest} style={[styles.body, { color: c.text }, style]}>{children}</Text>;
}

export function Muted({ children, style, ...rest }: TextProps & { children: ReactNode }) {
  const c = useColors();
  return <Text {...rest} style={[styles.small, { color: c.muted }, style]}>{children}</Text>;
}

/** A section's heading, small and in capitals. */
export function Heading({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return (
    <View style={[styles.heading, style]}>
      <Text accessibilityRole="header" style={[styles.headingText, { color: c.muted }]}>{children}</Text>
    </View>
  );
}

type Kind = "primary" | "quiet" | "danger";

export function Button({ label, onPress, kind = "primary", busy, disabled, small, style }: {
  label: string; onPress: () => void; kind?: Kind; busy?: boolean; disabled?: boolean; small?: boolean; style?: ViewStyle;
}) {
  const c = useColors();
  const bg = kind === "primary" ? c.accent : "transparent";
  const fg = kind === "primary" ? c.onAccent : kind === "danger" ? c.danger : c.accent;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button, small && styles.buttonSmall,
        { backgroundColor: bg, borderColor: kind === "primary" ? c.accent : c.line, opacity: off ? 0.5 : pressed ? 0.75 : 1 },
        style,
      ]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, small && styles.small, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, style, ...rest }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.small, styles.label, { color: c.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...rest}
        style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: c.line }, style]}
      />
    </View>
  );
}

/** A box of related things, on the page's surface colour. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }, style]}>{children}</View>;
}

/** A tappable row in a list. */
export function Row({ children, onPress, label }: { children: ReactNode; onPress?: () => void; label?: string }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed && onPress ? c.sunk : c.surface, borderColor: c.line }]}>
      {children}
    </Pressable>
  );
}

/** Choices side by side, one of them chosen. */
export function Segmented<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={[styles.segmented, { borderColor: c.line, backgroundColor: c.sunk }]} accessibilityRole="tablist">
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <Pressable key={v} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(v)}
            style={[styles.segment, on && { backgroundColor: c.surface, borderColor: c.line }]}>
            <Text style={[styles.small, { color: on ? c.text : c.muted, fontWeight: on ? "600" : "400" }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Loading() {
  const c = useColors();
  return <View style={styles.center}><ActivityIndicator color={c.accent} /></View>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.center}>
      <Title style={styles.centerText}>{title}</Title>
      {children ? <Muted style={styles.centerText}>{children}</Muted> : null}
    </View>
  );
}

/** Something went wrong: what, and a way to try again. */
export function Failed({ message, retry }: { message: string; retry?: () => void }) {
  const c = useColors();
  return (
    <View style={styles.center}>
      <Body style={[styles.centerText, { color: c.danger }]}>{message}</Body>
      {retry ? <Button label="Try again" kind="quiet" onPress={retry} style={{ marginTop: space.md }} /> : null}
    </View>
  );
}

/** A coloured label: overdue, a stage. */
export function Badge({ label, tone = "plain" }: { label: string; tone?: "plain" | "warning" | "accent" }) {
  const c = useColors();
  const [bg, fg] = tone === "warning" ? [c.warningWash, c.warning] : tone === "accent" ? [c.accentWash, c.accent] : [c.sunk, c.muted];
  return <Text style={[styles.badge, { backgroundColor: bg, color: fg }]}>{label}</Text>;
}

export const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  heading: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  headingText: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" },
  button: { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  buttonSmall: { minHeight: 32, paddingHorizontal: space.md },
  buttonText: { fontSize: 15, fontWeight: "600" },
  field: { gap: space.xs },
  label: { fontWeight: "500" },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius, padding: space.lg, gap: space.sm },
  row: { paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  segmented: { flexDirection: "row", borderWidth: StyleSheet.hairlineWidth, borderRadius: radius, padding: 2 },
  segment: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: radius - 2, borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm },
  centerText: { textAlign: "center" },
  badge: { alignSelf: "flex-start", fontSize: 12, fontWeight: "600", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
});

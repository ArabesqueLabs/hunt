// Connecting to a hunt: its address, then (if it signs people in) an
// account's address and password, traded once for a token.

import { router } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { S } from "@web/state";
import { Body, Button, Field, Muted, Title } from "@/components/ui";
import { connect, forgetServer, restore, signIn, useSession } from "@/lib/session";
import { space, useColors } from "@/lib/theme";

export default function Connect() {
  const s = useSession();
  const c = useColors();
  const { hasShareIntent } = useShareIntentContext();
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (s.status === "loading" || s.status === "in") return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      // Shared from another app before signing in: on to that.
      if (hasShareIntent) router.replace("/share");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const another = <Button label="Use another hunt" kind="quiet" onPress={() => { setError(null); forgetServer(); }} />;
  let body;
  if (s.status === "unreachable") {
    body = <>
      <Body>{s.message}</Body>
      <Button label="Try again" busy={busy} onPress={() => run(restore)} />
      {another}
    </>;
  } else if (s.server && s.needsSignIn) {
    const name = S.META?.about?.name;
    body = <>
      <Muted>Signing in to {name ? `${name}, at ` : ""}{s.server}</Muted>
      <Field label="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
        keyboardType="email-address" textContentType="username" autoComplete="email" returnKeyType="next" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password"
        autoComplete="current-password" returnKeyType="go" onSubmitEditing={() => run(() => signIn(email, password))} />
      <Button label="Sign in" busy={busy} disabled={!email || !password} onPress={() => run(() => signIn(email, password))} />
      {another}
    </>;
  } else {
    body = <>
      <Muted>Your hunt's address: where you open it in a browser.</Muted>
      <Field label="Address" value={address} onChangeText={setAddress} placeholder="https://hunt.example.com" autoCapitalize="none"
        autoCorrect={false} keyboardType="url" textContentType="URL" returnKeyType="go" onSubmitEditing={() => run(() => connect(address))} />
      <Button label="Connect" busy={busy} disabled={!address.trim()} onPress={() => run(() => connect(address))} />
    </>;
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Image source={require("../../assets/icon.png")} style={styles.logo} accessibilityIgnoresInvertColors />
            <Title style={styles.name}>hunt</Title>
          </View>
          {body}
          {error ? <Body style={{ color: c.danger }} accessibilityLiveRegion="polite">{error}</Body> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { padding: space.xl, gap: space.lg, flexGrow: 1, justifyContent: "center" },
  brand: { alignItems: "center", gap: space.sm, marginBottom: space.lg },
  logo: { width: 72, height: 72, borderRadius: 16 },
  name: { fontSize: 24 },
});

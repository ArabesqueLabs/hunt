// Who's signed in, to which hunt; opening it on the web; signing out.

import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { Alert, ScrollView, StyleSheet } from "react-native";
import { S } from "@web/state";
import { Body, Button, Card, Muted, Title } from "@/components/ui";
import { forgetServer, signOut, useSession } from "@/lib/session";
import { space } from "@/lib/theme";

export default function Account() {
  const s = useSession();
  if (s.status !== "in") return null;
  const name = S.META?.about?.name || "hunt";
  const token = !!S.META?.tenancy?.built_in;

  const confirmSignOut = () =>
    Alert.alert("Sign out?", token
      ? "This phone forgets how it signed in. To revoke its access, use Settings → Connected apps in hunt on the web."
      : undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => (token ? signOut() : forgetServer()) },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card>
        <Title>{name}</Title>
        <Muted>{s.server}</Muted>
        {s.email ? <Body>Signed in as {s.email}</Body> : null}
        {S.META?.version ? <Muted>hunt {S.META.version} · app {Constants.expoConfig?.version}</Muted> : null}
      </Card>
      <Button label="Open hunt on the web" kind="quiet" onPress={() => WebBrowser.openBrowserAsync(s.server)} />
      <Button label="Sign out" kind="danger" onPress={confirmSignOut} />
      {token ? <Button label="Use another hunt" kind="quiet" onPress={forgetServer} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md },
});

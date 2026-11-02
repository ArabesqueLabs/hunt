// The app: signed in, its tabs and an application's page; not, the
// screen that connects to a hunt. Sharing to hunt from another app opens
// the share screen over either.

import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { ShareIntentProvider } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { restore, useSession } from "@/lib/session";
import { useColors } from "@/lib/theme";

SplashScreen.preventAutoHideAsync();

export default function Root() {
  const s = useSession();
  const c = useColors();

  useEffect(() => { restore(); }, []);
  useEffect(() => { if (s.status !== "loading") SplashScreen.hideAsync(); }, [s.status]);

  // The splash stays up until it's known whether hunt is signed in.
  const signedIn = s.status === "in";

  return (
    <ShareIntentProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.accent,
        headerTitleStyle: { color: c.text },
        contentStyle: { backgroundColor: c.bg },
      }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="application/[id]" options={{ title: "", headerBackTitle: "Back" }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="connect" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="share" options={{ presentation: "modal", title: "Add to your stash" }} />
      </Stack>
    </ShareIntentProvider>
  );
}

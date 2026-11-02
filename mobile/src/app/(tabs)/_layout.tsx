// Signed in: what's due, the applications, the stash, and you.

import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { useColors } from "@/lib/theme";

type Icon = ComponentProps<typeof Ionicons>["name"];
const icon = (name: Icon) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: c.accent,
      tabBarInactiveTintColor: c.muted,
      tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
      headerStyle: { backgroundColor: c.surface },
      headerTitleStyle: { color: c.text },
      sceneStyle: { backgroundColor: c.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: "Due", tabBarIcon: icon("alarm-outline") }} />
      <Tabs.Screen name="applications" options={{ title: "Applications", tabBarIcon: icon("briefcase-outline") }} />
      <Tabs.Screen name="stash" options={{ title: "Stash", tabBarIcon: icon("file-tray-outline") }} />
      <Tabs.Screen name="account" options={{ title: "You", tabBarIcon: icon("person-circle-outline") }} />
    </Tabs>
  );
}

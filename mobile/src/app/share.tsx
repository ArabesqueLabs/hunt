// Shared to hunt from another app: a posting's link (with its page's
// title), or some text, kept in the stash to sort later, as the browser
// extension keeps them.

import { router } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { post } from "@web/api";
import { Body, Button, Card, Field, Muted, Title } from "@/components/ui";
import { useSession } from "@/lib/session";
import { space, useColors } from "@/lib/theme";

export default function Share() {
  const c = useColors();
  const s = useSession();
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntentContext();
  const url = shareIntent.webUrl || null;
  // The text, less the link it carried, when there's more to it than that.
  const rest = (shareIntent.text || "").replace(url || "\u0000", "").trim();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(String(shareIntent.meta?.title || ""));
    setNote(url ? rest : shareIntent.text || "");
  }, [shareIntent]);

  function leave(to: "/stash" | "/") {
    resetShareIntent();
    if (router.canDismiss()) router.dismissAll();
    router.replace(to);
  }

  async function keep() {
    setBusy(true);
    setError(null);
    try {
      await post("stash", { url: url || undefined, title: title.trim() || undefined, body: note.trim() || undefined, source: "share" });
      leave("/stash");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (s.status !== "in") {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Title>Sign in to hunt first</Title>
        <Body>Once you're signed in, this comes back here to add to your stash.</Body>
        <Button label="Sign in" onPress={() => router.replace("/connect")} />
      </ScrollView>
    );
  }
  if (!hasShareIntent) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Body>{shareError ? `Couldn't read what was shared: ${shareError}` : "Nothing was shared."}</Body>
        <Button label="Close" kind="quiet" onPress={() => leave("/")} />
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {url ? <Card><Muted>Link</Muted><Body selectable numberOfLines={3}>{url}</Body></Card> : null}
      {url ? <Field label="Title" value={title} onChangeText={setTitle} placeholder="What it is (optional)" /> : null}
      <Field label={url ? "Note" : "Text"} value={note} onChangeText={setNote} multiline placeholder={url ? "Anything to remember (optional)" : ""}
        style={styles.text} />
      <Button label="Add to stash" busy={busy} disabled={!url && !note.trim()} onPress={keep} />
      <Button label="Cancel" kind="quiet" onPress={() => leave("/")} />
      {error ? <Body style={{ color: c.danger }}>{error}</Body> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md },
  text: { minHeight: 96, textAlignVertical: "top" },
});

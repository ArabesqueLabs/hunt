// The stash: links and notes kept to sort later, shared here from other
// apps or added here. They're sorted (made into applications, notes,
// reminders…) in hunt on the web; here they can be dismissed, or put back.

import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { get, post } from "@web/api";
import { fmtStamp } from "@web/format";
import type { Row as Item } from "@web/types";
import { Body, Button, Empty, Failed, Field, Loading, Muted, Row, Segmented } from "@/components/ui";
import { attemptChange, useLoad } from "@/lib/load";
import { plainText } from "@/lib/text";
import { space, useColors } from "@/lib/theme";

type Status = "new" | "done" | "dismissed";
const TABS: [Status, string][] = [["new", "To sort"], ["done", "Sorted"], ["dismissed", "Dismissed"]];

export default function Stash() {
  const c = useColors();
  const [status, setStatus] = useState<Status>("new");
  const items = useLoad<Item[]>(() => get(`stash?status=${status}`), status);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  async function add() {
    setAdding(true);
    const made = await attemptChange(() => post("stash", { text: text.trim(), source: "app" }));
    setAdding(false);
    if (made) { setText(""); if (status === "new") items.reload(); else setStatus("new"); }
  }

  if (items.error && !items.data) return <Failed message={items.error} retry={items.reload} />;
  return (
    <FlatList
      data={items.data || []}
      keyExtractor={(x) => String(x.id)}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={items.refreshing} onRefresh={items.refresh} tintColor={c.accent} />}
      ListHeaderComponent={
        <View style={styles.tools}>
          <Field label="Keep for later" value={text} onChangeText={setText} placeholder="A link, or a note" multiline
            autoCapitalize="sentences" style={styles.input} />
          <Button label="Add to stash" busy={adding} disabled={!text.trim()} onPress={add} />
          <Segmented options={TABS} value={status} onChange={setStatus} />
        </View>
      }
      renderItem={({ item }) => <StashRow item={item} status={status} changed={items.reload} />}
      ListEmptyComponent={items.data ? (
        <Empty title={status === "new" ? "Nothing to sort" : status === "done" ? "Nothing sorted yet" : "Nothing dismissed"}>
          {status === "new" ? "Share a posting from your browser to hunt, and it waits here." : undefined}
        </Empty>
      ) : <Loading />}
      ListFooterComponent={items.data?.length && status === "new"
        ? <Muted style={styles.footer}>Sort these into applications, notes and reminders in hunt on the web.</Muted> : undefined}
    />
  );
}

function StashRow({ item, status, changed }: { item: Item; status: Status; changed: () => void }) {
  const [busy, setBusy] = useState(false);
  const title = item.title || item.filename || item.url || plainText(item.body).slice(0, 120) || "Item";
  const act = async (what: "dismiss" | "reopen") => {
    setBusy(true);
    const done = await attemptChange(() => post(`stash/${item.id}/${what}`, {}));
    setBusy(false);
    if (done) changed();
  };
  return (
    <Row onPress={item.url ? () => WebBrowser.openBrowserAsync(item.url) : undefined} label={item.url ? `Open ${title}` : title}>
      <Body style={{ fontWeight: "600" }} numberOfLines={2}>{title}</Body>
      {item.url && item.url !== title ? <Muted numberOfLines={1}>{item.url}</Muted> : null}
      {item.body && item.body !== title ? <Body numberOfLines={3}>{plainText(item.body)}</Body> : null}
      <Muted>{[status === "new" ? item.suggestion?.why : null, fmtStamp(item.created_at)].filter(Boolean).join(" · ")}</Muted>
      <View style={styles.actions}>
        {status === "new"
          ? <Button small kind="quiet" label="Dismiss" busy={busy} onPress={() => act("dismiss")} />
          : status === "dismissed" ? <Button small kind="quiet" label="Put back" busy={busy} onPress={() => act("reopen")} /> : null}
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  tools: { padding: space.lg, gap: space.md },
  input: { minHeight: 64, textAlignVertical: "top" },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  footer: { padding: space.lg, textAlign: "center" },
});

// The applications on the board (the running cycles'), by stage: searched
// and filtered as the web's are (its filters.ts), to what's due next or
// overdue; or the closed ones.

import { router } from "expo-router";
import { useMemo, useState } from "react";
import { RefreshControl, SectionList, StyleSheet, TextInput, View } from "react-native";
import { loadBoard } from "@web/board";
import { FILTER_KEYS, matchesFilters, placeOf, rowFromCard, type FilterRow, type Filters } from "@web/filters";
import { fmtMoney, HOME, homePay } from "@web/format";
import { closedWhy } from "@web/meta";
import type { Board, Card } from "@web/types";
import { Badge, Body, Empty, Failed, Heading, Loading, Muted, Row, Segmented } from "@/components/ui";
import { useLoad } from "@/lib/load";
import { radius, space, useColors } from "@/lib/theme";

type Show = "all" | "next" | "overdue" | "closed";
const SHOW: [Show, string][] = [["all", "All"], ["next", "Due next"], ["overdue", "Overdue"], ["closed", "Closed"]];

const NO_FILTERS = Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])) as Filters;

interface Item { row: FilterRow; card: Card; pay: string; why?: string }

/** Pay in the home currency, short: £85k–100k/yr. */
function payText(card: Card) {
  const p = homePay(card);
  return p ? fmtMoney(p[0] == null ? null : Math.round(p[0]), p[1] == null ? null : Math.round(p[1]), HOME(), card.pay_period) : "";
}

/** The board's processes, in sections: each stage's (open), or the closed ones. */
function sections(b: Board, show: Show, q: string) {
  const place = placeOf(b);
  const f: Filters = { ...NO_FILTERS, q, attn: show === "next" || show === "overdue" ? show : "" };
  const item = (card: Card): Item => ({ row: rowFromCard(card, place), card, pay: payText(card) });
  if (show === "closed") {
    const data = b.archived.map((card) => ({ ...item(card), why: closedWhy(card, card.stage) })).filter((x) => matchesFilters(x.row, f));
    return data.length ? [{ title: "Closed", data }] : [];
  }
  return b.stages
    .map((st) => ({ title: st.name, data: st.cards.map(item).filter((x) => matchesFilters(x.row, f)) }))
    .filter((s) => s.data.length);
}

export default function Applications() {
  const c = useColors();
  const board = useLoad(loadBoard);
  const [show, setShow] = useState<Show>("all");
  const [q, setQ] = useState("");
  const list = useMemo(() => (board.data ? sections(board.data, show, q) : []), [board.data, show, q]);

  if (board.error && !board.data) return <Failed message={board.error} retry={board.reload} />;
  if (!board.data) return <Loading />;
  return (
    <SectionList
      sections={list}
      keyExtractor={(x) => String(x.card.id)}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={board.refreshing} onRefresh={board.refresh} tintColor={c.accent} />}
      ListHeaderComponent={
        <View style={styles.tools}>
          <TextInput value={q} onChangeText={setQ} placeholder="Search applications" placeholderTextColor={c.muted}
            accessibilityLabel="Search applications" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search"
            style={[styles.search, { color: c.text, backgroundColor: c.surface, borderColor: c.line }]} />
          <Segmented options={SHOW} value={show} onChange={setShow} />
        </View>
      }
      renderSectionHeader={({ section }) => <Heading style={{ backgroundColor: c.bg }}>{`${section.title} · ${section.data.length}`}</Heading>}
      renderItem={({ item }) => <ApplicationRow x={item} />}
      ListEmptyComponent={
        <Empty title={q ? "No applications match" : show === "closed" ? "Nothing closed" : show === "all" ? "No applications yet" : "Nothing due"}>
          {q ? "Try other words." : show === "all" ? "Add one in hunt on the web, or share a posting to your stash." : undefined}
        </Empty>
      }
      stickySectionHeadersEnabled
    />
  );
}

function ApplicationRow({ x }: { x: Item }) {
  const { row, card } = x;
  const next = row.next;
  return (
    <Row onPress={() => router.push(`/application/${card.application_id}?process=${card.id}` as never)}
      label={[row.company, row.title, next?.text].filter(Boolean).join(", ")}>
      <Body style={{ fontWeight: "600" }}>{row.company}</Body>
      {row.title ? <Body>{row.title}</Body> : null}
      {[row.location, x.pay].some(Boolean) ? <Muted>{[row.location, x.pay].filter(Boolean).join(" · ")}</Muted> : null}
      {x.why ? <Badge label={x.why} /> : null}
      {next ? <View style={{ marginTop: 4 }}><Badge label={next.text || next.title} tone={next.overdue ? "warning" : "accent"} /></View> : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  tools: { padding: space.lg, gap: space.md },
  search: { minHeight: 40, borderWidth: 1, borderRadius: radius, paddingHorizontal: space.md, fontSize: 16 },
});

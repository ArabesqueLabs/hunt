// What's due: overdue next actions first, then today's, tomorrow's and
// the rest of the week's: next actions, interviews, applications closing.

import { router } from "expo-router";
import { RefreshControl, SectionList, View } from "react-native";
import { fmtDay, isOverdue } from "@web/format";
import type { Row as Event } from "@web/types";
import { Badge, Body, Empty, Failed, Heading, Loading, Muted, Row } from "@/components/ui";
import { eventHref, KIND, loadDue } from "@/lib/due";
import { useLoad } from "@/lib/load";
import { useColors } from "@/lib/theme";

export default function Due() {
  const c = useColors();
  const due = useLoad(() => loadDue());
  if (due.error && !due.data) return <Failed message={due.error} retry={due.reload} />;
  if (!due.data) return <Loading />;
  return (
    <SectionList
      sections={due.data}
      keyExtractor={(e) => `${e.kind}-${e.ref_id}`}
      refreshControl={<RefreshControl refreshing={due.refreshing} onRefresh={due.refresh} tintColor={c.accent} />}
      renderSectionHeader={({ section }) => <Heading style={{ backgroundColor: c.bg }}>{section.title}</Heading>}
      renderItem={({ item }) => <DueRow e={item} />}
      ListEmptyComponent={<Empty title="Nothing due this week">Next actions, interviews and closing dates show here.</Empty>}
      contentContainerStyle={due.data.length ? undefined : { flexGrow: 1 }}
    />
  );
}

function DueRow({ e }: { e: Event }) {
  const overdue = e.kind === "next" && isOverdue(e.at);
  const when = overdue ? `${fmtDay(e.at)}, overdue` : fmtDay(e.at);
  return (
    <Row onPress={() => router.push(eventHref(e) as never)} label={`${e.title}, ${e.company}, ${when}`}>
      <Body style={{ fontWeight: "600" }}>{e.title}</Body>
      <Muted>{[e.company, e.role].filter(Boolean).join(" · ")}</Muted>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
        <Badge label={KIND[e.kind] || e.kind} tone={e.kind === "step" ? "accent" : "plain"} />
        <Badge label={when} tone={overdue ? "warning" : "plain"} />
      </View>
    </Row>
  );
}

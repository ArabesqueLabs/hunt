// An application: the role and its company, the stage its process is at
// (moved on from here), its open reminders (done from here), its
// interviews, and its notes (added to from here). An application applied
// to more than once has a process for each: the one asked for, or the
// newest open one, with the others a tap away.

import { Stack, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { get, patch, post } from "@web/api";
import { fmtDay, fmtMoney, isOverdue, isoToday, zonedNow } from "@web/format";
import { closedWhy, fieldOf, optionLabel } from "@web/meta";
import type { Row as Rec } from "@web/types";
import { Badge, Body, Button, Card, Failed, Field, Heading, Loading, Muted, Title } from "@/components/ui";
import { attemptChange, useLoad } from "@/lib/load";
import { plainText } from "@/lib/text";
import { radius, space, useColors } from "@/lib/theme";

interface Loaded {
  app: Rec; company: Rec; procs: Rec[]; stages: Rec[];
  process: Rec | null; detail: Rec | null; reminders: Rec[];
}

async function loadApplication(id: string, processId: number | null): Promise<Loaded> {
  const [procs, stages]: [Rec[], Rec[]] = await Promise.all([get(`processes?application_id=${id}`), get("stages")]);
  procs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const process = procs.find((p) => p.id === processId) || procs.find((p) => p.status === "active") || procs[0] || null;
  if (!process) {
    const app = await get(`applications/${id}`);
    return { app, company: await get(`companies/${app.company_id}`), procs, stages, process: null, detail: null, reminders: [] };
  }
  const [detail, reminders] = await Promise.all([get(`processes/${process.id}/detail`), get(`reminders?process_id=${process.id}`)]);
  return { app: detail.application, company: detail.company, procs, stages, process: detail.process ?? process, detail, reminders };
}

/** Now, as a local date and time (as the web marks a reminder done). */
const localNow = () => `${isoToday()}T${zonedNow().toTimeString().slice(0, 5)}`;

/** A field's option's label (a work mode, a step's status), if hunt says what it is. */
function labelOf(resource: string, field: string, v: string | null | undefined) {
  if (!v) return "";
  try { return optionLabel(fieldOf(resource, field).options, v); } catch { return v; }
}

export default function Application() {
  const c = useColors();
  const params = useLocalSearchParams<{ id: string; process?: string }>();
  const processId = params.process ? Number(params.process) : null;
  const a = useLoad(() => loadApplication(params.id, processId), processId);
  const [moving, setMoving] = useState(false);

  if (a.error && !a.data) return <Failed message={a.error} retry={a.reload} />;
  if (!a.data) return <Loading />;
  const { app, company, procs, stages, process, detail, reminders } = a.data;
  const stageName = (id: number | null | undefined) => stages.find((s) => s.id === id)?.name || "";
  const open = process?.status === "active";
  const pay = fmtMoney(app.salary_min, app.salary_max, app.currency, app.pay_period);
  const facts = [app.location, labelOf("applications", "work_mode", app.work_mode), pay].filter(Boolean).join(" · ");

  async function moveTo(stageId: number) {
    setMoving(false);
    if (!process || stageId === process.stage_id) return;
    if (await attemptChange(() => post(`processes/${process.id}/move`, { stage_id: stageId }))) a.reload();
  }

  return (
    <>
      <Stack.Screen options={{ title: company?.name || "" }} />
      <ScrollView contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={a.refreshing} onRefresh={a.refresh} tintColor={c.accent} />}>
        <View style={styles.head}>
          <Muted>{company?.name}</Muted>
          <Title style={styles.role}>{app.title || "Untitled role"}</Title>
          {facts ? <Muted>{facts}</Muted> : null}
          {app.closes_on ? <Muted>Applications close {fmtDay(app.closes_on)}</Muted> : null}
          {app.url ? <Button small kind="quiet" label="Open the posting" onPress={() => WebBrowser.openBrowserAsync(app.url)}
            style={styles.start} /> : null}
        </View>

        {procs.length > 1 ? (
          <View style={styles.chips}>
            {procs.map((p) => (
              <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected: p.id === process?.id }}
                onPress={() => router.setParams({ process: String(p.id) })}
                style={[styles.chip, { borderColor: p.id === process?.id ? c.accent : c.line, backgroundColor: c.surface }]}>
                <Body style={{ color: p.id === process?.id ? c.accent : c.text }}>
                  {`${p.applied_on ? `Applied ${fmtDay(p.applied_on)}` : "Not applied"}${p.status === "active" ? "" : " (closed)"}`}
                </Body>
              </Pressable>
            ))}
          </View>
        ) : null}

        {process ? (
          <Card style={styles.stage}>
            <View style={{ flex: 1, gap: 2 }}>
              <Muted>{open ? "Stage" : "Closed"}</Muted>
              <Body style={{ fontWeight: "600" }}>{open ? stageName(process.stage_id) : closedWhy(process, stageName(process.stage_id))}</Body>
              {process.applied_on ? <Muted>Applied {fmtDay(process.applied_on)}</Muted> : null}
            </View>
            {open ? <Button small label="Move" onPress={() => setMoving(true)} /> : null}
          </Card>
        ) : <Muted>Not on the board: no process for this application yet.</Muted>}

        {process ? <Reminders list={reminders} open={open} changed={a.reload} /> : null}
        {detail?.steps?.length ? <Interviews steps={detail.steps} /> : null}
        {process ? <Notes notes={detail?.notes || []} processId={process.id} open={open} changed={a.reload} /> : null}
      </ScrollView>

      <StagePicker visible={moving} stages={stages.filter((s) => s.active !== 0)} current={process?.stage_id}
        pick={moveTo} close={() => setMoving(false)} />
    </>
  );
}

function Reminders({ list, open, changed }: { list: Rec[]; open: boolean; changed: () => void }) {
  const todo = list.filter((r) => !r.done_at).sort((x, y) => String(x.due_at || "9").localeCompare(String(y.due_at || "9")));
  if (!todo.length) return null;
  return (
    <View>
      <Heading style={styles.flush}>Next actions</Heading>
      <Card>
        {todo.map((r) => <Reminder key={r.id} r={r} open={open} changed={changed} />)}
      </Card>
    </View>
  );
}

function Reminder({ r, open, changed }: { r: Rec; open: boolean; changed: () => void }) {
  const [busy, setBusy] = useState(false);
  const late = isOverdue(r.due_at);
  async function done() {
    setBusy(true);
    const ok = await attemptChange(() => patch(`reminders/${r.id}`, { done_at: localNow() }));
    setBusy(false);
    if (ok) changed();
  }
  return (
    <View style={styles.line}>
      <View style={{ flex: 1, gap: 2 }}>
        <Body>{r.title}</Body>
        <Badge label={r.due_at ? (late ? `Was due ${fmtDay(r.due_at)}` : fmtDay(r.due_at)) : "No date"} tone={late ? "warning" : "plain"} />
      </View>
      {open ? <Button small kind="quiet" label="Done" busy={busy} onPress={done} /> : null}
    </View>
  );
}

function Interviews({ steps }: { steps: Rec[] }) {
  const sorted = [...steps].sort((x, y) => String(x.at || "9").localeCompare(String(y.at || "9")));
  return (
    <View>
      <Heading style={styles.flush}>Interviews</Heading>
      <Card>
        {sorted.map((s) => (
          <View key={s.id} style={styles.line}>
            <View style={{ flex: 1, gap: 2 }}>
              <Body>{s.title}</Body>
              <Muted>{[s.at ? fmtDay(s.at) : "No date yet", labelOf("steps", "format", s.format), s.people?.map((p: Rec) => p.name).join(", ")]
                .filter(Boolean).join(" · ")}</Muted>
            </View>
            {s.status ? <Badge label={labelOf("steps", "status", s.status)} tone={s.status === "scheduled" ? "accent" : "plain"} /> : null}
          </View>
        ))}
      </Card>
    </View>
  );
}

function Notes({ notes, processId, open, changed }: { notes: Rec[]; processId: number; open: boolean; changed: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const sorted = [...notes].sort((x, y) => String(y.happened_on || y.created_at).localeCompare(String(x.happened_on || x.created_at)));
  async function add() {
    setBusy(true);
    const made = await attemptChange(() => post("notes", { process_id: processId, body: text.trim() }));
    setBusy(false);
    if (made) { setText(""); changed(); }
  }
  return (
    <View>
      <Heading style={styles.flush}>Notes</Heading>
      <Card>
        {open ? <>
          <Field label="Add a note" value={text} onChangeText={setText} multiline placeholder="What happened, what's next"
            style={styles.note} />
          <Button small label="Save note" busy={busy} disabled={!text.trim()} onPress={add} style={styles.start} />
        </> : null}
        {sorted.map((n) => (
          <View key={n.id} style={styles.noteItem}>
            <Muted>{fmtDay(n.happened_on || n.created_at.slice(0, 10))}</Muted>
            <Body selectable>{plainText(n.body)}</Body>
          </View>
        ))}
        {!sorted.length && !open ? <Muted>No notes.</Muted> : null}
      </Card>
    </View>
  );
}

/** The board's stages, to move a process to. */
function StagePicker({ visible, stages, current, pick, close }: {
  visible: boolean; stages: Rec[]; current?: number; pick: (id: number) => void; close: () => void;
}) {
  const c = useColors();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={styles.sheetHead}>
          <Title>Move to</Title>
          <Button small kind="quiet" label="Cancel" onPress={close} />
        </View>
        <ScrollView>
          {stages.sort((x, y) => x.position - y.position).map((s) => (
            <Pressable key={s.id} accessibilityRole="button" accessibilityState={{ selected: s.id === current }} onPress={() => pick(s.id)}
              style={({ pressed }) => [styles.option, { borderColor: c.line, backgroundColor: pressed ? c.sunk : c.surface }]}>
              <Body style={{ fontWeight: s.id === current ? "600" : "400", color: s.id === current ? c.accent : c.text }}>{s.name}</Body>
              {s.id === current ? <Muted>Now</Muted> : null}
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg },
  head: { gap: space.xs },
  role: { fontSize: 22 },
  start: { alignSelf: "flex-start", marginTop: space.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius, paddingHorizontal: space.md, paddingVertical: space.xs },
  stage: { flexDirection: "row", alignItems: "center", gap: space.md },
  flush: { paddingHorizontal: 0, paddingTop: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs },
  note: { minHeight: 72, textAlignVertical: "top" },
  noteItem: { gap: 2, paddingTop: space.sm },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: space.lg },
  option: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
});

"use strict";

// Pages for companies, people and documents (/companies/ID, /people/ID,
// /files/ID), made like the application page: they read first; Edit turns
// the details into a form saved together, or discarded. Tags and what's done
// to the whole record (import, picture, delete) are at the end. New ones
// have pages too (/companies/new …). Built on app.js.

/** The editable fields of a resource. */
const editableFields = (r) => r.fields.filter((f) => !f.readonly);

async function showRecordPage(page, id, { editing = false, versionId = null } = {}) {
  const r = R(LISTS[page].resource);
  let rec;
  try { rec = await get(`${r.name}/${id}`); } catch (e) {
    fill(view, h("div.page", {}, notice("danger", { role: "alert" }, e.message), h("a", { href: `/${page}` }, `← ${r.title}`)));
    return;
  }
  const keys = editableFields(r).map((f) => f.name);
  let edit = editing;
  let orig = { fields: Object.fromEntries(keys.map((k) => [k, rec[k] ?? null])), tags: tagNames(rec.tags) };
  let draft = structuredClone(orig);
  const opened = new Set();
  const dirty = () => edit && JSON.stringify(draft) !== JSON.stringify(orig);
  leaveGuard = () => dirty();
  window.onbeforeunload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
  const pageEl = h("div.page.application.record-page");
  const reload = (opts = {}) => { leaveGuard = null; return showRecordPage(page, id, opts); };
  const setEdit = (on) => {
    if (!on && dirty() && !confirm("Discard your changes?")) return;
    edit = on;
    draft = structuredClone(orig);
    render();
    if (on) pageEl.querySelector(".record-form input, .record-form select, .record-form textarea")?.focus();
  };
  const picture = r.entity === "company" ? "logo" : r.entity === "person" ? "photo" : null;

  // Sections fold from their header, as on the application page.
  let folds = {};
  try { folds = JSON.parse(stored("appFolds") || "{}"); } catch { folds = {}; }
  const section = (key, title, { count } = {}, ...body) => h("details.al-disclosure.app-section", {
    open: !(folds[key] ?? false), dataset: { section: key },
    ontoggle: (e) => { if (e.target === e.currentTarget) { folds[key] = !e.currentTarget.open; store("appFolds", JSON.stringify(folds)); } },
  }, h("summary", {}, h("h2", {}, title, count != null ? h("span.count", {}, count) : null)), h("div.app-section-body", {}, body));

  function head() {
    const pic = picture === "logo" ? logoOf(id, rec.logo, rec.name, 48)
      : picture === "photo" ? photoOf(id, rec.photo, rec.name, 48)
        : h("span.logo.doc-icon", { "aria-hidden": "true" }, "▤");
    return h("header.app-head", {},
      pic,
      h("div.app-title", {}, h("h1", {}, rec.label)),
      h("div.app-mode", {},
        h("div.al-segmented", { role: "group", "aria-label": "Mode" },
          h("button", { type: "button", "aria-pressed": String(!edit), onclick: () => edit && setEdit(false) }, "View"),
          h("button", { type: "button", "aria-pressed": String(edit), onclick: () => !edit && setEdit(true) }, "Edit")),
        edit ? [h("button.al-button", { type: "button", onclick: () => setEdit(false) }, "Discard"),
          h("button.al-button.al-button--primary", { type: "button", onclick: save }, "✓ Save changes")] : null));
  }

  function details() {
    // The name is the heading already.
    if (!edit) return h("div.app-section.app-role", {}, recordView(r.name, rec, { skip: ["name"] }));
    return h("div.app-section.app-role.record-form", {},
      h("div.fields", {}, fieldLayout(editableFields(r), (f, label) =>
        fieldControl(r.name, f, draft.fields[f.name], (v) => { draft.fields[f.name] = v; }, { quiet: true, label }))));
  }

  async function related() {
    const out = [];
    if (r.entity === "company") {
      const [apps, people, board] = await Promise.all([get(`applications?company_id=${id}`), get(`people?company_id=${id}`), get("board?archived_since=")]);
      // Each application's stage: its newest active process's, or else its
      // newest one's, archived.
      const cards = [...board.stages.flatMap((st) => st.cards), ...board.archived].sort((x, y) => y.created_at.localeCompare(x.created_at));
      const stageOf = (a) => {
        const mine = cards.filter((c) => c.application_id === a.id);
        const c = mine.find((x) => x.status === "active") || mine[0];
        if (!c) return h("span.al-badge", {}, "Not on the board");
        return c.status === "active"
          ? h("span.al-badge.al-badge--accent", {}, c.stage)
          : h("span.al-badge", { title: c.archive_note || "" }, `${c.reached_stage || c.stage} · ${closedWhy(c)}`);
      };
      out.push(section("applications", "Applications", { count: apps.length },
        apps.length ? h("ul.viz-list.company-apps", {}, apps.map((a) => h("li", {}, logoOf(id, rec.logo, rec.name, 22),
          h("div.company-app", {}, h("a", { href: `/applications/${a.id}` }, a.title || a.label),
            h("div.company-app-meta", {}, stageOf(a), tagNames(a.tags).map((t) => tagChip(t)))),
          h("span.muted.small", {}, fmtDay(a.created_at.slice(0, 10))))))
          : h("p.muted.small", {}, "None yet.")));
      out.push(section("company-people", "People", { count: people.length },
        people.length ? h("ul.viz-list", {}, people.map((p) => h("li", {}, photoOf(p.id, p.photo, p.name, 22),
          h("a", { href: `/people/${p.id}` }, p.name), h("span.muted.small", {}, p.title || ""))))
          : h("p.muted.small", {}, "Nobody yet.")));
    }
    if (r.entity === "document") {
      out.push(section("versions", "Versions", {}, h("div.versions-slot")));
    }
    const log = activityPanel([]);
    get(`activity?entity=${r.entity}&entity_id=${id}`).then((rows) => log.update(rows)).catch(() => {});
    out.push(log);
    return out;
  }

  function footer() {
    const tags = !r.taggable ? null : edit
      ? (() => {
        const add = h("input.tag-input", { "aria-label": "Add a tag", placeholder: "Add a tag…" });
        const addTag = () => {
          const t = add.value.trim();
          if (t && !draft.tags.some((x) => x.toLowerCase() === t.toLowerCase())) draft.tags.push(t);
          add.value = "";
          render();
          pageEl.querySelector(".tag-input")?.focus();
        };
        add.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } });
        add.addEventListener("blur", () => { if (add.value.trim()) addTag(); });
        return [draft.tags.map((t) => tagChip(t, h("button.al-tag__remove", { type: "button", "aria-label": `Remove tag ${t}`,
          onclick: () => { draft.tags = draft.tags.filter((x) => x !== t); render(); } }, "×"))), add];
      })()
      : [tagNames(rec.tags).map((t) => colourTagChip(t)),
        opened.has("tag")
          ? (() => {
            const add = h("input.tag-input", { "aria-label": "New tag", placeholder: "A tag, then Enter" });
            add.addEventListener("keydown", async (e) => {
              if (e.key === "Escape") { opened.delete("tag"); render(); return; }
              if (e.key !== "Enter" || !add.value.trim()) return;
              e.preventDefault();
              const saved = await attempt(() => put(`${r.name}/${id}/tags`, { tags: [...tagNames(rec.tags), add.value.trim()] }));
              if (saved) { rec.tags = saved; orig.tags = saved; draft.tags = [...saved]; opened.delete("tag"); TAGS = await get("tags"); render(); }
            });
            setTimeout(() => add.focus(), 0);
            return add;
          })()
          : h("button.al-button.al-button--quiet.app-add", { type: "button", onclick: () => { opened.add("tag"); render(); } }, "+ Add tag")];

    const tools = [];
    if (!edit && (r.entity === "company" || r.entity === "person")) {
      // With their LinkedIn link already here: read it again, straight away.
      tools.push(rec.linkedin
        ? h("button.al-button", { type: "button", onclick: () => refreshFromLinkedIn(r.entity, rec, reload) }, "Refresh from LinkedIn")
        : h("button.al-button", { type: "button", onclick: () => openImport({
          kind: r.entity === "company" ? companyImport : personImport,
          url: r.entity === "company" ? rec.website || "" : "",
          current: rec,
          apply: async (fields, found) => {
            const done = r.entity === "company" ? await applyToCompany(id, fields) : await applyToPerson(id, fields, found);
            if (done) { toast("Imported"); reload(); }
          },
        }) }, "Import from link…"));
    }
    if (!edit && picture) {
      const has = rec[picture];
      const picker = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async () => {
        const f = picker.files[0];
        if (!f) return;
        const res = await fetch(`/api/${r.name}/${id}/${picture}`, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { toast(data.error || "Couldn't use that image", "error"); return; }
        toast(`The ${picture} is updated`);
        reload();
      } });
      tools.push(picker, h("button.al-button", { type: "button", onclick: () => picker.click() }, has ? `Change ${picture}` : `Upload a ${picture}`));
      if (has) {
        tools.push(h("button.al-button", { type: "button", onclick: async () => {
          if (await attempt(() => del(`${r.name}/${id}/${picture}`))) { toast(`The ${picture} is removed`); reload(); }
        } }, `Remove ${picture}`));
      }
    }
    return h("section.app-section.app-footer", {},
      tags ? h("div.app-tags", {}, h("span.eyebrow", {}, "Tags"), tags) : null,
      edit ? null : h("div.actions", {},
        tools,
        h("span.spacer"),
        h("button.al-button.al-button--quiet.al-button--danger", { type: "button", onclick: async () => {
          const detail = { company: "Its applications must go first.", document: "All its versions go with it." }[r.entity];
          if (!(await confirmDelete(`${r.entity} ${rec.label}`, detail))) return;
          if (await attempt(() => del(`${r.name}/${id}`))) { leaveGuard = null; toast("Deleted"); go(`/${page}`); }
        } }, `Delete ${r.entity}`)));
  }

  async function save() {
    const changed = Object.fromEntries(keys.filter((k) => (draft.fields[k] ?? null) !== (orig.fields[k] ?? null)).map((k) => [k, draft.fields[k]]));
    const done = await attempt(async () => {
      if (Object.keys(changed).length) await patch(`${r.name}/${id}`, changed);
      if (r.taggable && JSON.stringify(draft.tags) !== JSON.stringify(orig.tags)) {
        await put(`${r.name}/${id}/tags`, { tags: draft.tags });
        TAGS = await get("tags");
      }
      return true;
    });
    if (done) { toast("Saved"); reload(); }
  }

  // A document, read: its preview in the main column, the rest beside it.
  let docData = null;
  if (r.entity === "document") {
    const versions = (await get(`versions?document_id=${id}`)).sort((a, b) => b.number - a.number);
    const uses = await Promise.all(versions.map((v) => get(`versions/${v.id}/uses`)));
    docData = { versions, uses: new Map(versions.map((v, i) => [v.id, uses[i]])), shown: versions.find((v) => v.id === versionId) || versions[0] || null, uploading: false };
  }

  function documentLayout() {
    const { versions, uses } = docData;
    const v = docData.shown;
    const kind = optionLabel(r.fields.find((f) => f.name === "kind").options, rec.kind);
    const panel = (key, title, { count, action } = {}, ...body) => h("section.al-panel.app-panel", { dataset: { section: key }, "aria-labelledby": `panel-${key}` },
      h("div.app-panel-head", {}, h("h2", { id: `panel-${key}` }, title), count != null ? h("span.al-badge.al-badge--count", {}, count) : null,
        action ? h("div.app-panel-tools", {}, action) : null),
      body);
    const show = (x) => {
      docData.shown = x;
      history.replaceState(null, "", appPath(`/${page}/${id}?version=${x.id}`));
      lastUrl = here();
      render();
    };
    const next = versions.length ? versions[0].number + 1 : 1;
    const tag = h("input", { "aria-label": "Tag for the new version", placeholder: "Tag, e.g. rust-focused" });
    const note = h("input", { "aria-label": "Note for the new version", placeholder: "What changed" });
    const upload = docData.uploading ? h("div.upload.doc-upload", {},
      fileDrop({ multiple: true, label: `Drop version ${next} here, or choose it`, onFiles: async (files) => {
        const made = await attempt(async () => {
          const out = [];
          for (const file of files) out.push(await uploadVersion(id, file, { tag: tag.value.trim(), note: note.value.trim() }));
          return out;
        });
        if (made) { toast(`Uploaded ${made.map((m) => `v${m.number}`).join(", ")}`); reload({ versionId: made.at(-1).id }); }
      } }),
      h("div.upload-meta", {}, tag, note),
      h("p.muted.small", {}, "Set a tag or note first if you like; they go with the next file you drop.")) : null;
    const startUpload = () => { docData.uploading = !docData.uploading; render(); };

    const preview = panel("preview", v ? `Version ${v.number}` : "Preview", {
      action: v ? [h("a.al-button.al-button--sm", { href: `/api/versions/${v.id}/file`, target: "_blank", rel: "noopener" }, "Open in a tab"),
        h("a.al-button.al-button--sm", { href: `/api/versions/${v.id}/file?download=1` }, icon("download"), h("span", {}, "Download"))] : null,
    },
    v ? [h("p.muted.small.doc-shown", { translate: "no" }, v.filename, " · ", fmtSize(v.size), " · ", fmtStamp(v.created_at)), previewOf(v)]
      : h("div.preview-none", {}, h("p", {}, "Upload a file to see it here.")));

    const details = panel("details", "Details", {},
      h("dl.app-facts", {},
        h("dt", {}, "Kind"), h("dd", {}, kind),
        h("dt", {}, "Versions"), h("dd", {}, String(versions.length)),
        v ? [h("dt", {}, "Latest"), h("dd", {}, `v${versions[0].number} · ${fmtDay(versions[0].created_at.slice(0, 10))}`)] : null,
        h("dt", {}, "Added"), h("dd", {}, fmtDay(rec.created_at.slice(0, 10)))),
      rec.description ? h("p.doc-description", { translate: "no" }, rec.description) : null);

    const versionList = panel("versions", "Versions", {
      count: versions.length,
      action: h("button.al-button.al-button--quiet.al-button--sm", { type: "button", "aria-expanded": String(docData.uploading), onclick: startUpload },
        docData.uploading ? "Cancel" : [icon("plus"), h("span", {}, `Upload version ${next}`)]),
    },
    upload,
    versions.length ? h("ol.doc-version-list", {}, versions.map((x) => {
      const sent = uses.get(x.id) || [];
      return h("li", {},
        h("button.doc-version", { type: "button", "aria-current": x.id === v?.id ? "true" : null, onclick: () => show(x) },
          h("span.doc-version-head", {}, h("b", {}, `v${x.number}`), h("span.doc-version-name", { translate: "no" }, x.filename)),
          h("span.muted.small", {}, `${fmtSize(x.size)} · ${fmtDay(x.created_at.slice(0, 10))}`),
          x.tag || x.note ? h("span.small.doc-version-note", {}, x.tag ? tagChip(x.tag) : null, x.note ? h("span", { translate: "no" }, ` ${x.note}`) : null) : null),
        h("span.small.muted.doc-version-sent", {}, sent.length
          ? ["Sent with ", sent.map((u, i) => [i ? ", " : "", h("a", { href: `/p/${u.id}` }, u.label)])]
          : "Not sent with anything yet"));
    })) : h("p.muted.small", {}, "No versions yet."));

    const log = activityPanel([]);
    get(`activity?entity=${r.entity}&entity_id=${id}`).then((rows) => log.update(rows)).catch(() => {});
    return [
      h("a.al-back-link", { href: `/${page}` }, "Files"),
      h("header.al-page-head.app-page-head", {},
        h("span.logo.doc-icon", { "aria-hidden": "true" }, "▤"),
        h("div.app-titles", {}, h("h1", { translate: "no" }, rec.label), h("div.app-sub", {}, h("span", {}, kind),
          h("span", { "aria-hidden": "true" }, "·"), h("span", {}, versions.length === 1 ? "1 version" : `${versions.length} versions`))),
        h("div.al-page-head__end", {},
          h("button.al-button.al-button--quiet", { type: "button", onclick: () => setEdit(true) }, icon("edit"), h("span", {}, "Edit details")),
          h("button.al-button.al-button--primary", { type: "button", onclick: () => { docData.uploading = true; render(); pageEl.querySelector(".doc-upload input[type=file]")?.focus(); } },
            icon("plus"), h("span", {}, `Upload version ${next}`)))),
      h("div.app-layout", {},
        h("div.app-main", {}, preview, log),
        h("aside.app-aside", { "aria-label": "About this file" },
          details, versionList,
          panel("tags", "Tags", {}, tagEditor(r.name, rec, (saved) => { rec.tags = saved; orig.tags = saved; draft.tags = [...saved]; })),
          h("div.app-delete", {},
            h("button.al-button.al-button--danger.al-button--quiet.al-button--sm", { type: "button", onclick: async () => {
              if (!(await confirmDelete(`document ${rec.label}`, "All its versions go with it."))) return;
              if (await attempt(() => del(`${r.name}/${id}`))) { leaveGuard = null; toast("Deleted"); go(`/${page}`); }
            } }, "Delete file")))),
    ];
  }

  // A company or a person, read: what they're about and what's theirs in
  // the main column, the facts beside it, as an application's page has it.
  let profile = null;
  if (r.entity === "company") {
    const [apps, people, board] = await Promise.all([get(`applications?company_id=${id}`), get(`people?company_id=${id}`), get("board?archived_since=")]);
    const cards = [...board.stages.flatMap((st) => st.cards), ...board.archived].sort((x, y) => y.created_at.localeCompare(x.created_at));
    profile = { apps, people, cards };
  } else if (r.entity === "person") {
    const company = rec.company_id ? await get(`companies/${rec.company_id}`).catch(() => null) : null;
    profile = { company };
  }

  function profileLayout() {
    const panel = (key, title, { count, action } = {}, ...body) => h("section.al-panel.app-panel", { dataset: { section: key }, "aria-labelledby": `panel-${key}` },
      h("div.app-panel-head", {}, h("h2", { id: `panel-${key}` }, title), count != null ? h("span.al-badge.al-badge--count", {}, count) : null,
        action ? h("div.app-panel-tools", {}, action) : null),
      body);
    const long = r.fields.filter((f) => f.type === "long-text");
    const pic = picture === "logo" ? logoOf(id, rec.logo, rec.name, 48) : photoOf(id, rec.photo, rec.name, 48);
    const sub = r.entity === "company"
      ? [rec.industry, rec.headquarters].filter(Boolean).map((x) => h("span", { translate: "no" }, x))
      : [rec.title ? h("span", { translate: "no" }, rec.title) : null,
        profile.company ? h("a", { href: `/companies/${profile.company.id}`, translate: "no" }, profile.company.name) : null,
        rec.location ? h("span", { translate: "no" }, rec.location) : null].filter(Boolean);
    const importer = rec.linkedin
      ? h("button.al-button", { type: "button", onclick: () => refreshFromLinkedIn(r.entity, rec, reload) }, "Refresh from LinkedIn")
      : h("button.al-button", { type: "button", onclick: () => openImport({
        kind: r.entity === "company" ? companyImport : personImport,
        url: r.entity === "company" ? rec.website || "" : "",
        current: rec,
        apply: async (fields, found) => {
          const done = r.entity === "company" ? await applyToCompany(id, fields) : await applyToPerson(id, fields, found);
          if (done) { toast("Imported"); reload(); }
        },
      }) }, "Import from link…");

    // The main column: what they're about, and what's theirs.
    const about = long.filter((f) => rec[f.name]).map((f) => panel(f.name, f.label, {}, h("div.prose.profile-prose", { translate: "no" }, rec[f.name])));
    const main = [...about];
    if (!about.length) main.push(panel("about", "About", {}, h("p.muted.small", {}, "Nothing written yet. ", h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: () => setEdit(true) }, "Add something"))));
    if (r.entity === "company") {
      const stageOf = (a) => {
        const mine = profile.cards.filter((c) => c.application_id === a.id);
        const c = mine.find((x) => x.status === "active") || mine[0];
        if (!c) return h("span.al-badge", {}, "Not on the board");
        return c.status === "active"
          ? h("span.al-badge.al-badge--accent", {}, c.stage)
          : h("span.al-badge", { title: c.archive_note || "" }, `${c.reached_stage || c.stage} · ${closedWhy(c)}`);
      };
      main.push(panel("applications", "Applications", { count: profile.apps.length },
        profile.apps.length ? h("ul.viz-list.company-apps", {}, profile.apps.map((a) => h("li", {}, logoOf(id, rec.logo, rec.name, 22),
          h("div.company-app", {}, h("a", { href: `/applications/${a.id}`, translate: "no" }, a.title || a.label),
            h("div.company-app-meta", {}, stageOf(a), tagNames(a.tags).map((t) => tagChip(t)))),
          h("span.muted.small", {}, fmtDay(a.created_at.slice(0, 10))))))
          : h("p.muted.small", {}, "None yet.")));
      main.push(panel("company-people", "People", { count: profile.people.length },
        profile.people.length ? h("ul.viz-list", {}, profile.people.map((p) => h("li", {}, photoOf(p.id, p.photo, p.name, 22),
          h("a", { href: `/people/${p.id}`, translate: "no" }, p.name), h("span.muted.small", { translate: "no" }, p.title || ""))))
          : h("p.muted.small", {}, "Nobody yet.")));
    }
    const log = activityPanel([]);
    get(`activity?entity=${r.entity}&entity_id=${id}`).then((rows) => log.update(rows)).catch(() => {});
    main.push(log);

    // Beside it: the facts, the picture, tags, and deleting.
    const facts = recordView(r.name, rec, { skip: ["name", ...long.map((f) => f.name)] });
    const has = rec[picture];
    const picker = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async () => {
      const f = picker.files[0];
      if (!f) return;
      const res = await fetch(`/api/${r.name}/${id}/${picture}`, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || "Couldn't use that image", "error"); return; }
      toast(`The ${picture} is updated`);
      reload();
    } });
    const picturePanel = panel("picture", picture === "logo" ? "Logo" : "Photo", {},
      h("div.profile-picture", {}, picture === "logo" ? logoOf(id, rec.logo, rec.name, 64) : photoOf(id, rec.photo, rec.name, 64),
        h("div.cycle-actions", {}, picker,
          h("button.al-button.al-button--sm", { type: "button", onclick: () => picker.click() }, has ? `Change ${picture}` : `Upload a ${picture}`),
          has ? h("button.al-button.al-button--quiet.al-button--sm", { type: "button", onclick: async () => {
            if (await attempt(() => del(`${r.name}/${id}/${picture}`))) { toast(`The ${picture} is removed`); reload(); }
          } }, `Remove ${picture}`) : null)));
    return [
      h("a.al-back-link", { href: "/contacts" }, "Contacts"),
      h("header.al-page-head.app-page-head", {}, pic,
        h("div.app-titles", {}, h("h1", { translate: "no" }, rec.label),
          sub.length ? h("div.app-sub", {}, sub.flatMap((x, i) => [i ? h("span", { "aria-hidden": "true" }, "·") : null, x])) : null),
        h("div.al-page-head__end", {},
          h("button.al-button.al-button--quiet", { type: "button", onclick: () => setEdit(true) }, icon("edit"), h("span", {}, "Edit details")),
          importer)),
      h("div.app-layout", {},
        h("div.app-main", {}, main),
        h("aside.app-aside", { "aria-label": r.entity === "company" ? "About this company" : "About this person" },
          panel("details", "Details", {}, facts),
          picturePanel,
          r.taggable ? panel("tags", "Tags", {}, tagEditor(r.name, rec, (saved) => { rec.tags = saved; orig.tags = saved; draft.tags = [...saved]; })) : null,
          h("div.app-delete", {},
            h("button.al-button.al-button--danger.al-button--quiet.al-button--sm", { type: "button", onclick: async () => {
              const detail = { company: "Its applications must go first." }[r.entity];
              if (!(await confirmDelete(`${r.entity} ${rec.label}`, detail))) return;
              if (await attempt(() => del(`${r.name}/${id}`))) { leaveGuard = null; toast("Deleted"); go("/contacts"); }
            } }, `Delete ${r.entity}`)))),
    ];
  }

  const relatedParts = await related();
  // A document's versions follow the mode: read, or edited.
  const versionsFor = async () => {
    const slot = relatedParts.find((p) => p.dataset?.section === "versions")?.querySelector(".versions-slot");
    if (slot) fill(slot, await versionsPanel(rec, () => {}, versionId, edit));
  };
  function render() {
    const scroll = window.scrollY;
    pageEl.classList.toggle("reading", !!(docData || profile) && !edit);
    if ((docData || profile) && !edit) {
      fill(pageEl, docData ? documentLayout() : profileLayout());
      window.scrollTo(0, scroll);
      return;
    }
    fill(pageEl,
      h("nav.crumbs", { "aria-label": "Back to" }, h("a", { href: `/${page}` }, `← ${r.title}`)),
      h("article.al-card.app", { class: edit ? "editing" : "" },
        head(),
        h("div.app-sections", {}, details(), relatedParts, footer())));
    window.scrollTo(0, scroll);
    if (r.entity === "document") versionsFor();
  }
  pageEl.addEventListener("keydown", (e) => {
    if (edit && (e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
  });
  fill(view, pageEl);
  render();
  document.title = `${rec.label} · ${BASE_TITLE}`;
}

/** A page for something new: a company, a person or a document. */
function newRecordPage(page, ...body) {
  const r = R(LISTS[page].resource);
  const title = r.entity === "document" ? "New document" : `New ${r.entity}`;
  fill(view, h("div.page.application.record-page", {},
    h("nav.crumbs", { "aria-label": "Back to" }, h("a", { href: `/${page}` }, `← ${r.title}`)),
    h("article.al-card.app", {}, h("header.app-head.no-pic", {}, h("div.app-title", {}, h("h1", {}, title))), h("div.app-sections", {}, body))));
  view.querySelector("article input, article select, article textarea")?.focus();
}

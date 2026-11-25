import { ActionForm, SubmitButton } from "@/components/form";
import { RichTextEditor } from "@/components/rich-text-editor";
import { MERGE_FIELDS } from "@/lib/merge-fields";
import { saveTemplateAction } from "./actions";

type Template = { id: string; name: string; subject: string; html: string; folderId: string | null; updatedAt: Date };

/** Create or edit form for an email template. Shared by /templates/new and /templates/[id]. */
export function TemplateForm({ template, folders, folderId }: {
  template?: Template;
  folders: { id: string; name: string }[];
  folderId?: string | null;
}) {
  return (
    <ActionForm action={saveTemplateAction.bind(null, template?.id ?? null)}
      resetKey={template?.updatedAt.toISOString()} className="card space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <div>
          <label htmlFor="template-name" className="label">Template name</label>
          <input id="template-name" name="name" className="input" maxLength={120} required
            defaultValue={template?.name} placeholder="Recruiter screen invitation" />
        </div>
        <div>
          <label htmlFor="template-folder" className="label">Folder</label>
          <select id="template-folder" name="folderId" className="input" defaultValue={template?.folderId ?? folderId ?? ""}>
            <option value="">Unfiled</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="template-subject" className="label">Subject</label>
        <input id="template-subject" name="subject" className="input" maxLength={200} required
          defaultValue={template?.subject} placeholder="Next steps for {{job_title}} at {{company_name}}" />
      </div>
      <div>
        <span id="template-body-label" className="label">Message</span>
        <RichTextEditor name="bodyHtml" defaultHtml={template?.html ?? ""} labelledBy="template-body-label" />
        <p className="muted mt-2 text-xs">
          Merge fields work in the subject and message:{" "}
          {MERGE_FIELDS.map((f, i) => (
            <span key={f.token}>{i > 0 && ", "}<code className="merge-token">{`{{${f.token}}}`}</code> {f.label.toLowerCase()}</span>
          ))}.
        </p>
      </div>
      <SubmitButton>{template ? "Save template" : "Create template"}</SubmitButton>
    </ActionForm>
  );
}

import { ActionForm, SubmitButton } from "@/components/form";
import { aiStatus, getAiSettings } from "@/lib/ai";
import { AI_FEATURES } from "@/lib/ai-rules";
import { requireUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { saveAiSettingsAction, testAiAction } from "./actions";

export default async function AiSettingsPage() {
  await requireUser(canManageUsers);
  const status = aiStatus();
  const settings = await getAiSettings();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">AI</h1>
      <p className="muted mt-1 max-w-2xl text-sm">
        AI is optional. Everything in the app works without it, and AI buttons only appear when it&apos;s set
        up and the feature is on below.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Provider</h2>
      {status ? (
        <dl className="card mt-3 grid max-w-2xl gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="muted">Provider</dt>
          <dd className="capitalize">{status.provider}</dd>
          <dt className="muted">Model</dt>
          <dd>{status.model}</dd>
          <dt className="muted">API key</dt>
          <dd>{status.key}</dd>
          {status.baseUrl && (
            <>
              <dt className="muted">Server</dt>
              <dd>{status.baseUrl}</dd>
            </>
          )}
        </dl>
      ) : (
        <div className="card mt-3 max-w-2xl space-y-2 text-sm">
          <p>AI is off. To turn it on, add these to your <code>.env</code> and restart:</p>
          <pre className="overflow-x-auto text-xs">{`AI_PROVIDER=anthropic   # or openai
AI_API_KEY=your-key
AI_MODEL=               # optional, defaults to a current model
AI_BASE_URL=            # optional, for OpenAI-compatible servers like Ollama`}</pre>
        </div>
      )}
      <p className="muted mt-2 max-w-2xl text-xs">
        The key is read from the server environment and never stored in the database or shown in full.
      </p>
      {status && (
        <ActionForm action={testAiAction} className="mt-3 space-y-2">
          <SubmitButton variant="secondary">Test connection</SubmitButton>
        </ActionForm>
      )}

      <h2 className="mt-10 text-lg font-semibold">Settings</h2>
      {/* Keyed on the saved values so the form shows them after React resets it post-submit. */}
      <ActionForm key={JSON.stringify(settings)} action={saveAiSettingsAction} className="card mt-3 max-w-2xl space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="redactPii" defaultChecked={settings.redactPii} className="mt-1" />
          <span>
            <span className="font-medium">Redact contact details</span>
            <span className="muted block">
              Emails, phone numbers, and links are replaced with placeholders before text is sent, then put back in
              the reply. Names aren&apos;t detected, so this reduces what&apos;s shared rather than guaranteeing
              nothing personal leaves your server.
            </span>
          </span>
        </label>
        {AI_FEATURES.map((f) => (
          <label key={f.key} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name={f.key} defaultChecked={settings.features[f.key]} className="mt-1" />
            <span>
              <span className="font-medium">{f.label}</span>
              <span className="muted block">{f.description}</span>
            </span>
          </label>
        ))}
        <SubmitButton>Save AI settings</SubmitButton>
      </ActionForm>
    </>
  );
}

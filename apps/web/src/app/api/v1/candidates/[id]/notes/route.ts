import { listNotes, serializeNote } from "@/lib/api/data";
import { apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { addNote } from "@/lib/pipeline";

export const GET = apiHandler(routes.listNotes, async ({ user, params, query }) =>
  listNotes(user, params.id, query.limit, query.cursor),
);

export const POST = apiHandler(routes.createNote, async ({ user, params, body }) => {
  const note = await addNote(user, params.id, body.body);
  if (!note) throw notFound("Candidate");
  return serializeNote(note, user.name);
});

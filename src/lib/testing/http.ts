/*
 * Test-only API call: dispatch() as the project route runs it. In production the route wraps dispatch() in
 * apiRoute(), which turns a thrown HttpError (e.g. a 409 with the approval blockers) into a JSON response via
 * errorResponse(); dispatch() itself lets the error propagate. Import "./env" before this module.
 */
import { dispatch } from "../api";
import { errorResponse } from "../http";

export async function callApi(projectId: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const req = new Request(`http://test/api/projects/${projectId}/${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let res: Response;
  try {
    res = await dispatch(req, projectId, path.split("/"));
  } catch (e) {
    res = errorResponse(e);
  }
  return { status: res.status, data: await res.json() };
}

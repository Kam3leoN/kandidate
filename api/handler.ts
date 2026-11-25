/**
 * Single Vercel Function for the whole API (stays under the Hobby plan function limit).
 * vercel.json rewrites /api/<path> → /api/handler?__p=<path>.
 */
import { handle } from '../server/app.js';

export const config = { maxDuration: 60 };

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
export function POST(request: Request): Promise<Response> {
  return handle(request);
}
export function PUT(request: Request): Promise<Response> {
  return handle(request);
}
export function PATCH(request: Request): Promise<Response> {
  return handle(request);
}
export function DELETE(request: Request): Promise<Response> {
  return handle(request);
}
export function OPTIONS(request: Request): Promise<Response> {
  return handle(request);
}

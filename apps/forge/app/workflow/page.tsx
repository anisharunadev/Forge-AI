/**
 * `/workflow` — alias for the home workflow page.
 *
 * The home `/` route still wins for first-time users (per the
 * existing persona-cookie redirect). `/workflow` is the canonical
 * "where am I in the workflow?" page once the user has a project,
 * and is what we link to from the sidebar.
 */

import { redirect } from 'next/navigation';

export default function WorkflowIndexPage(): never {
  redirect('/workflow/idea');
}
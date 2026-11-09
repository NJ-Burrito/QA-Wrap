/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/** The one place the profile is read from: the Settings record (name = `testerName`, picture = `profilePicture`). core/profile.js loads this on first use. */
import { getSettings } from './settings.js';

export async function readProfile() {
  const s = await getSettings();
  return { name: s.testerName, picture: s.profilePicture };
}

/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/** The one place the profile is read from: the Settings record (`testerName`, `profileNameAr`, `profileNameEn`, `profilePicture`). core/profile.js loads this on first use and normalises it. */
import { getSettings } from './settings.js';

export const readProfile = () => getSettings();

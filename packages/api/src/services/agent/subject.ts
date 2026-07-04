/**
 * Subject normalization shared by every channel. Stripping `Re:`/`Fwd:` chains
 * is an email convention, but the helper is channel-agnostic (a no-op on a
 * subjectless channel's `''`) so the shared orchestrator and scheduling
 * capability can derive a job title from whatever subject a channel carries
 * without importing anything from the email channel.
 */

const SUBJECT_PREFIX = /^(?:re|fwd?|fw)\s*:\s*/i;

/** Strip `Re:`/`Fwd:` chains off a subject; '' stays ''. */
export function cleanSubject(subject: string): string {
	let cleaned = subject.trim();
	while (SUBJECT_PREFIX.test(cleaned)) {
		cleaned = cleaned.replace(SUBJECT_PREFIX, '');
	}
	return cleaned.trim();
}

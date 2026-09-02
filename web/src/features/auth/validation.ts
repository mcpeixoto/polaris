/**
 * The checks the auth screens run before they call the server.
 *
 * They exist because `AuthForm` is `noValidate` — the platform's own bubbles are in the
 * browser's wording, appear over the field and vanish on the next keystroke, which is the
 * wrong shape for screens whose other messages are field messages that persist. Turning the
 * bubbles off without replacing them is what left `required`, `type="email"` and `minLength`
 * as advice nothing enforced, so an empty sign-in made a round trip to be refused.
 *
 * Shared rather than restated per screen because three forms ask the same two questions, and
 * a password floor that drifts between sign-up and accept-invite is a rule that only holds on
 * whichever screen was edited last.
 */

/** Matches the server's floor. Stated in the hint, so nobody discovers it by being refused. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Deliberately the loosest check that catches a typo: something, an @, something, a dot.
 *
 * Anything stricter is wrong about somebody's real address — the grammar RFC 5321 actually
 * permits is not what people expect a form to accept — and the server is the only thing that
 * can say whether an address exists at all. This is here to stop "ada@example" reaching the
 * network, not to adjudicate addresses.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

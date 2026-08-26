/* Waiting, without guessing how long.
 *
 * Every file here used to nap a flat 400ms after each interaction, whether the thing
 * it was waiting for took 2ms or 200ms. That cost about 30 of the suite's 47 seconds,
 * and it is the flaky-test pattern besides: too short and it fails on a slow machine,
 * too long and nobody ever learns it was too short.
 *
 * until() polls the condition the test is actually waiting for and carries on the
 * moment it holds.
 *
 * It RESOLVES on timeout rather than throwing, which is the important part. The
 * assertion that follows is left to fail with the message it already has, so a broken
 * test reports exactly what it reported before - only a passing one gets faster.
 * Never let this hang, and never let it swallow a failure.
 *
 * Two things it cannot do, both of which mean "keep a real wait":
 *   - assert that something did NOT happen. There is no condition to poll, and until()
 *     would return on the first tick and check a state that had not settled. A test
 *     like that turned into an until() always passes, which is worse than a slow one.
 *   - wait out a debounce whose only effect is one you are asserting the absence of.
 */

export const UNTIL_TIMEOUT = 2000;   /* generous: only ever paid on the way to a failure */
const STEP = 5;

export function until(predicate, timeout = UNTIL_TIMEOUT) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve) => {
    (function poll() {
      let held = false;
      try {
        held = !!predicate();
      } catch (e) {
        /* the DOM the predicate reaches for may not exist yet - that is a "not ready",
           not an error, right up until the deadline */
        held = false;
      }
      if (held || Date.now() >= deadline) return resolve(held);
      setTimeout(poll, STEP);
    })();
  });
}

/* For the cases above, where there is genuinely nothing to poll for. Named so that
   every remaining fixed wait in the suite says out loud that it is deliberate. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

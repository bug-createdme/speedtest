import { isdn } from "../bridge/windvane.js";
import { clearHistory } from "./history.js";
import { abortTest, test } from "./test.js";
import { SCREEN, goTo } from "./ui.js";

/*
  Sign-out.

  Read this before wiring anything else to it: **this app has no session.** It
  has no login screen, no token, no cookie and no server-side identity. The
  only thing that identifies a person is the ISDN the super-app hands over
  through wv.getAuthCode (src/bridge/windvane.js), which lives in a ref for the
  life of the page and is never written to storage. On the plain web there is
  not even that.

  So "log out" cannot mean "end a session". What it can mean, and what this
  does, is **leave nothing of this person on this device**:

  - the subscriber number is dropped from memory, so any test started after
    this point is reported anonymously rather than against their line;
  - saved results are deleted, because each one carries the IP and ISP the run
    was made from;
  - a run in flight is aborted, since finishing it would post telemetry for the
    person who just asked to be forgotten.

  Locale and theme are deliberately kept. They are preferences of the handset,
  not facts about the subscriber, and resetting the language to English on the
  way out is a hostile way to end a session in a Lao-first product.

  If the Unitel super-app team exposes a real sign-out - closing the mini-app,
  revoking the auth scope, anything - this function is the single place to call
  it. Nothing else in the app knows the concept exists.
*/
export function logout() {
  if (test.running) abortTest();
  isdn.value = "";
  clearHistory();
  goTo(SCREEN.INITIAL);
}

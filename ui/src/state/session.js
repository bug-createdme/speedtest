import { exitApp, isdn } from "../bridge/windvane.js";
import { abortTest, test } from "./test.js";
import { SCREEN, goTo } from "./ui.js";

/*
  Sign-out / Exit MiniApp.

  Aborts any measurement still in flight, drops the subscriber identity held in
  memory, and closes the mini-app back to the super-app.

  WHAT IT DELIBERATELY DOES NOT DO: clear the measurement history.

  It used to call clearHistory(). That destroyed data: a field surveyor who
  measured thirty sites over a day and then closed the app lost all thirty,
  irreversibly, because history lives only in this device's localStorage and
  nothing has been synced to a server yet (docs: telemetry is fire-and-forget,
  there is no outbox). "Sign out" is not a request to erase your own work.

  The privacy argument for wiping - a shared handset handing one person's
  results to the next - is real but does not apply yet and is not what this
  code was achieving: it wiped unsynced measurement data to protect an identity
  that is already dropped on the line above.

  When the sync outbox lands, the rule becomes: clear only the entries the
  server has acknowledged, keep everything still pending, and let the user
  clear the rest deliberately from the history screen - which is already
  possible there, behind a confirmation.
*/
export function logout() {
  if (test.running) abortTest();
  isdn.value = "";
  goTo(SCREEN.INITIAL);
  exitApp();
}

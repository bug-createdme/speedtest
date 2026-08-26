import { exitApp, isdn } from "../bridge/windvane.js";
import { clearHistory } from "./history.js";
import { abortTest, test } from "./test.js";
import { SCREEN, goTo } from "./ui.js";

/*
  Sign-out / Exit MiniApp.

  Leaves nothing of this person on this device, clears in-memory state,
  aborts any in-flight measurement, and closes the MiniApp returning to SuperApp.
*/
export function logout() {
  if (test.running) abortTest();
  isdn.value = "";
  clearHistory();
  goTo(SCREEN.INITIAL);
  exitApp();
}

import { createApp } from "vue";
import App from "./App.vue";
import "./styles/tokens.css";
import "./styles/base.css";

createApp(App).mount("#app");

/*
  Debug console — deliberately NOT part of the production bundle.

  vConsole used to be constructed unconditionally right here. Three things were
  wrong with that, in increasing order of seriousness:

  1. It put a floating debug overlay on the screen of every real user.
  2. It was a static import, so it landed in the main chunk. The built bundle
     was 441 KB of JavaScript, most of it this, delivered over exactly the slow
     connection this app exists to measure.
  3. vConsole wraps XMLHttpRequest in order to log network activity — and the
     XHRs it would wrap are the ping probes and upload streams the measurement
     is made of. A debug tool that instruments the thing being measured is not
     a neutral observer.

  It is now a dynamic import() behind an explicit opt-in, so the bundler emits
  it as its own chunk that a normal run never requests. Two ways to turn it on:

    - append ?debug=1 to the URL, or
    - run localStorage.setItem("unitel-speedtest.debug", "1") once on the device

  The URL form remembers the choice, because inside the super-app there is
  often no address bar to edit: a tester enables it once through a debug entry
  point and it survives reopening the mini-app. ?debug=0 turns it back off.
*/
const DEBUG_KEY = "unitel-speedtest.debug";

function debugRequested() {
  const search = typeof window === "undefined" ? "" : window.location.search;
  try {
    const params = new URLSearchParams(search);
    const asked = params.get("debug");
    if (asked === "1") {
      localStorage.setItem(DEBUG_KEY, "1");
      return true;
    }
    if (asked === "0") {
      localStorage.removeItem(DEBUG_KEY);
      return false;
    }
    return localStorage.getItem(DEBUG_KEY) === "1";
  } catch (e) {
    // Private mode, or storage blocked by the host. The URL still works, it
    // just will not be remembered.
    return /[?&]debug=1(?:&|$)/.test(search);
  }
}

if (debugRequested()) {
  import("vconsole")
    .then(({ default: VConsole }) => {
      new VConsole({ theme: "dark" });
    })
    .catch((e) => {
      // Failing to load a debug tool must never take the app down with it.
      console.warn("[speedtest] debug console unavailable", e);
    });
}

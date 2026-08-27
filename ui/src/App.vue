<script setup>
import { onMounted, watch } from "vue";
import AppHeader from "./components/AppHeader.vue";
import InitialScreen from "./screens/InitialScreen.vue";
import ServerScreen from "./screens/ServerScreen.vue";
import TestingScreen from "./screens/TestingScreen.vue";
import ResultScreen from "./screens/ResultScreen.vue";
import ErrorScreen from "./screens/ErrorScreen.vue";
import HistoryScreen from "./screens/HistoryScreen.vue";
import {
  STAGE,
  abortTest,
  beginServerSelection,
  hasResult,
  initEngine,
  startTest,
  test,
  uiSettings
} from "./state/test.js";
import { loadHistory, saveResult } from "./state/history.js";
import { initOutbox } from "./sync/outbox.js";
import { isdn } from "./bridge/windvane.js";
import {
  SCREEN,
  connectionSource,
  connectionType,
  detectConnection,
  goTo,
  screen
} from "./state/ui.js";

/* Stamped into every record so a result can be tied to the build that made it. */
const APP_VERSION = __APP_VERSION__;

/*
  When the run in hand started.

  The engine reports elapsed fractions, not wall-clock times, so START_DATETIME_UTC
  has to be taken here. Captured on the Start press rather than derived by
  subtracting a duration at the end, which would silently absorb server
  selection and any stall into the measurement window.
*/
let runStartedAt = Date.now();

onMounted(async () => {
  detectConnection();
  /*
    Awaited in order, and each step needs the one before it:
      - initEngine reads settings.json, which is where record_endpoint lives
      - initOutbox imports any pre-outbox localStorage history into the queue
      - loadHistory reads the store, so it must run after that import, or the
        screen opens empty on the one launch where the import happens
    None of this blocks the Start button: server selection is started inside
    initEngine and left to finish on its own.
  */
  await initEngine();
  await initOutbox(uiSettings.record_endpoint);
  await loadHistory();
});

/*
  Screen transitions live here rather than in the screens themselves, so the
  flow is readable in one place instead of scattered across six components.
*/
watch(
  () => test.error,
  (error) => {
    if (error) goTo(SCREEN.ERROR);
  }
);

watch(
  () => test.stage,
  (stage) => {
    if (stage !== STAGE.DONE) return;
    if (test.aborted) return;
    if (!hasResult()) {
      // Finished with nothing to show: the run reached the end but every
      // transfer failed. Treated as an error rather than an empty result
      // screen, which would read as "your connection is 0 Mbps".
      test.error = { kind: "no-result" };
      return;
    }
    /*
      The whole run, not four numbers of it.

      measurement/record.js decides what a stored measurement contains; this
      only supplies the context the engine cannot know - which server was used,
      what the platform calls the connection, who the subscriber is, and when
      the run started. See state/history.js for where it goes.
    */
    saveResult({
      test,
      server: test.usedServer,
      connection: connectionType.value,
      connectionSource: connectionSource.value,
      netStart: test.netStart,
      netEnd: test.netEnd,
      invalid: test.invalid,
      isdn: isdn.value,
      appVersion: APP_VERSION,
      startedAt: runStartedAt,
      finishedAt: Date.now()
    });
    goTo(SCREEN.RESULT);
  }
);

function onStart() {
  runStartedAt = Date.now();
  startTest();
  goTo(SCREEN.TESTING);
}

function onCancel() {
  abortTest();
  goTo(SCREEN.INITIAL);
}

/*
  The wordmark, from anywhere.

  Two things have to happen besides the navigation, and both are the reason
  this is not just goTo(SCREEN.INITIAL) in the header:

  - A run still in flight has to be abandoned. Left going, it would finish
    minutes later and the stage watcher would pull the user onto the result
    screen from wherever they had navigated to. abortTest() no-ops when nothing
    is running, so this is safe from every screen.
  - A pending error has to be cleared, or ErrorScreen keeps rendering a failure
    the user has already walked away from the next time anything sends them
    there.

  Deliberately does NOT re-run server selection the way onRetry() does. This is
  a navigation tap, and firing a burst of probes off one is surprising; Start
  falls back to the first server in the list when selection has not settled, so
  the start screen is still usable without it.
*/
function onHome() {
  abortTest();
  test.error = null;
  goTo(SCREEN.INITIAL);
}

function onRetry() {
  test.error = null;
  // A failed selection leaves no usable server list; redo it before retrying,
  // otherwise the retry runs against the same empty set and fails identically.
  if (!test.servers.length || !test.selectedServer) beginServerSelection();
  goTo(SCREEN.INITIAL);
}
</script>

<template>
  <div class="app-shell">
    <AppHeader @home="onHome" />
    <main class="main">
      <InitialScreen v-if="screen === SCREEN.INITIAL" @start="onStart" />
      <ServerScreen v-else-if="screen === SCREEN.SERVERS" />
      <TestingScreen v-else-if="screen === SCREEN.TESTING" @cancel="onCancel" />
      <ResultScreen v-else-if="screen === SCREEN.RESULT" @again="onStart" />
      <ErrorScreen v-else-if="screen === SCREEN.ERROR" @retry="onRetry" />
      <HistoryScreen v-else-if="screen === SCREEN.HISTORY" />
    </main>
  </div>
</template>

<style scoped>
.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
}
</style>

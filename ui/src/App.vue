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
  test
} from "./state/test.js";
import { loadHistory, saveResult } from "./state/history.js";
import {
  SCREEN,
  connectionType,
  detectConnection,
  goTo,
  screen
} from "./state/ui.js";

onMounted(() => {
  loadHistory();
  detectConnection();
  initEngine();
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
    saveResult({
      download: test.download,
      upload: test.upload,
      ping: test.ping,
      jitter: test.jitter,
      server: test.usedServer ? test.usedServer.name || test.usedServer.server : "",
      connection: connectionType.value
    });
    goTo(SCREEN.RESULT);
  }
);

function onStart() {
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

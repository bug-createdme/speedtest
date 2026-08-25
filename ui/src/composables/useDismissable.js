import { onBeforeUnmount, watch } from "vue";

/*
  Close-on-outside-tap and close-on-Escape for the header popovers.

  Shared rather than written twice because getting it half right is the usual
  outcome: a menu that closes on click but not on Escape is unusable with a
  keyboard, and one that binds its listeners on mount instead of on open leaves
  a document-level handler running for the life of the page per instance.

  Both listeners are captured (`true`). The language menu sits inside a button
  whose own click would otherwise reopen what the outside-tap just closed, and
  a captured Escape gets there before anything below can swallow it.

  `pointerdown`, not `click`: closing has to happen on the press, otherwise a
  tap outside spends a frame with the popover still under the finger and the
  release lands on whatever the popover was covering.
*/
export function useDismissable(isOpen, root, close) {
  function onPointerDown(event) {
    if (!root.value) return;
    if (!root.value.contains(event.target)) close();
  }

  function onKeyDown(event) {
    if (event.key !== "Escape" && event.key !== "Esc") return;
    event.stopPropagation();
    close();
  }

  function bind() {
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
  }

  function unbind() {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
  }

  watch(isOpen, (open) => (open ? bind() : unbind()));

  /* A component unmounted while its popover is open - a screen change, say -
     would otherwise leave both listeners attached to the document forever. */
  onBeforeUnmount(unbind);
}

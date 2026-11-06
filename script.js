"use strict";

const dialogTriggers = document.querySelectorAll("[data-dialog]");

dialogTriggers.forEach((trigger) => {
  trigger.addEventListener("click", () => {
    const dialog = document.getElementById(trigger.dataset.dialog);
    if (dialog instanceof HTMLDialogElement) {
      dialog.showModal();
    }
  });
});

document.querySelectorAll("dialog[data-close], dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.hasAttribute("data-close")) {
      dialog.close();
      return;
    }

    if (event.target === dialog) {
      dialog.close();
    }
  });
});

var bootElement = document.getElementById("boot");

var bootMessage = document.getElementById("boot-msg");

var bootProgress = document.getElementById("boot-fill");

var channel = new MessageChannel();

var pendingResolve = null;

channel.port1.onmessage = () => {
  var resolve = pendingResolve;
  pendingResolve = null;
  resolve && resolve();
};

// A message-channel hop still lets the browser paint, without the timer
// throttling that makes background-tab booting crawl.
var yieldToBrowser = () =>
  new Promise((i) => {
    pendingResolve = i;
    channel.port2.postMessage(0);
  });

async function setBootProgress(i, e) {
  (bootMessage && (bootMessage.textContent = i),
    bootProgress && (bootProgress.style.width = Math.round(e * 100) + "%"),
    await yieldToBrowser());
}

export {
  bootElement,
  setBootProgress,
  bootMessage,
  bootProgress,
  yieldToBrowser,
};

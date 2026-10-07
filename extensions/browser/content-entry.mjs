import { createController } from './content-controller.mjs';

const controller = createController({ window, document, send: message => chrome.runtime.sendMessage(message) });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'enroll') controller.enroll(message.options);
  if (message.type === 'snapshot') {
    if (!controller.inspect().enrolled) controller.enroll();
    controller.applySnapshot(message.snapshot);
  }
  if (message.type === 'disconnected') controller.disconnect();
  if (message.type === 'release') controller.dispose();
  if (message.type === 'pauseNow') { controller.forcePause(); respond({paused:true}); }
  if (message.type === 'inspect') respond(controller.inspect());
});
// No page-world window messages or executable data are accepted.
chrome.runtime.sendMessage({ type: 'contentReady' }).then(result => {
  if (!result?.enrolled) return;
  controller.enroll();
  if (result.connected && result.snapshot) controller.applySnapshot(result.snapshot);
  else controller.disconnect();
}).catch(() => {});

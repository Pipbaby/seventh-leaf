// Only loaded inside the Android app (see docs/ANDROID.md); the desktop version never imports it.
// Capacitor's native bridge provides window.Capacitor, so no bundler is needed.
const { App } = window.Capacitor.Plugins;

// the back gesture closes an open panel first, then leaves the app as Android's own back would
App.addListener('backButton', () => {
  const body = document.body;
  if (body.classList.contains('panel-open') && !body.classList.contains('bare')) document.querySelector('#panel-toggle').click();
  else App.minimizeApp();
});
